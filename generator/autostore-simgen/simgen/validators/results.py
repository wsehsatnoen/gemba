"""Shared result types for the validators."""

from __future__ import annotations

from dataclasses import dataclass, field

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"
INFO = "INFO"


@dataclass
class CheckResult:
    category: str  # logical | privacy | statistical
    scope: str  # configuration short name, environment, or "run"
    name: str
    status: str
    violations: int = 0
    detail: str = ""
    target: str = ""
    actual: str = ""
    tolerance: str = ""

    @property
    def failed(self) -> bool:
        return self.status == FAIL


@dataclass
class ValidationReport:
    checks: list[CheckResult] = field(default_factory=list)

    def add(self, check: CheckResult) -> None:
        self.checks.append(check)

    def extend(self, checks: list[CheckResult]) -> None:
        self.checks.extend(checks)

    def of(self, category: str, scope: str | None = None) -> list[CheckResult]:
        return [c for c in self.checks if c.category == category and (scope is None or c.scope == scope)]

    def errors(self, category: str, scope: str | None = None) -> int:
        return sum(c.violations for c in self.of(category, scope) if c.status == FAIL)

    def failures(self, category: str, scope: str | None = None) -> list[CheckResult]:
        return [c for c in self.of(category, scope) if c.status == FAIL]

    def count(self, category: str, status: str, scope: str | None = None) -> int:
        return sum(1 for c in self.of(category, scope) if c.status == status)

    @property
    def blocking(self) -> bool:
        return any(c.failed for c in self.checks if c.category in ("logical", "privacy"))
