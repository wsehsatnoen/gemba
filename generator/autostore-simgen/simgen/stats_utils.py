"""Small statistics helpers shared by calibration and validation."""

from __future__ import annotations

import numpy as np
import pandas as pd


def icc1(groups: np.ndarray, values: np.ndarray) -> float:
    """One-way random-effects ICC(1) with the unbalanced-group n0 adjustment."""
    df = pd.DataFrame({"g": groups, "y": values})
    stats = df.groupby("g")["y"].agg(["mean", "count", "var"])
    stats = stats[stats["count"] >= 2]
    if len(stats) < 2:
        return float("nan")
    n_total = stats["count"].sum()
    k = len(stats)
    grand = np.average(stats["mean"], weights=stats["count"])
    msb = float((stats["count"] * (stats["mean"] - grand) ** 2).sum() / (k - 1))
    msw = float(((stats["count"] - 1) * stats["var"]).sum() / (n_total - k))
    n0 = (n_total - (stats["count"] ** 2).sum() / n_total) / (k - 1)
    denom = msb + (n0 - 1) * msw
    return float((msb - msw) / denom) if denom > 0 else float("nan")


def lower_median(values: np.ndarray) -> float:
    v = np.sort(np.asarray(values))
    if len(v) == 0:
        return float("nan")
    return float(v[(len(v) - 1) // 2])
