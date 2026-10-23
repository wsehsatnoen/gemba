"""Supporting-sheet content and the Markdown validation report.

Everything here is aggregate: counts, ratios, configuration names, timings
and validation totals. Identifier values never appear in the report.
"""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

from .config import Config, config_summary
from .exporter import SheetSpec
from .quantity_state import magnitude_buckets
from .schema import SchemaDefinition
from .templates import ALL_TRANSACTION_TYPES
from .validators.results import FAIL, INFO, PASS, WARN, CheckResult, ValidationReport

if TYPE_CHECKING:  # pragma: no cover
    from .pipeline import RunOutcome


def _pct(x: float, digits: int = 1) -> str:
    return f"{x * 100:.{digits}f}%"


# ---------------------------------------------------------------------------------
# Per-configuration sample facts (used by the sheets and the report)
# ---------------------------------------------------------------------------------

def sample_facts(outcome: "RunOutcome", name: str) -> dict[str, object]:
    config = outcome.config
    spec = config.configurations[name]
    df = outcome.frames[name]
    cr = outcome.result.config(name)
    n_cl = len(cr.records)
    durations = np.array([(r.end_ms - r.start_ms) / 1000.0 for r in cr.records]) if n_cl else np.zeros(0)
    templates = Counter(r.template_key for r in cr.records)
    products = pd.concat([df["from_product"], df["to_product"]]).dropna().nunique()
    adjust_rows = int((df["transaction_type"] == "Adjust").sum())
    adjust_clusters = sum(1 for r in cr.records if "A" in r.template_code.split("-"))
    humans = df.loc[df["updated_by"] != config.system_user, "updated_by"].nunique()
    workforce = {r.employee for r in cr.records}
    table = cr.table
    top5 = []
    for t, p in sorted(zip(table.templates, table.probs), key=lambda tp: -tp[1])[:5]:
        top5.append((t.key, float(p), templates.get(t.key, 0) / n_cl if n_cl else 0.0))
    sel = cr.selection
    return {
        "name": name,
        "short": spec.short,
        "requested": outcome.result.target,
        "mode": outcome.result.mode,
        "rows": len(df),
        "clusters": n_cl,
        "date_range": f"{config.start_date.isoformat()} to {config.end_date.isoformat()}",
        "first_date": min((r.date for r in cr.records), default=None),
        "last_date": max((r.date for r in cr.records), default=None),
        "employees": len(workforce),
        "employees_visible": int(humans),
        "bins": int(df["from_tu"].nunique()),
        "products": int(products),
        "bin_ratio": df["from_tu"].nunique() / n_cl if n_cl else 0.0,
        "product_ratio": products / n_cl if n_cl else 0.0,
        "median": float(np.median(durations)) if n_cl else float("nan"),
        "p90": float(np.percentile(durations, 90)) if n_cl else float("nan"),
        "median_target": spec.duration_median_target,
        "p90_target": spec.duration_p90_target,
        "adjust_rows": adjust_rows,
        "adjust_row_rate": adjust_rows / len(df) if len(df) else 0.0,
        "adjust_clusters": adjust_clusters,
        "adjust_cluster_rate": adjust_clusters / n_cl if n_cl else 0.0,
        "top5": top5,
        "steered": sel.steered if sel else 0,
        "dropped": sel.dropped if sel else 0,
        "scheduled": cr.scheduled_clusters,
        "pushed_no_idle": cr.schedule_stats.pushed_no_idle,
        "shift_fallbacks": cr.schedule_stats.shift_fallbacks,
        "state": cr.state_stats,
        "calibration": cr.calibration,
    }


# ---------------------------------------------------------------------------------
# Supporting sheets
# ---------------------------------------------------------------------------------

def notice_sheet(outcome: "RunOutcome", names: list[str]) -> SheetSpec:
    config = outcome.config
    summary = config_summary(config)
    rows: list[list[object]] = [
        [config.notice_text],
        [],
        ["Synthetic AutoStore/WMS inventory-control transactions"],
        ["Every value in this workbook was generated from scratch by a seeded random process. "
         "No source workbooks, production exports, employee lists, product masters or other internal files "
         "were used or required. All identifiers use the SIM* synthetic formats."],
        [str(config.raw["meta"]["schema_disclaimer"])],
        [],
        ["Field", "Value"],
        ["Seed", outcome.result.seed],
        ["Generated at (UTC)", outcome.generated_at.strftime("%Y-%m-%d %H:%M:%S")],
        ["Volume mode", "exact rows per configuration" if outcome.result.mode == "rows" else "exact clusters per configuration"],
        ["Requested per configuration", outcome.result.target],
    ]
    for k, v in summary.items():
        rows.append([k.replace("_", " ").capitalize(), v])
    rows.append([])
    rows.append(["Configuration", "Short name", "Environment", "Operation", "Rows", "Clusters",
                 "Employees", "Unique TUs", "Unique products"])
    header_row = len(rows)
    for name in names:
        f = sample_facts(outcome, name)
        spec = config.configurations[name]
        rows.append([name, spec.short, spec.environment, spec.operation, f["rows"], f["clusters"],
                     f["employees"], f["bins"], f["products"]])
    return SheetSpec("Synthetic Data Notice", rows, widths={1: 34, 2: 70, 3: 14, 4: 26, 5: 10, 6: 10, 7: 11, 8: 12, 9: 15},
                     header_row=header_row)


def validation_sheet(config: Config, checks: list[CheckResult]) -> SheetSpec:
    logical = sum(c.violations for c in checks if c.category == "logical" and c.status == FAIL)
    privacy = sum(c.violations for c in checks if c.category == "privacy" and c.status == FAIL)
    stat = Counter(c.status for c in checks if c.category == "statistical")
    rows: list[list[object]] = [
        [config.notice_text],
        [],
        ["Logical errors", logical, "Privacy failures", privacy],
        ["Statistical PASS", stat.get(PASS, 0), "Statistical WARN", stat.get(WARN, 0), "Statistical INFO", stat.get(INFO, 0)],
        ["Workbook hygiene (no macros, formulas, external links, data connections or hidden sheets; metadata) "
         "is verified on the written file before it is published; a file that fails is never written."],
        [],
        ["Category", "Scope", "Check", "Status", "Violations", "Target", "Actual", "Tolerance", "Detail"],
    ]
    header_row = len(rows)
    order = {"logical": 0, "privacy": 1, "statistical": 2}
    for c in sorted(checks, key=lambda c: order.get(c.category, 9)):
        rows.append([c.category, c.scope, c.name, c.status, c.violations, c.target, c.actual, c.tolerance, c.detail])
    return SheetSpec("Validation Summary", rows,
                     widths={1: 13, 2: 14, 3: 70, 4: 9, 5: 11, 6: 16, 7: 40, 8: 20, 9: 50}, header_row=header_row)


def employee_sheet(outcome: "RunOutcome", names: list[str]) -> SheetSpec:
    config = outcome.config
    rows: list[list[object]] = [
        [config.notice_text],
        ["Synthetic employees with persistent timing profiles. Timing traits describe synthetic processing "
         "behaviour only and are not a judgement of anyone. The system user is an automated identity and is excluded."],
        [],
        ["Employee ID", "Environment", "Home configuration", "Cross-trained into", "Configuration", "Speed tier",
         "Speed multiplier", "Variability", "Timing sigma", "Activity weight (normalised)", "Expected cluster share",
         "Base long-pause probability", "Pause factor range", "Adjustment tendency", "Repeat-adjustment tendency",
         "Exception tendency", "Active days", "Shift window", "Clusters"],
    ]
    header_row = len(rows)
    for name in names:
        wf = outcome.result.workforce_of(name)
        counts = Counter(r.employee for r in outcome.result.config(name).records)
        for e in wf.workforce[name]:
            p = wf.employees[e]
            lo, hi = p.long_pause_multiplier_range[name]
            shift = f"{p.shift_start // 3600:02d}:{(p.shift_start % 3600) // 60:02d}-{p.shift_end // 3600:02d}:{(p.shift_end % 3600) // 60:02d}"
            rows.append([e, p.environment, p.home_config, ", ".join(p.extra_configs) or "-", name, p.speed_tier[name],
                         round(p.speed_multiplier[name], 4), p.variability, round(p.timing_sigma, 4),
                         round(p.activity_weight[name], 5), round(wf.expected_share[name][e], 5),
                         round(p.long_pause_probability[name], 4), f"{lo:.2f} to {hi:.2f}",
                         round(p.adjustment_tendency, 4), round(p.repeat_adjustment_tendency, 4),
                         round(p.exception_tendency, 4), len(p.active_days), shift, counts.get(e, 0)])
    widths = {i: 16 for i in range(1, 20)}
    widths[1] = 20
    widths[3] = widths[4] = widths[5] = 26
    return SheetSpec("Employee Profiles", rows, widths=widths, header_row=header_row)


def schema_sheet(config: Config, schema: SchemaDefinition) -> SheetSpec:
    rows: list[list[object]] = [
        [config.notice_text],
        [str(config.raw["meta"]["schema_disclaimer"])],
        [],
        ["#", "Column", "Type", "Classification", "Generation rule"] + list(ALL_TRANSACTION_TYPES),
    ]
    header_row = len(rows)
    for i, c in enumerate(schema.columns, start=1):
        rows.append([i, c.name, c.dtype, c.classification, c.rule] + [c.null_rule(t) for t in ALL_TRANSACTION_TYPES])
    widths = {1: 5, 2: 26, 3: 10, 4: 26, 5: 70}
    for i in range(6, 6 + len(ALL_TRANSACTION_TYPES)):
        widths[i] = 16
    return SheetSpec("Schema Dictionary", rows, widths=widths, header_row=header_row)


def calibration_sheet(outcome: "RunOutcome", names: list[str]) -> SheetSpec:
    config = outcome.config
    rows: list[list[object]] = [
        [config.notice_text],
        ["Frozen calibration solved before generation from an internal simulated sample built from this run's "
         "employee population. scale multiplies every gap; the long-pause scale first multiplies each employee's "
         "pause probability up to the configured mean-rate cap, then lengthens pauses."],
        [],
        ["Configuration", "Calibration scale", "Long-pause scale", "Pause frequency multiplier",
         "Pause magnitude multiplier", "Sample pause rate", "Base pause rate", "Target median (s)",
         "Sample median (s)", "Target P90 (s)", "Sample P90 (s)", "Sample clusters", "Expected ICC (sample)",
         "CLI timing multiplier", "CLI pause multiplier", "Status"],
    ]
    header_row = len(rows)
    for name in names:
        cal = outcome.result.config(name).calibration
        freq, mag = cal.components()
        rows.append([name, round(cal.scale, 6), round(cal.pause_scale, 6), round(freq, 4), round(mag, 4),
                     round(cal.sample_pause_rate, 4), round(cal.base_pause_rate, 4), cal.target_median,
                     round(cal.achieved_median, 3), cal.target_p90, round(cal.achieved_p90, 3), cal.sample_clusters,
                     round(cal.sample_icc, 4), cal.timing_multiplier, cal.pause_multiplier, cal.status])
    rows.append([])
    rows.append(["Effective Adjust magnitude buckets (after the median anchor)"])
    rows.append(["Configuration", "Bucket", "Probability"])
    for name in names:
        for lo, hi, p in magnitude_buckets(config, name):
            rows.append([name, f"{lo}" if lo == hi else f"{lo} to {hi}", round(p, 4)])
    widths = {i: 16 for i in range(1, 17)}
    widths[1] = 30
    widths[16] = 60
    return SheetSpec("Calibration", rows, widths=widths, header_row=header_row)


def supporting_sheets(outcome: "RunOutcome", names: list[str], checks: list[CheckResult]) -> list[SheetSpec]:
    return [
        notice_sheet(outcome, names),
        validation_sheet(outcome.config, checks),
        employee_sheet(outcome, names),
        schema_sheet(outcome.config, outcome.schema),
        calibration_sheet(outcome, names),
    ]


# ---------------------------------------------------------------------------------
# Markdown report
# ---------------------------------------------------------------------------------

def _md_table(headers: list[str], rows: list[list[object]]) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x).replace("|", "/") for x in r) + " |")
    return "\n".join(out)


def build_markdown(outcome: "RunOutcome") -> str:
    config = outcome.config
    report: ValidationReport = outcome.report
    names = outcome.result.config_names
    lines: list[str] = []
    lines.append("# Validation report - synthetic AutoStore/WMS transactions")
    lines.append("")
    lines.append(f"> {config.notice_text}")
    lines.append("")
    lines.append("Built exclusively from the generator specification. No production data was used or required; "
                 "every identifier is generated from scratch in the SIM* formats.")
    lines.append("")
    lines.append(f"- Seed: {outcome.result.seed}")
    lines.append(f"- Generated (UTC): {outcome.generated_at.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"- Volume: {outcome.result.target} {'rows' if outcome.result.mode == 'rows' else 'clusters'} per configuration")
    lines.append(f"- Date range: {config.start_date.isoformat()} to {config.end_date.isoformat()}")
    total_time = sum(outcome.timings.values())
    lines.append(f"- Run time: {total_time:.1f} s ({', '.join(f'{k} {v:.1f}s' for k, v in outcome.timings.items())})")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    rows = []
    for name in names:
        short = config.configurations[name].short
        f = sample_facts(outcome, name)
        stat = [c for c in report.of("statistical", short)]
        rows.append([short, f["requested"], f["rows"], f["clusters"], report.errors("logical", short),
                     report.errors("privacy", short), sum(1 for c in stat if c.status == PASS),
                     sum(1 for c in stat if c.status == WARN), sum(1 for c in stat if c.status == INFO)])
    lines.append(_md_table(["Config", "Requested", "Rows", "Clusters", "Logical errors", "Privacy failures",
                            "Stat PASS", "Stat WARN", "Stat INFO"], rows))
    lines.append("")
    cross = [c for c in report.checks if c.scope in ("AMBIENT", "COOLER", "run")]
    if cross:
        lines.append("Cross-configuration checks (shared ports, cross-trained employees, start timestamps): "
                     + ", ".join(f"{c.scope} - {c.name}: {c.status}" for c in cross))
        lines.append("")
    wb = [c for c in report.checks if c.scope.startswith("file ")]
    if wb:
        failed = [c for c in wb if c.status == FAIL]
        lines.append(f"Workbook verification on {len(outcome.files)} written file(s): "
                     f"{len(wb)} checks, {len(failed)} failed (macros, formulas, external links, data connections, "
                     "hidden sheets, sheet layout, notice line, metadata, pattern scan of the written file).")
        lines.append("")
    for name in names:
        short = config.configurations[name].short
        f = sample_facts(outcome, name)
        cal = f["calibration"]
        lines.append(f"## {name} ({short})")
        lines.append("")
        lines.append(f"- Requested {f['mode']}: {f['requested']} -> actual rows {f['rows']}, clusters {f['clusters']}"
                     + (f" ({f['steered']} cluster(s) steered by the remainder solver; {f['dropped']} of "
                        f"{f['scheduled']} scheduled clusters dropped whole)" if f["mode"] == "rows" else ""))
        lines.append(f"- Date range: {f['date_range']} (clusters on {f['first_date']} .. {f['last_date']})")
        lines.append(f"- Unique employees: {f['employees']} ({f['employees_visible']} visible as row updaters); "
                     f"bins: {f['bins']} (ratio {f['bin_ratio']:.3f}, target {config.configurations[name].unique_bins_ratio}); "
                     f"products: {f['products']} (ratio {f['product_ratio']:.3f}, target {config.configurations[name].unique_products_ratio})")
        lines.append(f"- Cluster duration: median {f['median']:.1f} s (target {f['median_target']:g}), "
                     f"P90 {f['p90']:.1f} s (target {f['p90_target']:g})")
        freq, mag = cal.components()
        lines.append(f"- Calibration: scale {cal.scale:.4f}, long-pause scale {cal.pause_scale:.4f} "
                     f"(pause frequency x{freq:.2f}, magnitude x{mag:.2f}; sample pause rate {cal.sample_pause_rate:.3f} "
                     f"vs base {cal.base_pause_rate:.3f}; expected ICC for this population {cal.sample_icc:.3f}); {cal.status}")
        lines.append(f"- Adjust rate: {f['adjust_rows']} rows ({_pct(f['adjust_row_rate'])} of rows), "
                     f"{f['adjust_clusters']} clusters ({_pct(f['adjust_cluster_rate'])} of clusters)")
        env_res = outcome.result.environments[config.configurations[name].environment]
        lines.append(f"- Port capacity: expected busiest-hour utilisation {env_res.peak_utilization * 100:.0f}% "
                     f"({env_res.peak_hour}h, {env_res.name} ports shared by "
                     f"{', '.join(config.configurations[c].short for c in env_res.used_configs)}); "
                     f"{f['pushed_no_idle']} of {f['scheduled']} scheduled starts waited for a free employee/port")
        st = f["state"]
        lines.append(f"- State pass: {st.repeat_clusters} same-day repeat clusters, {st.feasibility_fallbacks} TU "
                     f"feasibility fallbacks, {st.count_to_zero_events} count-to-zero events, {st.capacity_clamps} "
                     f"capacity clamps; scheduler pushes (no idle employee): {f['pushed_no_idle']}")
        lines.append("")
        lines.append("Top five templates vs target:")
        lines.append("")
        lines.append(_md_table(["Template", "Target", "Actual"],
                               [[k, _pct(t, 2), _pct(a, 2)] for k, t, a in f["top5"]]))
        lines.append("")
        lines.append(f"Logical errors: **{report.errors('logical', short)}** "
                     f"({len(report.of('logical', short))} checks). "
                     f"Privacy failures: **{report.errors('privacy', short)}** ({len(report.of('privacy', short))} checks).")
        lines.append("")
        stat = report.of("statistical", short)
        lines.append(f"Statistical metrics: {sum(1 for c in stat if c.status == PASS)} PASS, "
                     f"{sum(1 for c in stat if c.status == WARN)} WARN, {sum(1 for c in stat if c.status == INFO)} INFO.")
        lines.append("")
        warns = [c for c in stat if c.status == WARN]
        env_res = outcome.result.environments[config.configurations[name].environment]
        push_rate = f["pushed_no_idle"] / max(1, f["scheduled"])
        if warns:
            lines.append("WARN details:")
            lines.append("")
            for c in warns:
                lines.append(f"- {c.name}: actual {c.actual}, target {c.target} ({c.tolerance}). "
                             f"{explain_warn(c, push_rate, env_res.peak_utilization, cal.sample_icc)}")
            lines.append("")
        lines.append("<details><summary>All statistical metrics</summary>")
        lines.append("")
        lines.append(_md_table(["Metric", "Target", "Actual", "Tolerance", "Status", "Detail"],
                               [[c.name, c.target, c.actual, c.tolerance, c.status, c.detail] for c in stat]))
        lines.append("")
        lines.append("</details>")
        lines.append("")
        failures = [c for c in report.checks if c.scope == short and c.category in ("logical", "privacy")]
        lines.append("<details><summary>Logical and privacy checks</summary>")
        lines.append("")
        lines.append(_md_table(["Category", "Check", "Status", "Violations", "Detail"],
                               [[c.category, c.name, c.status, c.violations, c.detail] for c in failures]))
        lines.append("")
        lines.append("</details>")
        lines.append("")
    if wb:
        lines.append("## Workbook verification")
        lines.append("")
        lines.append(_md_table(["File", "Category", "Check", "Status", "Violations"],
                               [[c.scope[5:], c.category, c.name, c.status, c.violations] for c in wb]))
        lines.append("")
    return "\n".join(lines) + "\n"


def explain_warn(check: CheckResult, push_rate: float, peak_utilization: float, sample_icc: float = float("nan")) -> str:
    if "ICC" in check.name:
        return _icc_explanation(sample_icc)
    capacity_metric = any(k in check.name for k in ("Start hour", "Port share", "cluster duration", "Top-20%"))
    if capacity_metric and (push_rate > 0.05 or peak_utilization > 0.85):
        return (f"Port capacity: expected busiest-hour utilisation is {peak_utilization * 100:.0f}% and "
                f"{push_rate * 100:.0f}% of starts waited for a free employee or port. Waiting moves starts later "
                "(hour mix), away from saturated ports (port shares) and toward faster employees (durations). "
                "Extend the date range or lower the volume to remove it.")
    return "Sampling variation at this sample size; see the metric table for the denominator."


def _icc_explanation(sample_icc: float) -> str:
    return ("Structural, not sampling noise: the Bin Maintenance P90 targets (about 6-7x the median) can only be "
            "reached with roughly 15% long-pause clusters, and that random component outweighs the persistent "
            "speed differences. The calibration sample for this run's own employee population predicts an ICC of "
            f"{sample_icc:.3f}; an idealised large population with the specification's tier, variability and "
            "pause parameters gives about 0.26-0.28 for Bin Maintenance (0.35-0.38 for Cycle Count). Meeting "
            "0.3 needs a lower P90 target, narrower timing_sigma ranges or wider speed tiers (see "
            "docs/ASSUMPTIONS.md).")
