"""Run orchestration: generate -> expand -> validate -> export -> report."""

from __future__ import annotations

import datetime as dt
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .cluster_generator import GenerationResult, generate
from .config import Config, load_config
from .exporter import ExportBlocked, write_workbook
from .report import build_markdown, supporting_sheets
from .row_expander import expand
from .schema import SchemaDefinition, load_schema
from .security import DenylistMatcher, build_vocabulary, load_denylist
from .validators.logical import validate_logical
from .validators.privacy import validate_supporting, validate_transactions
from .validators.results import CheckResult, ValidationReport
from .validators.statistical import validate_statistics

log = logging.getLogger(__name__)


@dataclass
class RunOptions:
    configs: list[str]
    mode: str = "rows"
    target: int = 20000
    seed: int = 42
    output: Path | None = None
    output_dir: Path | None = None
    combined: bool = False
    overwrite: bool = False
    denylist: Path | None = None
    schema_file: Path | None = None
    include_cluster_id: bool = False
    report: bool = True
    config_path: Path | None = None
    overrides: dict[str, Any] = field(default_factory=dict)
    export: bool = True
    generated_at: dt.datetime | None = None


@dataclass
class RunOutcome:
    options: RunOptions
    config: Config
    schema: SchemaDefinition
    result: GenerationResult
    frames: dict[str, pd.DataFrame]
    report: ValidationReport
    generated_at: dt.datetime
    files: list[Path] = field(default_factory=list)
    report_path: Path | None = None
    timings: dict[str, float] = field(default_factory=dict)
    denylist: DenylistMatcher = field(default_factory=lambda: DenylistMatcher([]))


def _scopes_for(config: Config, names: list[str]) -> set[str]:
    scopes = {config.configurations[n].short for n in names}
    scopes.update(config.configurations[n].environment for n in names)
    scopes.add("run")
    return scopes


def build(options: RunOptions) -> RunOutcome:
    """Generate and validate (no files written)."""
    t0 = time.perf_counter()
    config = load_config(options.config_path, options.overrides)
    schema = load_schema(options.schema_file, options.include_cluster_id)
    generated_at = options.generated_at or dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0)
    result = generate(config, options.configs, options.mode, options.target, options.seed)
    t1 = time.perf_counter()
    frames = expand(config, result, schema)
    t2 = time.perf_counter()
    report = ValidationReport()
    expectations = {n: {"mode": options.mode, "target": options.target} for n in result.config_names}
    report.extend(validate_logical(config, frames, schema, expectations))
    vocab = build_vocabulary(config)
    deny = DenylistMatcher(load_denylist(options.denylist))
    for name in result.config_names:
        report.extend(validate_transactions(config, name, frames[name], schema, vocab, deny))
    for name in result.config_names:
        report.extend(validate_statistics(config, result, name, frames[name]))
    t3 = time.perf_counter()
    outcome = RunOutcome(options=options, config=config, schema=schema, result=result, frames=frames,
                         report=report, generated_at=generated_at, denylist=deny)
    outcome.timings = {"generate": t1 - t0, "expand": t2 - t1, "validate": t3 - t2}
    return outcome


def _workbook_jobs(outcome: RunOutcome) -> list[tuple[Path, list[str], bool]]:
    opts = outcome.options
    names = outcome.result.config_names
    jobs: list[tuple[Path, list[str], bool]] = []
    if opts.output is not None:
        if len(names) != 1:
            raise ValueError("--output takes a single configuration; use --output-dir with --all")
        jobs.append((Path(opts.output), names, False))
    elif opts.output_dir is not None:
        for name in names:
            short = outcome.config.configurations[name].short.lower()
            jobs.append((Path(opts.output_dir) / f"{short}.xlsx", [name], False))
        if opts.combined:
            jobs.append((Path(opts.output_dir) / "combined.xlsx", names, True))
    return jobs


def export(outcome: RunOutcome) -> RunOutcome:
    """Write workbooks and the Markdown report. Blocks on logical/privacy failures."""
    t0 = time.perf_counter()
    config = outcome.config
    report = outcome.report
    deny = outcome.denylist
    jobs = _workbook_jobs(outcome)
    metadata = {"creator": str(config.raw["meta"]["workbook_creator"]),
                "lastModifiedBy": str(config.raw["meta"]["workbook_creator"])}
    planned: list[tuple[Path, list[str], bool, list]] = []
    for path, names, combined in jobs:
        file_scope = f"file {path.name}"
        scopes = _scopes_for(config, names)
        base = [c for c in report.checks if c.scope in scopes]
        sheets = supporting_sheets(outcome, names, base)
        pre = validate_supporting(config, {s.title: s.rows for s in sheets}, metadata, deny, file_scope)
        # Rebuild with the pre-export checks listed, then re-check the final content.
        sheets = supporting_sheets(outcome, names, base + pre)
        pre = validate_supporting(config, {s.title: s.rows for s in sheets}, metadata, deny, file_scope)
        sheets = supporting_sheets(outcome, names, base + pre)
        report.extend(pre)
        planned.append((path, names, combined, sheets))
    if report.blocking:
        failures = [c for c in report.checks if c.category in ("logical", "privacy") and c.failed]
        summary = "; ".join(f"{c.scope}: {c.name} ({c.violations})" for c in failures[:10])
        raise ExportBlocked(f"export blocked by {len(failures)} failing logical/privacy check(s): {summary}")
    for path, names, combined, sheets in planned:
        if combined:
            tx = {f"Transactions {config.configurations[n].short}": outcome.frames[n] for n in names}
        else:
            tx = {"Transactions": outcome.frames[names[0]]}
        post = write_workbook(path, tx, sheets, outcome.schema, config, overwrite=outcome.options.overwrite,
                              generated_at=outcome.generated_at, denylist=deny if deny else None)
        for c in post:
            c.scope = f"file {path.name}"
        report.extend(post)
        outcome.files.append(path)
        log.info("wrote workbook: %d sheet(s), %d configuration(s)", len(tx) + len(sheets), len(names))
    outcome.timings["export"] = time.perf_counter() - t0
    if outcome.options.report and jobs:
        if outcome.options.output is not None:
            rp = Path(outcome.options.output).with_name(Path(outcome.options.output).stem + "_validation_report.md")
        else:
            rp = Path(outcome.options.output_dir) / "validation_report.md"  # type: ignore[arg-type]
        if rp.exists() and not outcome.options.overwrite:
            raise ExportBlocked(f"refusing to overwrite existing report '{rp.name}' (pass --overwrite)")
        rp.write_text(build_markdown(outcome), encoding="utf-8")
        outcome.report_path = rp
    return outcome


def run(options: RunOptions) -> RunOutcome:
    outcome = build(options)
    if options.export:
        export(outcome)
    return outcome


def summary_counts(outcome: RunOutcome) -> dict[str, int]:
    rep = outcome.report
    return {
        "logical_errors": rep.errors("logical"),
        "privacy_failures": rep.errors("privacy"),
        "stat_pass": rep.count("statistical", "PASS"),
        "stat_warn": rep.count("statistical", "WARN"),
        "stat_info": rep.count("statistical", "INFO"),
    }


__all__ = ["RunOptions", "RunOutcome", "build", "export", "run", "summary_counts", "CheckResult"]
