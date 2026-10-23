"""Command-line interface.

    python -m simgen generate --config AMBIENT_CYCLE_COUNT --rows 20000 --seed 42 --output out/amb_cc.xlsx
    python -m simgen generate --all --rows 20000 --seed 42 --output-dir out/ --combined
    python -m simgen validate out/amb_cc.xlsx

Logs carry aggregate counts, configuration names, timings and validation
totals only - never rows or identifier values.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .config import CONFIG_NAMES, ConfigError, load_config
from .exporter import ExportBlocked, ExportError
from .pipeline import RunOptions, run, summary_counts
from .rowcount import ExactRowCountError
from .scheduling import SchedulingCapacityError

log = logging.getLogger("simgen")

SHORT_NAMES = {
    "AMB_CC": "AMBIENT_CYCLE_COUNT",
    "CLR_CC": "COOLER_CYCLE_COUNT",
    "AMB_BM": "AMBIENT_BIN_MAINTENANCE",
    "CLR_BM": "COOLER_BIN_MAINTENANCE",
}


def _resolve(names: str) -> list[str]:
    out = []
    for raw in names.split(","):
        key = raw.strip().upper()
        key = SHORT_NAMES.get(key, key)
        if key not in CONFIG_NAMES:
            raise argparse.ArgumentTypeError(f"unknown configuration '{raw}'")
        out.append(key)
    return out


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="simgen", description="Synthetic AutoStore/WMS transaction generator (offline).")
    sub = parser.add_subparsers(dest="command", required=True)

    g = sub.add_parser("generate", help="generate, validate and export workbooks")
    which = g.add_mutually_exclusive_group(required=True)
    which.add_argument("--config", help="configuration name (or short name such as AMB_CC); comma-separated allowed")
    which.add_argument("--all", action="store_true", help="all four configurations")
    vol = g.add_mutually_exclusive_group(required=True)
    vol.add_argument("--rows", type=int, help="exact rows per configuration")
    vol.add_argument("--clusters", type=int, help="exact clusters per configuration")
    g.add_argument("--start-date", help="first activity date (YYYY-MM-DD)")
    g.add_argument("--end-date", help="last activity date (YYYY-MM-DD)")
    g.add_argument("--seed", type=int, default=None, help="random seed (default from config)")
    out = g.add_mutually_exclusive_group(required=True)
    out.add_argument("--output", type=Path, help="output .xlsx for a single configuration")
    out.add_argument("--output-dir", type=Path, help="output directory (one workbook per configuration)")
    g.add_argument("--combined", action="store_true", help="also write combined.xlsx (with --output-dir)")
    g.add_argument("--overwrite", action="store_true", help="allow replacing existing files")
    g.add_argument("--employees", type=int, help="employee pool size for the selected configuration(s)")
    g.add_argument("--bin-ratio", type=float, help="unique-bin ratio for the selected configuration(s)")
    g.add_argument("--product-ratio", type=float, help="unique-product ratio for the selected configuration(s)")
    g.add_argument("--repeat-bin-rate", type=float, help="same-day repeat probability per bin-day")
    g.add_argument("--adjust-mult", type=float, help="adjustment_rate_multiplier")
    g.add_argument("--exception-mult", type=float, help="exception_rate_multiplier")
    g.add_argument("--timing-mult", type=float, help="multiplies every gap after calibration")
    g.add_argument("--pause-mult", type=float, help="multiplies the calibrated long-pause scale")
    g.add_argument("--denylist", type=Path, help="local file of values (one per line) that must not appear")
    g.add_argument("--schema-file", type=Path, help="YAML/JSON list of 89 replacement column names")
    g.add_argument("--include-cluster-id", action="store_true", help="populate the Cluster ID column")
    g.add_argument("--no-report", action="store_true", help="skip the Markdown validation report")
    g.add_argument("--config-file", type=Path, help="configuration YAML (default: config/default.yaml)")
    g.add_argument("--quiet", action="store_true", help="only warnings and errors")

    v = sub.add_parser("validate", help="re-validate an exported workbook (logical, privacy, hygiene)")
    v.add_argument("workbook", type=Path)
    v.add_argument("--config-file", type=Path)
    v.add_argument("--denylist", type=Path)
    v.add_argument("--schema-file", type=Path)
    return parser


def _generate(args: argparse.Namespace) -> int:
    configs = list(CONFIG_NAMES) if args.all else _resolve(args.config)
    if args.output is not None and len(configs) != 1:
        log.error("--output takes one configuration; use --output-dir for several")
        return 1
    if args.combined and args.output_dir is None:
        log.error("--combined needs --output-dir")
        return 1
    overrides: dict = {
        "start_date": args.start_date,
        "end_date": args.end_date,
        "repeat_bin_rate": args.repeat_bin_rate,
        "adjust_mult": args.adjust_mult,
        "exception_mult": args.exception_mult,
        "timing_mult": args.timing_mult,
        "pause_mult": args.pause_mult,
    }
    if args.employees is not None:
        overrides["employees"] = {c: args.employees for c in configs}
    if args.bin_ratio is not None:
        overrides["bin_ratio"] = {c: args.bin_ratio for c in configs}
    if args.product_ratio is not None:
        overrides["product_ratio"] = {c: args.product_ratio for c in configs}
    cfg_preview = load_config(args.config_file, overrides)
    seed = args.seed if args.seed is not None else int(cfg_preview.raw["run"]["default_seed"])
    mode, target = ("rows", args.rows) if args.rows is not None else ("clusters", args.clusters)
    if target is None or target < 1:
        log.error("--rows/--clusters must be a positive integer")
        return 1
    options = RunOptions(configs=configs, mode=mode, target=int(target), seed=seed, output=args.output,
                         output_dir=args.output_dir, combined=args.combined, overwrite=args.overwrite,
                         denylist=args.denylist, schema_file=args.schema_file,
                         include_cluster_id=args.include_cluster_id, report=not args.no_report,
                         config_path=args.config_file, overrides=overrides)
    outcome = run(options)
    counts = summary_counts(outcome)
    for name in outcome.result.config_names:
        spec = outcome.config.configurations[name]
        df = outcome.frames[name]
        log.info("%s: %d rows, %d clusters", spec.short, len(df), len(outcome.result.config(name).records))
    log.info("logical errors %d, privacy failures %d, statistical PASS %d / WARN %d / INFO %d",
             counts["logical_errors"], counts["privacy_failures"], counts["stat_pass"], counts["stat_warn"],
             counts["stat_info"])
    log.info("files written: %d%s", len(outcome.files), " plus validation report" if outcome.report_path else "")
    log.info("timings: %s", ", ".join(f"{k} {v:.1f}s" for k, v in outcome.timings.items()))
    print(f"Wrote {len(outcome.files)} workbook(s): " + ", ".join(p.name for p in outcome.files))
    if outcome.report_path:
        print(f"Validation report: {outcome.report_path.name}")
    print(f"Logical errors: {counts['logical_errors']}  Privacy failures: {counts['privacy_failures']}  "
          f"Statistical PASS/WARN/INFO: {counts['stat_pass']}/{counts['stat_warn']}/{counts['stat_info']}")
    return 0


def _validate(args: argparse.Namespace) -> int:
    from .validate_file import validate_workbook_file

    report = validate_workbook_file(args.workbook, args.config_file, args.denylist, args.schema_file)
    logical = report.errors("logical")
    privacy = report.errors("privacy")
    for c in report.checks:
        if c.failed:
            print(f"FAIL [{c.category}] {c.scope}: {c.name} ({c.violations})")
    print(f"Checks: {len(report.checks)}  Logical errors: {logical}  Privacy failures: {privacy}")
    return 0 if logical == 0 and privacy == 0 else 2


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    level = logging.WARNING if getattr(args, "quiet", False) else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    try:
        if args.command == "generate":
            return _generate(args)
        return _validate(args)
    except ExportBlocked as exc:
        log.error("%s", exc)
        return 2
    except (ConfigError, ExactRowCountError, SchedulingCapacityError, ExportError, ValueError) as exc:
        log.error("%s", exc)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
