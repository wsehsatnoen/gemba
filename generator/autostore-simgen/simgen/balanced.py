"""Deficit-corrected categorical sampling.

Plain independent draws give realised shares that wander by
``sqrt(p(1-p)/n)``. For rare categories (a 0.2% template, a status that only
applies to a few dozen clusters) that wander is larger than the validation
tolerance. :class:`BalancedSampler` keeps a running tally of expected and
realised counts and tilts each draw toward categories that are behind, so
realised shares track the configured shares closely while every individual
draw stays random.

``gain`` controls the tilt; 0 reproduces plain independent sampling.
"""

from __future__ import annotations

import numpy as np


class BalancedSampler:
    """Draw categories so realised counts track cumulative expected counts."""

    def __init__(self, categories: list[str] | tuple[str, ...], gain: float) -> None:
        self.categories = tuple(categories)
        self.index = {c: i for i, c in enumerate(self.categories)}
        self.k = len(self.categories)
        self.gain = float(gain)
        self.expected = np.zeros(self.k)
        self.realized = np.zeros(self.k)

    def draw(
        self,
        rng: np.random.Generator,
        base: np.ndarray | None = None,
        target: np.ndarray | None = None,
        allowed: np.ndarray | None = None,
        record: bool = True,
    ) -> int:
        """Return the index of the drawn category.

        ``base`` is this draw's own probability vector (for example an
        employee-specific template mix). ``target`` is the population-level
        vector whose cumulative sum the realised counts should follow
        (defaults to ``base``). ``allowed`` masks categories that are not
        permitted for this particular draw; the target still accrues in full,
        so other draws make up the difference.
        """
        if base is None and target is None:
            raise ValueError("base or target probabilities are required")
        if base is None:
            base = target
        if target is None:
            target = base
        if self.gain > 0:
            deficit = self.expected + target - self.realized
            weights = base * np.exp(np.clip(self.gain * deficit, -30.0, 30.0))
        else:
            weights = np.array(base, dtype=float, copy=True)
        if allowed is not None:
            weights = weights * allowed
        total = weights.sum()
        if not np.isfinite(total) or total <= 0:
            # Every permitted category has zero base probability; fall back to
            # the permitted set itself.
            weights = np.ones(self.k) if allowed is None else allowed.astype(float)
            total = weights.sum()
        u = rng.random() * total
        idx = int(np.searchsorted(np.cumsum(weights), u, side="right"))
        idx = min(idx, self.k - 1)
        if record:
            self.expected += target
            self.realized[idx] += 1
        return idx

    def draw_label(self, rng: np.random.Generator, base: np.ndarray, **kwargs: object) -> str:
        return self.categories[self.draw(rng, base, **kwargs)]

    def record_outcome(self, target: np.ndarray, realized_index: int) -> None:
        """Record an outcome that was decided outside :meth:`draw`."""
        self.expected += target
        self.realized[realized_index] += 1

    def correct_last(self, drawn_index: int, realized_index: int) -> None:
        """Move one realised count when a drawn outcome was altered later."""
        if drawn_index != realized_index:
            self.realized[drawn_index] -= 1
            self.realized[realized_index] += 1


class BinarySampler:
    """Balanced yes/no draws with a fixed probability."""

    def __init__(self, probability: float, gain: float) -> None:
        self.p = float(probability)
        self._sampler = BalancedSampler(("no", "yes"), gain)
        self._vec = np.array([1.0 - self.p, self.p])

    def draw(self, rng: np.random.Generator) -> bool:
        if self.p <= 0.0:
            self._sampler.record_outcome(self._vec, 0)
            return False
        if self.p >= 1.0:
            self._sampler.record_outcome(self._vec, 1)
            return True
        return self._sampler.draw(rng, self._vec) == 1

    def record(self, outcome: bool) -> None:
        self._sampler.record_outcome(self._vec, 1 if outcome else 0)
