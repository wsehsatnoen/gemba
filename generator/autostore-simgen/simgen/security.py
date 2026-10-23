"""Security controls: allowlist, secondary pattern scans, deny-list, metadata.

The allowlist is the primary privacy control: every string cell in a
Transactions sheet must match an approved identifier pattern or belong to a
declared vocabulary for its column. The secondary scans (email, phone, IP,
URL, Windows/Unix path, long token) run over every sheet and the workbook
metadata as defence in depth. Results are aggregate counts only; offending
values are never logged or printed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .config import Config
from .identifiers import PATTERNS
from .templates import ALL_TRANSACTION_TYPES

SECONDARY_PATTERNS: dict[str, re.Pattern[str]] = {
    "email address": re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"),
    "phone number": re.compile(
        r"(?<![\w\-])(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]\d{3}[\s.\-]\d{4}(?![\w\-])"
        r"|(?<!\d)\+?\d{10,15}(?!\d)"),
    "IP address": re.compile(r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])"),
    "URL": re.compile(r"(?i)\b(?:https?|ftp|file)://|\bwww\.[a-z0-9\-]+\."),
    "Windows path": re.compile(r"(?i)(?<![a-z])[a-z]:\\|\\\\[\w.\-]+\\"),
    "Unix path": re.compile(r"(?:^|[\s\"'(=,])(?:~|\.{1,2})?(?:/[\w.\-]+){2,}"),
}

# Kinds that map to identifier regexes; everything else is a vocabulary.
REGEX_KINDS = {
    "employee", "system_user", "tu", "product", "lot", "order", "transaction", "cluster", "lu",
    "grid_location", "port_location",
}


def long_token_pattern(min_length: int) -> re.Pattern[str]:
    # A run of base64/hex-like characters containing at least one letter and one digit.
    return re.compile(rf"(?=[A-Za-z0-9+/=_\-.]{{{min_length},}})(?=[^\s]*[A-Za-z])(?=[^\s]*\d)[A-Za-z0-9+/=_\-.]{{{min_length},}}")


@dataclass
class Vocabulary:
    sets: dict[str, frozenset[str]]

    def allowed(self, kind: str, value: str) -> bool:
        if kind in REGEX_KINDS:
            return bool(PATTERNS[kind].match(value))
        return value in self.sets.get(kind, frozenset())


def build_vocabulary(config: Config) -> Vocabulary:
    raw = config.raw
    statuses: set[str] = set()
    for key in ("default", "tu_damaged_cluster", "tu_dirty_cluster"):
        statuses.update(raw["material_status"][key])
    statuses.update(v["to_status"] for v in raw["material_status"]["adjust_reason_changes"].values())
    reasons: set[str] = set()
    for prof in raw["adjust_reason_profiles"].values():
        reasons.update(prof)
    reasons.update(raw["adjust_tu"]["reasons"])
    reasons.add(raw["change_attribute"]["reason"])
    consts = raw["constants"]
    sets = {
        "transaction_type": frozenset(ALL_TRANSACTION_TYPES),
        "operation": frozenset(s.operation for s in config.configurations.values()),
        "material_status": frozenset(statuses),
        "reason_code": frozenset(reasons),
        "reason_description": frozenset(str(raw["reason_descriptions"][r]) for r in reasons),
        "bin_type": frozenset(raw["bins"]["types"]),
        "unit_of_measure": frozenset([str(consts["unit_of_measure"])]),
        "zone": frozenset(e.zone for e in config.environments.values()),
        "owner": frozenset([str(consts["owner"])]),
        "site": frozenset([str(consts["site"])]),
        "transaction_source": frozenset([str(consts["transaction_source"])]),
    }
    return Vocabulary(sets=sets)


def load_denylist(path: str | Path | None) -> list[str]:
    """Read a local deny-list (one value per line; blank lines and '#' comments ignored)."""
    if not path:
        return []
    values: list[str] = []
    with Path(path).open("r", encoding="utf-8") as fh:
        for line in fh:
            v = line.strip()
            if v and not v.startswith("#"):
                values.append(v)
    return values


class DenylistMatcher:
    """Case-insensitive matcher; strings match on substring, numbers on exact text."""

    def __init__(self, values: list[str]) -> None:
        self.values = [v for v in values if v]
        self.lower = {v.lower() for v in self.values}
        chunks = []
        for i in range(0, len(self.values), 500):
            part = "|".join(re.escape(v) for v in sorted(self.values[i:i + 500], key=len, reverse=True))
            chunks.append(re.compile(part, re.IGNORECASE))
        self.patterns = chunks

    def __bool__(self) -> bool:
        return bool(self.values)

    def matches(self, text: str) -> bool:
        if not self.values:
            return False
        if text.lower() in self.lower:
            return True
        return any(p.search(text) for p in self.patterns)


def scan_text(value: str, token_re: re.Pattern[str]) -> list[str]:
    """Names of the secondary patterns found in ``value`` (never the matches)."""
    hits = [name for name, pat in SECONDARY_PATTERNS.items() if pat.search(value)]
    if token_re.search(value):
        hits.append("long token")
    return hits


ALLOWED_METADATA_KEYS = {"creator", "lastModifiedBy", "created", "modified"}
