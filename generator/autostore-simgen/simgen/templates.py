"""Sequence templates: parsing, roles, transitions and per-configuration tables.

A template such as ``M-A-A-M`` fixes the ordered transaction types of one
cluster. Moves alternate GRID->PORT ("open") and PORT->GRID ("close");
everything between an open and its close is a middle action at the port.
Templates are picked whole; row types are never drawn independently.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cached_property

import numpy as np

from .config import Config, ConfigError

TYPE_NAMES = {
    "M": "Move",
    "A": "Adjust",
    "T": "Adjust TU",
    "D": "TU Dirty",
    "X": "TU Damaged",
    "CA": "Change Attribute",
    "CP": "Change Product",
    "U": "Unallocation",
}
CODE_OF_TYPE = {v: k for k, v in TYPE_NAMES.items()}
EVENT_CODES = ("D", "X", "CA", "CP", "U")
ADJUST_CODES = ("A", "T")
ALL_TRANSACTION_TYPES = tuple(TYPE_NAMES.values())


class TemplateError(ConfigError):
    """Raised for malformed templates."""


@dataclass(frozen=True)
class Template:
    """One curated cluster template."""

    code: str
    bucket: str  # "MAIN" or the rare library name
    steps: tuple[str, ...]
    roles: tuple[str, ...]  # "open", "close" or "middle" per step

    @property
    def length(self) -> int:
        return len(self.steps)

    @property
    def key(self) -> str:
        """Unique key within a configuration (template + bucket)."""
        return self.code if self.bucket == "MAIN" else f"{self.bucket}:{self.code}"

    @cached_property
    def has_adjust(self) -> bool:
        return any(s in ADJUST_CODES for s in self.steps)

    @cached_property
    def adjust_count(self) -> int:
        return sum(1 for s in self.steps if s in ADJUST_CODES)

    @cached_property
    def repeated_adjust(self) -> bool:
        return self.adjust_count >= 2

    @cached_property
    def is_exception(self) -> bool:
        return any(s in EVENT_CODES for s in self.steps)

    @cached_property
    def is_plain_mm(self) -> bool:
        return self.steps == ("M", "M")

    @cached_property
    def transitions(self) -> tuple[str, ...]:
        return tuple(transition_key(self.steps[i], self.roles[i], self.steps[i + 1], self.roles[i + 1])
                     for i in range(len(self.steps) - 1))

    @cached_property
    def type_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for s in self.steps:
            counts[TYPE_NAMES[s]] = counts.get(TYPE_NAMES[s], 0) + 1
        return counts

    @cached_property
    def type_sequence(self) -> str:
        return "|".join(TYPE_NAMES[s] for s in self.steps)

    @cached_property
    def contains_x(self) -> bool:
        return "X" in self.steps

    @cached_property
    def contains_d(self) -> bool:
        return "D" in self.steps


def parse_template(code: str, bucket: str = "MAIN") -> Template:
    steps = tuple(code.split("-"))
    for s in steps:
        if s not in TYPE_NAMES:
            raise TemplateError(f"template {code}: unknown step '{s}'")
    if len(steps) < 2 or steps[0] != "M" or steps[-1] != "M":
        raise TemplateError(f"template {code}: must start and end with a Move")
    roles: list[str] = []
    open_now = False
    for s in steps:
        if s == "M":
            roles.append("close" if open_now else "open")
            open_now = not open_now
        else:
            if not open_now:
                raise TemplateError(f"template {code}: middle action '{s}' while the bin is at the grid")
            roles.append("middle")
    if open_now:
        raise TemplateError(f"template {code}: must end with PORT->GRID")
    return Template(code=code, bucket=bucket, steps=steps, roles=tuple(roles))


def transition_key(a: str, role_a: str, b: str, role_b: str) -> str:
    """Name of the base-gap entry for the transition a -> b."""
    if a == "M" and role_a == "close":
        if b == "M" and role_b == "open":
            return "close_to_represent"
        raise TemplateError(f"invalid transition after a closing Move: {b}")
    if a == "M":  # open
        if b == "M":
            return "open_to_close"
        if b == "A":
            return "open_to_adjust"
        if b == "T":
            return "open_to_adjust_tu"
        return "open_to_event"
    if a == "A":
        if b == "A":
            return "adjust_to_adjust"
        if b == "M":
            return "adjust_to_close"
        if b == "T":
            return "adjust_tu_adjust"
        return "adjust_to_event"
    if a == "T":
        if b == "T":
            return "adjust_tu_to_adjust_tu"
        if b == "A":
            return "adjust_tu_adjust"
        if b == "M":
            return "adjust_tu_to_close"
        return "adjust_tu_to_event"
    return "event_to_next"


@dataclass
class TemplateTable:
    """Flattened template distribution for one configuration."""

    config_name: str
    templates: list[Template]
    table_probs: np.ndarray  # flattened probabilities straight from the configuration
    probs: np.ndarray  # after multipliers; M-M absorbs the difference

    @cached_property
    def index(self) -> dict[str, int]:
        return {t.key: i for i, t in enumerate(self.templates)}

    @cached_property
    def lengths(self) -> np.ndarray:
        return np.array([t.length for t in self.templates])

    @property
    def mean_rows(self) -> float:
        return float(np.dot(self.probs, self.lengths))

    def length_probabilities(self) -> dict[int, float]:
        out: dict[int, float] = {}
        for t, p in zip(self.templates, self.probs):
            out[t.length] = out.get(t.length, 0.0) + float(p)
        return out

    def expected_type_mix(self) -> dict[str, float]:
        """Row-level transaction-type shares implied by the template table."""
        totals: dict[str, float] = {name: 0.0 for name in ALL_TRANSACTION_TYPES}
        for t, p in zip(self.templates, self.probs):
            for name, n in t.type_counts.items():
                totals[name] += p * n
        rows = sum(totals.values())
        return {k: v / rows for k, v in totals.items() if v > 0}

    def bucket_probabilities(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for t, p in zip(self.templates, self.probs):
            out[t.bucket] = out.get(t.bucket, 0.0) + float(p)
        return out

    @property
    def transaction_types(self) -> set[str]:
        types: set[str] = set()
        for t in self.templates:
            types.update(t.type_counts)
        return types


def build_template_table(config: Config, config_name: str) -> TemplateTable:
    spec = config.configurations[config_name]
    libraries = config.raw["template_libraries"]
    templates: list[Template] = []
    probs: list[float] = []
    for key, p in spec.template_table.items():
        if key.startswith("RARE_"):
            for code, w in libraries[key].items():
                templates.append(parse_template(code, bucket=key))
                probs.append(float(p) * float(w))
        else:
            templates.append(parse_template(key))
            probs.append(float(p))
    keys = [t.key for t in templates]
    if len(set(keys)) != len(keys):
        raise TemplateError(f"{config_name}: duplicate template entries")
    base_gaps = config.raw["timing"]["base_gap_seconds"]
    for t in templates:
        for tr in t.transitions:
            if tr not in base_gaps:
                raise TemplateError(f"{config_name}: template {t.code} needs timing.base_gap_seconds.{tr}")
    table = np.array(probs, dtype=float)
    mm = [i for i, t in enumerate(templates) if t.is_plain_mm and t.bucket == "MAIN"]
    if len(mm) != 1:
        raise TemplateError(f"{config_name}: exactly one M-M template is required to absorb multipliers")
    mult = config.raw["template_multipliers"]
    adj_m = float(mult["adjustment_rate_multiplier"])
    exc_m = float(mult["exception_rate_multiplier"])
    adjusted = table.copy()
    for i, t in enumerate(templates):
        if t.has_adjust:
            adjusted[i] *= adj_m
        if t.is_exception:
            adjusted[i] *= exc_m
    others = adjusted.sum() - adjusted[mm[0]]
    adjusted[mm[0]] = 1.0 - others
    if adjusted[mm[0]] < 0:
        raise TemplateError(f"{config_name}: multipliers push M-M below zero ({adjusted[mm[0]]:.4f})")
    if not math.isclose(adjusted.sum(), 1.0, abs_tol=1e-9):
        raise TemplateError(f"{config_name}: template probabilities do not sum to 1 after multipliers")
    return TemplateTable(config_name=config_name, templates=templates, table_probs=table, probs=adjusted)
