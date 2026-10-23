"""Exact row-count selection.

In ``target_rows`` mode the scheduler plans slightly more clusters than the
target needs. Selection then walks the scheduled clusters in random order,
keeping each one while the remaining gap is at least ``dp_threshold_rows``.
The remainder (fewer than 12 rows) is solved with a small dynamic program over
the enabled template lengths (2, 3, 4, 5 rows) that picks the most probable
combination of lengths, and the matching number of still-unused scheduled
clusters of exactly those lengths is kept. Clusters are never truncated or
modified; unused scheduled clusters are dropped whole.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .scheduling import Skeleton


class ExactRowCountError(RuntimeError):
    """The requested row total cannot be reached exactly."""


class InsufficientPoolError(RuntimeError):
    """The scheduled pool holds fewer rows than requested (re-plan larger)."""


@dataclass
class SelectionResult:
    kept: list[Skeleton]
    steered: int
    dropped: int
    backoff: int
    remainder: int


def planned_clusters(target_rows: int, mean_rows: float, margin: float, extra: int) -> int:
    return int(math.ceil(target_rows / mean_rows * (1.0 + margin))) + int(extra)


def solve_remainder(remainder: int, available: dict[int, int], length_probs: dict[int, float]) -> list[int] | None:
    """Most probable multiset of lengths summing to ``remainder``.

    Score = sum of log P(length); ties prefer fewer clusters. ``available``
    caps how many clusters of each length can be used.
    """
    if remainder == 0:
        return []
    lengths = sorted(l for l, n in available.items() if n > 0 and length_probs.get(l, 0.0) > 0)
    neg_inf = -math.inf
    # dp[x] = (score, count, combination)
    best: list[tuple[float, int, tuple[int, ...]] | None] = [None] * (remainder + 1)
    best[0] = (0.0, 0, ())
    for l in lengths:
        logp = math.log(length_probs[l])
        cap = min(available[l], remainder // l)
        new = list(best)
        for x in range(remainder + 1):
            if best[x] is None:
                continue
            score, cnt, combo = best[x]
            for k in range(1, cap + 1):
                y = x + k * l
                if y > remainder:
                    break
                cand = (score + k * logp, cnt + k, combo + (l,) * k)
                cur = new[y]
                if cur is None or cand[0] > cur[0] + 1e-12 or (abs(cand[0] - cur[0]) <= 1e-12 and cand[1] < cur[1]):
                    new[y] = cand
        best = new
    return list(best[remainder][2]) if best[remainder] is not None and best[remainder][0] > neg_inf else None


def achievable_neighbours(target: int, lengths: list[int]) -> tuple[int | None, int | None]:
    """Nearest totals below/above ``target`` reachable with the given lengths."""
    if not lengths:
        return None, None
    limit = target + max(lengths) * 2 + 1
    reach = [False] * (limit + 1)
    reach[0] = True
    for x in range(limit + 1):
        if reach[x]:
            for l in lengths:
                if x + l <= limit:
                    reach[x + l] = True
    below = next((x for x in range(target, -1, -1) if reach[x]), None)
    above = next((x for x in range(target, limit + 1) if reach[x]), None)
    return below, above


def select_exact_rows(skeletons: list[Skeleton], target_rows: int, length_probs: dict[int, float],
                      rng: np.random.Generator, threshold: int, max_backoff: int) -> SelectionResult:
    if target_rows < 0:
        raise ExactRowCountError("target rows must be non-negative")
    total = sum(s.length for s in skeletons)
    enabled = sorted(l for l, p in length_probs.items() if p > 0)
    if total < target_rows:
        raise InsufficientPoolError(f"scheduled pool holds {total} rows, {target_rows} requested")
    order = rng.permutation(len(skeletons))
    taken: list[int] = []
    acc = 0
    pos = 0
    while pos < len(order) and target_rows - acc >= threshold:
        idx = int(order[pos])
        taken.append(idx)
        acc += skeletons[idx].length
        pos += 1
    if target_rows - acc >= threshold:
        raise InsufficientPoolError("scheduled pool exhausted before the remainder solver threshold")
    pool = [int(i) for i in order[pos:]]
    backoff = 0
    while True:
        remainder = target_rows - acc
        available: dict[int, int] = {}
        for i in pool:
            available[skeletons[i].length] = available.get(skeletons[i].length, 0) + 1
        combo = solve_remainder(remainder, available, length_probs)
        if combo is not None:
            break
        if not taken or backoff >= max_backoff:
            below, above = achievable_neighbours(target_rows, enabled)
            raise ExactRowCountError(
                f"no exact solution for {target_rows} rows with template lengths {enabled}; "
                f"nearest achievable totals are {below} and {above}")
        idx = taken.pop()
        acc -= skeletons[idx].length
        pool.insert(0, idx)
        backoff += 1
    chosen: list[int] = []
    need: dict[int, int] = {}
    for l in combo:
        need[l] = need.get(l, 0) + 1
    for i in pool:
        l = skeletons[i].length
        if need.get(l, 0) > 0:
            chosen.append(i)
            need[l] -= 1
    if any(v > 0 for v in need.values()):  # pragma: no cover - guarded by availability
        raise ExactRowCountError("internal error: remainder solver picked unavailable lengths")
    keep = sorted(taken + chosen, key=lambda i: skeletons[i].start_ms)
    kept = [skeletons[i] for i in keep]
    if sum(s.length for s in kept) != target_rows:  # pragma: no cover - defensive
        raise ExactRowCountError("internal error: selected rows do not match the target")
    return SelectionResult(kept=kept, steered=len(chosen), dropped=len(skeletons) - len(kept),
                           backoff=backoff, remainder=target_rows - acc)
