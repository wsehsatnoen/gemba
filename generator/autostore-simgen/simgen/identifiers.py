"""Synthetic identifier formats and the patterns used to enforce them.

Every identifier written to the Transactions sheet is produced by one of the
formatters below and must match one of the approved patterns. Nothing here is
derived from real data: populations are numbered from 1.
"""

from __future__ import annotations

import re

SYSTEM_USER = "system"

# Approved identifier patterns (anchored).
PATTERNS: dict[str, re.Pattern[str]] = {
    "employee": re.compile(r"^SIMUSR-(AMB|CLR)-(CC|BM)-\d{3}$"),
    "system_user": re.compile(r"^system$"),
    "tu": re.compile(r"^SIMTU-(AMB|CLR)-\d{6}$"),
    "product": re.compile(r"^SIMSKU-(AMB|CLR)-\d{6}$"),
    "lot": re.compile(r"^SIMLOT-\d{6}$"),
    "order": re.compile(r"^SIMORD-\d{8}$"),
    "transaction": re.compile(r"^SIMTX-\d{9}$"),
    "cluster": re.compile(r"^SIMCL-\d{7}$"),
    "lu": re.compile(r"^SIMLU-\d{9}$"),
    "grid_location": re.compile(r"^SIM_(AMBIENT|COOLER)_GRID$"),
    "port_location": re.compile(r"^(SIM_AMBIENT_PORT_(0[1-9]|1[0-6])|SIM_COOLER_PORT_0[1-7])$"),
}

ID_LIMITS = {
    "employee": 999,
    "tu": 999_999,
    "product": 999_999,
    "lot": 999_999,
    "order": 99_999_999,
    "transaction": 999_999_999,
    "cluster": 9_999_999,
    "lu": 999_999_999,
}


class IdentifierOverflow(ValueError):
    """Raised when a population outgrows its identifier format."""


def _check(kind: str, number: int) -> None:
    if not 1 <= number <= ID_LIMITS[kind]:
        raise IdentifierOverflow(f"{kind} number {number} outside 1..{ID_LIMITS[kind]}")


def employee_id(env_code: str, workflow: str, number: int) -> str:
    _check("employee", number)
    return f"SIMUSR-{env_code}-{workflow}-{number:03d}"


def tu_id(env_code: str, number: int) -> str:
    _check("tu", number)
    return f"SIMTU-{env_code}-{number:06d}"


def product_id(env_code: str, number: int) -> str:
    _check("product", number)
    return f"SIMSKU-{env_code}-{number:06d}"


def lot_id(number: int) -> str:
    _check("lot", number)
    return f"SIMLOT-{number:06d}"


def order_id(number: int) -> str:
    _check("order", number)
    return f"SIMORD-{number:08d}"


def transaction_id(number: int) -> str:
    _check("transaction", number)
    return f"SIMTX-{number:09d}"


def cluster_id(number: int) -> str:
    _check("cluster", number)
    return f"SIMCL-{number:07d}"


def lu_id(number: int) -> str:
    _check("lu", number)
    return f"SIMLU-{number:09d}"


def matches(kind: str, value: str) -> bool:
    return bool(PATTERNS[kind].match(value))


def env_code_of(identifier: str) -> str | None:
    """Return AMB/CLR for environment-scoped identifiers, else None."""
    for code in ("AMB", "CLR"):
        if f"-{code}-" in identifier:
            return code
    if identifier.startswith("SIM_AMBIENT_"):
        return "AMB"
    if identifier.startswith("SIM_COOLER_"):
        return "CLR"
    return None


class Counter:
    """Monotonic counter shared across configurations of one run."""

    def __init__(self) -> None:
        self._value = 0

    def next(self) -> int:
        self._value += 1
        return self._value

    @property
    def value(self) -> int:
        return self._value
