"""Privacy validation (zero failures required).

* Allowlist check on every string cell of each Transactions sheet.
* Identifier pattern and environment compliance per column.
* Secondary pattern scans (email, phone, IP, URL, paths, long tokens) on every
  sheet and the workbook metadata.
* Optional deny-list scan (pass/fail and match count only).
* Workbook metadata check.

Only aggregate counts are reported; offending values are never printed.
"""

from __future__ import annotations

import datetime as dt
from typing import Iterable

import numpy as np
import pandas as pd

from ..config import Config
from ..identifiers import env_code_of
from ..schema import SchemaDefinition
from ..security import DenylistMatcher, Vocabulary, long_token_pattern, scan_text
from .results import FAIL, INFO, PASS, CheckResult

ENV_SCOPED_KINDS = {"tu", "product", "employee", "grid_location", "port_location"}


def _res(scope: str, name: str, violations: int, detail: str = "", status: str | None = None) -> CheckResult:
    return CheckResult("privacy", scope, name, status or (PASS if violations == 0 else FAIL), int(violations), detail)


def _value_counts(series: pd.Series) -> pd.Series:
    return series.dropna().value_counts()


def validate_transactions(config: Config, name: str, df: pd.DataFrame, schema: SchemaDefinition,
                          vocab: Vocabulary, denylist: DenylistMatcher) -> list[CheckResult]:
    spec = config.configurations[name]
    env = config.environments[spec.environment]
    scope = spec.short
    token_re = long_token_pattern(int(config.raw["validation"]["pattern_scan"]["long_token_min_length"]))
    allow_bad = 0
    allow_cols = 0
    env_bad = 0
    type_bad = 0
    pattern_hits: dict[str, int] = {}
    deny_hits = 0
    for col in schema.columns:
        series = df[col.key]
        counts = _value_counts(series)
        if counts.empty:
            continue
        if col.dtype == "string":
            col_bad = 0
            for value, n in counts.items():
                if not isinstance(value, str):
                    col_bad += int(n)
                    continue
                if not col.value_kinds or not any(vocab.allowed(k, value) for k in col.value_kinds):
                    col_bad += int(n)
                    continue
                if any(k in ENV_SCOPED_KINDS for k in col.value_kinds) and value != config.system_user:
                    code = env_code_of(value)
                    if code is not None and code != env.code:
                        env_bad += int(n)
                for hit in scan_text(value, token_re):
                    pattern_hits[hit] = pattern_hits.get(hit, 0) + int(n)
                if denylist and denylist.matches(value):
                    deny_hits += int(n)
            if col_bad:
                allow_cols += 1
                allow_bad += col_bad
        else:
            for value, n in counts.items():
                ok = True
                if col.dtype == "int":
                    ok = isinstance(value, (int, np.integer)) and not isinstance(value, bool)
                elif col.dtype == "date":
                    ok = isinstance(value, dt.date) and not isinstance(value, dt.datetime)
                elif col.dtype == "datetime":
                    ok = isinstance(value, (pd.Timestamp, dt.datetime, np.datetime64))
                if not ok:
                    type_bad += int(n)
                if denylist and denylist.matches(str(value)):
                    deny_hits += int(n)
    checks = [
        _res(scope, "Allowlist: every string cell is an approved identifier or vocabulary value", allow_bad,
             f"{allow_cols} column(s) with violations"),
        _res(scope, "Identifier patterns match the configuration's environment", env_bad),
        _res(scope, "Typed columns hold only integers, dates or timestamps", type_bad),
        _res(scope, "Secondary pattern scan (email, phone, IP, URL, path, token)", sum(pattern_hits.values()),
             ", ".join(f"{k}: {v}" for k, v in sorted(pattern_hits.items())) or "no matches"),
    ]
    if denylist:
        checks.append(_res(scope, "Deny-list scan", deny_hits, f"{deny_hits} matching cell(s)"))
    else:
        checks.append(_res(scope, "Deny-list scan", 0, "no deny-list supplied", status=INFO))
    return checks


def iter_strings(rows: Iterable[Iterable[object]]) -> Iterable[str]:
    for row in rows:
        for v in row:
            if isinstance(v, str):
                yield v


def validate_supporting(config: Config, sheets: dict[str, list[list[object]]], metadata: dict[str, str],
                        denylist: DenylistMatcher, scope: str) -> list[CheckResult]:
    token_re = long_token_pattern(int(config.raw["validation"]["pattern_scan"]["long_token_min_length"]))
    hits: dict[str, int] = {}
    deny = 0
    for rows in sheets.values():
        for value in iter_strings(rows):
            for h in scan_text(value, token_re):
                hits[h] = hits.get(h, 0) + 1
            if denylist and denylist.matches(value):
                deny += 1
        for row in rows:
            for v in row:
                if denylist and not isinstance(v, str) and v is not None and denylist.matches(str(v)):
                    deny += 1
    meta_hits = 0
    for value in metadata.values():
        if isinstance(value, str):
            meta_hits += len(scan_text(value, token_re))
            if denylist and denylist.matches(value):
                deny += 1
    checks = [
        _res(scope, "Secondary pattern scan of supporting sheets", sum(hits.values()),
             ", ".join(f"{k}: {v}" for k, v in sorted(hits.items())) or "no matches"),
        _res(scope, "Secondary pattern scan of workbook metadata", meta_hits),
    ]
    expected = str(config.raw["meta"]["workbook_creator"])
    meta_bad = 0
    for key in ("creator", "lastModifiedBy"):
        if metadata.get(key) != expected:
            meta_bad += 1
    extra = [k for k, v in metadata.items() if k not in ("creator", "lastModifiedBy", "created", "modified") and v]
    meta_bad += len(extra)
    checks.append(_res(scope, "Workbook metadata: creator/last-modified-by set, no personal properties", meta_bad))
    if denylist:
        checks.append(_res(scope, "Deny-list scan of supporting sheets and metadata", deny, f"{deny} match(es)"))
    return checks
