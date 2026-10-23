"""Statistical validation against the specification's targets.

Failures here are warnings, not blockers. Targets are derived from the
configuration (template mix, type mix, mean rows per cluster are computed
from the template tables, never hardcoded). Metrics are graded only on
samples of at least ``validation.min_rows_for_statistics`` rows; share
metrics whose tolerance spans less than ``min_tolerance_counts``
observations are reported as INFO because one observation already exceeds
the tolerance.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..cluster_generator import GenerationResult
from ..config import Config
from ..quantity_state import magnitude_buckets
from ..stats_utils import icc1, lower_median
from ..templates import build_template_table
from .results import INFO, PASS, WARN, CheckResult


def cluster_frame(config: Config, result: GenerationResult, name: str) -> pd.DataFrame:
    cr = result.config(name)
    wf = result.workforce_of(name)
    rows = []
    for r in cr.records:
        prof = wf.employees[r.employee]
        rows.append({
            "cluster": r.cluster_number,
            "template": r.template_key,
            "code": r.template_code,
            "bucket": r.bucket,
            "duration": (r.end_ms - r.start_ms) / 1000.0,
            "hour": int((r.start_ms % 86_400_000) // 3_600_000),
            "port": r.port,
            "employee": r.employee,
            "tier": prof.speed_tier[name],
            "tier_index": prof.speed_tier_index[name],
            "tu": r.tu_id,
            "bin_type": r.bin_type,
            "date": r.date,
            "status": r.cluster_status,
            "has_x": "X" in r.template_code.split("-"),
            "has_d": "D" in r.template_code.split("-"),
            "rows": len(r.rows),
        })
    return pd.DataFrame(rows)


class _Grader:
    def __init__(self, config: Config, scope: str, graded: bool, n_rows: int) -> None:
        val = config.raw["validation"]
        self.tol = val["tolerances"]
        self.min_counts = float(val["min_tolerance_counts"])
        self.min_expected = float(val["min_expected_count_relative"])
        self.scope = scope
        self.graded = graded
        self.n_rows = n_rows
        self.checks: list[CheckResult] = []

    def _status(self, ok: bool, gradeable: bool = True) -> str:
        if not self.graded or not gradeable:
            return INFO
        return PASS if ok else WARN

    def share(self, name: str, actual: float, target: float, tol_pp: float, n: int, note: str = "") -> None:
        gradeable = n * tol_pp / 100.0 >= self.min_counts
        ok = abs(actual - target) * 100.0 <= tol_pp + 1e-9
        detail = note or f"n={n}"
        if not gradeable and self.graded:
            detail += f"; tolerance spans fewer than {self.min_counts:g} observation(s)"
        self.checks.append(CheckResult("statistical", self.scope, name, self._status(ok, gradeable),
                                       0, detail, f"{target * 100:.2f}%", f"{actual * 100:.2f}%", f"+/-{tol_pp:g} pp"))

    def relative(self, name: str, actual: float, target: float, rel: float, expected_count: float | None = None,
                 fmt: str = "{:.4f}", note: str = "") -> None:
        gradeable = expected_count is None or expected_count >= self.min_expected
        ok = target > 0 and abs(actual - target) <= rel * target + 1e-12
        detail = note
        if not gradeable and self.graded:
            detail = (detail + "; " if detail else "") + f"expected count {expected_count:.1f} below {self.min_expected:g}"
        self.checks.append(CheckResult("statistical", self.scope, name, self._status(ok, gradeable), 0, detail,
                                       fmt.format(target), fmt.format(actual), f"+/-{rel * 100:g}% relative"))

    def absolute(self, name: str, actual: float, target: float, tol: float, unit: str = "", note: str = "") -> None:
        ok = abs(actual - target) <= tol + 1e-9
        self.checks.append(CheckResult("statistical", self.scope, name, self._status(ok), 0, note,
                                       f"{target:g}{unit}", f"{actual:g}{unit}", f"+/-{tol:g}{unit}"))

    def custom(self, name: str, ok: bool, target: str, actual: str, tolerance: str, note: str = "",
               gradeable: bool = True) -> None:
        self.checks.append(CheckResult("statistical", self.scope, name, self._status(ok, gradeable), 0, note,
                                       target, actual, tolerance))

    def info(self, name: str, actual: str, note: str = "", target: str = "") -> None:
        self.checks.append(CheckResult("statistical", self.scope, name, INFO, 0, note, target, actual, ""))


def validate_statistics(config: Config, result: GenerationResult, name: str, df: pd.DataFrame) -> list[CheckResult]:
    spec = config.configurations[name]
    env = config.environments[spec.environment]
    table = build_template_table(config, name)
    cf = cluster_frame(config, result, name)
    n_rows = len(df)
    n_cl = len(cf)
    min_rows = int(config.raw["validation"]["min_rows_for_statistics"])
    g = _Grader(config, spec.short, n_rows >= min_rows, n_rows)
    tol = g.tol
    if n_rows < min_rows:
        g.info("Sample size", f"{n_rows} rows", f"below {min_rows} rows: metrics reported for reference only")
    if n_cl == 0:
        return g.checks

    # ---- templates -----------------------------------------------------------------
    counts = cf["template"].value_counts()
    bucket_targets: dict[str, float] = {}
    for t, p in zip(table.templates, table.probs):
        actual = counts.get(t.key, 0) / n_cl
        if t.bucket != "MAIN":
            bucket_targets[t.bucket] = bucket_targets.get(t.bucket, 0.0) + float(p)
            g.info(f"Template share {t.key} (within rare bucket)", f"{actual * 100:.3f}%",
                   f"n={int(counts.get(t.key, 0))}", f"{p * 100:.3f}%")
            continue
        if p >= 0.10:
            g.share(f"Template share {t.code}", actual, float(p), float(tol["template_share_major_pp"]), n_cl)
        elif p >= 0.01:
            g.share(f"Template share {t.code}", actual, float(p), float(tol["template_share_minor_pp"]), n_cl)
        else:
            g.relative(f"Template share {t.code}", actual, float(p), float(tol["template_share_rare_relative"]),
                       expected_count=p * n_cl, fmt="{:.4%}", note=f"n={int(counts.get(t.key, 0))}")
    for bucket, p in bucket_targets.items():
        actual = float((cf["bucket"] == bucket).mean())
        g.relative(f"Rare bucket share {bucket}", actual, p, float(tol["template_share_rare_relative"]),
                   expected_count=p * n_cl, fmt="{:.4%}", note=f"n={int((cf['bucket'] == bucket).sum())}")

    # ---- row-level transaction type mix ------------------------------------------------
    exp_mix = table.expected_type_mix()
    act_mix = df["transaction_type"].value_counts(normalize=True)
    for ttype, target in exp_mix.items():
        g.share(f"Row mix {ttype}", float(act_mix.get(ttype, 0.0)), target, float(tol["transaction_type_mix_pp"]), n_rows)
    g.relative("Mean rows per cluster", n_rows / n_cl, table.mean_rows, float(tol["mean_rows_per_cluster_relative"]),
               fmt="{:.4f}")

    # ---- durations -----------------------------------------------------------------------
    dur = cf["duration"].to_numpy()
    g.relative("Median cluster duration (s)", float(np.median(dur)), spec.duration_median_target,
               float(tol["median_duration_relative"]), fmt="{:.2f}")
    g.relative("P90 cluster duration (s)", float(np.percentile(dur, 90)), spec.duration_p90_target,
               float(tol["p90_duration_relative"]), fmt="{:.2f}")

    # ---- start hours ------------------------------------------------------------------------
    hours = cf["hour"].to_numpy()
    for h in (15, 16, 17, 18, 19):
        g.share(f"Start hour {h}h", float(np.mean(hours == h)), spec.hour_weights.get(h, 0.0),
                float(tol["start_hour_pp"]), n_cl)
    other_actual = float(np.mean((hours < 15) | (hours > 19)))
    g.share("Start hour other (14h/20h)", other_actual, spec.hour_other_share, float(tol["start_hour_pp"]), n_cl)

    # ---- ports ---------------------------------------------------------------------------------
    for p_idx, target in enumerate(spec.port_weights, start=1):
        g.share(f"Port share {env.port_location(p_idx)}", float(np.mean(cf["port"].to_numpy() == p_idx)), target,
                float(tol["port_share_pp"]), n_cl)

    # ---- bin types (over unique TUs used) ------------------------------------------------------
    tus = cf.drop_duplicates("tu")
    for bt, target in zip(env.bin_type_names, env.bin_type_probs):
        g.share(f"Bin-type share {bt} (unique TUs)", float(np.mean(tus["bin_type"].to_numpy() == bt)), target,
                float(tol["bin_type_share_pp"]), len(tus))

    # ---- adjust signs and magnitudes -----------------------------------------------------------
    adj = df[df["transaction_type"] == "Adjust"]
    q = pd.to_numeric(adj["transaction_quantity"], errors="coerce").to_numpy(dtype=float)
    n_adj = len(q)
    if n_adj:
        for label, mask, key in (("negative", q < 0, "negative"), ("positive", q > 0, "positive"),
                                 ("zero", q == 0, "zero")):
            g.share(f"Adjust sign {label}", float(np.mean(mask)), spec.adjust_sign[key], float(tol["adjust_sign_pp"]), n_adj)
        nz = np.abs(q[q != 0])
        buckets = magnitude_buckets(config, name)
        if spec.magnitude_median_target is not None:
            med = lower_median(nz) if len(nz) else float("nan")
            g.custom("Adjust |nonzero| median (exact)", med == spec.magnitude_median_target,
                     f"{spec.magnitude_median_target}", f"{med:g}", "exact", f"n={len(nz)}; lower median")
        else:
            cdf = 0.0
            derived = None
            for lo, hi, p in buckets:
                for v in range(lo, hi + 1):
                    cdf += p / (hi - lo + 1)
                    if derived is None and cdf >= 0.5 - 1e-12:
                        derived = v
            med = lower_median(nz) if len(nz) else float("nan")
            g.info("Adjust |nonzero| median", f"{med:g}",
                   f"n={len(nz)}; no median target is specified for this workflow", f"{derived} (from bucket table)")
        if spec.magnitude_p90_target is not None:
            g.absolute("Adjust |qty| P90 incl. zeros", float(np.percentile(np.abs(q), 90)),
                       spec.magnitude_p90_target, float(tol["magnitude_p90_units"]), note=f"n={n_adj}")
        # reasons
        reasons = adj["reason_code"].value_counts(normalize=True)
        prof = config.raw["adjust_reason_profiles"][spec.reason_profile]
        for code, target in prof.items():
            g.share(f"Adjust reason {code}", float(reasons.get(code, 0.0)), float(target),
                    float(tol["reason_status_pp"]), n_adj)
        for code, change in config.raw["material_status"]["adjust_reason_changes"].items():
            sub = adj[adj["reason_code"] == code]
            if len(sub):
                share = float((sub["to_material_status"] == change["to_status"]).mean())
                g.share(f"To status {change['to_status']} on {code} adjustments", share, float(change["probability"]),
                        float(tol["reason_status_pp"]), len(sub))

    # ---- adjust TU --------------------------------------------------------------------------------
    if spec.adjust_tu_zero_or_blank_rate is not None:
        trows = df[df["transaction_type"] == "Adjust TU"]
        if len(trows):
            tq = pd.to_numeric(trows["transaction_quantity"], errors="coerce")
            zb = float((tq.isna() | (tq == 0)).mean())
            g.share("Adjust TU zero-or-blank rate", zb, spec.adjust_tu_zero_or_blank_rate,
                    float(tol["adjust_tu_zero_blank_pp"]), len(trows))
            no_detail = float(trows["from_product"].isna().mean())
            g.info("Adjust TU rows without product detail", f"{no_detail * 100:.2f}%", f"n={len(trows)}",
                   f"{float(config.raw['adjust_tu']['product_detail_blank_rate']) * 100:.2f}%")
            zb_rows = tq.isna() | (tq == 0)
            if zb_rows.any():
                blank_share = float(tq[zb_rows].isna().mean())
                g.info("Adjust TU blank share within zero-or-blank", f"{blank_share * 100:.2f}%", f"n={int(zb_rows.sum())}",
                       f"{float(config.raw['adjust_tu']['blank_share_within_zero_or_blank']) * 100:.2f}%")
            treasons = trows["reason_code"].value_counts(normalize=True)
            for code, target in config.raw["adjust_tu"]["reasons"].items():
                g.share(f"Adjust TU reason {code}", float(treasons.get(code, 0.0)), float(target),
                        float(tol["reason_status_pp"]), len(trows))

    # ---- material status (cluster level) ------------------------------------------------------------
    ms = config.raw["material_status"]
    groups = (("default", ~cf["has_x"] & ~cf["has_d"]), ("tu_damaged_cluster", cf["has_x"]),
              ("tu_dirty_cluster", cf["has_d"] & ~cf["has_x"]))
    labels = {"default": "default clusters", "tu_damaged_cluster": "TU Damaged clusters",
              "tu_dirty_cluster": "TU Dirty clusters"}
    for key, mask in groups:
        sub = cf[mask]
        if not len(sub):
            continue
        shares = sub["status"].value_counts(normalize=True)
        for status, target in ms[key].items():
            g.share(f"Material status {status} ({labels[key]})", float(shares.get(status, 0.0)), float(target),
                    float(tol["reason_status_pp"]), len(sub))

    # ---- lot / expiry and updaters (reported for reference) -------------------------------------------
    first_rows = df.sort_values(["create_date", "cluster_sequence_number"]).drop_duplicates("from_tu")
    lot_share = float(first_rows["from_lot"].notna().mean())
    g.info("TUs whose initial state carries lot and expiry", f"{lot_share * 100:.2f}%", f"n={len(first_rows)} TUs",
           f"{env.lot_populated_probability * 100:.2f}%")
    moves = df[df["transaction_type"] == "Move"]
    first_moves = moves[moves["cluster_sequence_number"] == 1]
    other_moves = moves[moves["cluster_sequence_number"] != 1]
    sysu = config.system_user
    upd = config.raw["updaters"]
    if len(first_moves):
        g.info("Opening Move updated by system", f"{float((first_moves['updated_by'] == sysu).mean()) * 100:.2f}%",
               f"n={len(first_moves)}", f"{float(upd['opening_move_system_probability']) * 100:.2f}%")
    if len(other_moves):
        g.info("Closing/re-presentation Moves updated by system",
               f"{float((other_moves['updated_by'] == sysu).mean()) * 100:.2f}%", f"n={len(other_moves)}",
               f"{float(upd['closing_move_system_probability']) * 100:.2f}%")
    visible = df.loc[df["updated_by"] != sysu].groupby("_cluster").size() if "_cluster" in df else pd.Series(dtype=int)
    g.info("Clusters with no human row (all rows by system)", f"{(1 - len(visible) / n_cl) * 100:.2f}%",
           "follows from the updater probabilities on clusters without middle actions")

    # ---- employees ------------------------------------------------------------------------------------
    emp_counts = cf["employee"].value_counts().to_numpy()
    frac = float(config.raw["employees"]["top_share_fraction"])
    lo, hi = (float(x) for x in config.raw["employees"]["top_share_target"])
    k = max(1, int(round(frac * len(emp_counts))))
    top = float(np.sort(emp_counts)[::-1][:k].sum() / emp_counts.sum())
    g.custom("Top-20% employee cluster share", lo <= top <= hi, f"{lo * 100:.0f}-{hi * 100:.0f}%",
             f"{top * 100:.1f}%", "band", f"{len(emp_counts)} employees, top {k}")
    tmpl_median = cf.groupby("template")["duration"].transform("median")
    norm = cf["duration"] / tmpl_median
    icc = icc1(cf["employee"].to_numpy(), np.log(norm.to_numpy()))
    g.custom("Speed persistence (ICC of log template-normalised duration)", (not math.isnan(icc)) and icc > float(tol["icc_min"]),
             f"> {float(tol['icc_min']):g}", f"{icc:.3f}", "threshold", "one-way ICC(1) by employee")
    tier_medians = norm.groupby(cf["tier_index"]).median().sort_index()
    names = config.raw["employees"]["speed_tiers"]
    increasing = bool(np.all(np.diff(tier_medians.to_numpy()) > 0)) and len(tier_medians) >= 2
    tier_text = ", ".join(f"{names[i]['name']} {v:.2f}" for i, v in tier_medians.items())
    g.custom("Tier ordering of median normalised duration", increasing, "strictly increasing", tier_text, "order")

    # ---- populations -------------------------------------------------------------------------------------
    uniq_bins = cf["tu"].nunique() / n_cl
    products = pd.concat([df["from_product"], df["to_product"]]).dropna().nunique() / n_cl
    g.relative("Unique bin ratio", uniq_bins, spec.unique_bins_ratio, float(tol["unique_ratio_relative"]))
    g.relative("Unique product ratio", products, spec.unique_products_ratio, float(tol["unique_ratio_relative"]))
    bin_days = cf.groupby(["tu", "date"]).size()
    repeat_rate = float((bin_days == 2).sum() / len(bin_days))
    target_rate = float(config.raw["bin_day"]["repeat_rate"])
    g.relative("Repeat bin-day rate", repeat_rate, target_rate, float(tol["repeat_bin_day_relative"]),
               expected_count=target_rate * len(bin_days), note=f"{int((bin_days == 2).sum())} of {len(bin_days)} bin-days")
    return g.checks
