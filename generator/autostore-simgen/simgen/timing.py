"""Within-cluster timing and duration calibration.

gap = base_gap(transition) x calibration_scale(config) x employee_speed
      x lognormal(0, employee_sigma) x optional long-pause factor

A long pause, when triggered for a cluster, multiplies one randomly chosen gap
by a factor drawn from the employee's personal range. Gaps are rounded to
milliseconds, floored at the minimum gap and capped at the maximum.

Before generating, :func:`calibrate` simulates a large internal sample built
from the run's actual employee population and solves two numbers per
configuration:

* ``scale`` multiplies every gap and sets the median duration;
* ``pause_scale`` sets the P90. It first multiplies every employee's long-pause
  probability (their relative propensity is kept) until the population-average
  pause rate reaches ``max_mean_pause_rate``; past that point it lengthens
  pauses by multiplying each employee's factor range. The P90 is monotone in
  this one parameter, so a bisection solves it.

Normal distributions are never used for gaps.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .balanced import BalancedSampler
from .config import Config
from .employees import EmployeeProfile
from .stats_utils import icc1
from .templates import Template, TemplateTable


@dataclass
class Calibration:
    config_name: str
    scale: float
    pause_scale: float
    frequency_cap_scale: float  # pause_scale value at which the frequency part saturates
    target_median: float
    target_p90: float
    achieved_median: float
    achieved_p90: float
    sample_clusters: int
    sample_pause_rate: float
    base_pause_rate: float
    status: str
    sample_mean: float = 0.0
    sample_icc: float = float("nan")  # expected ICC for this population (log template-normalised)
    timing_multiplier: float = 1.0
    pause_multiplier: float = 1.0

    @property
    def effective_scale(self) -> float:
        return self.scale * self.timing_multiplier

    @property
    def effective_pause_scale(self) -> float:
        return self.pause_scale * self.pause_multiplier

    def components(self) -> tuple[float, float]:
        """(frequency multiplier, magnitude multiplier) of the effective pause scale."""
        return pause_components(self.effective_pause_scale, self.frequency_cap_scale)

    def as_dict(self) -> dict[str, object]:
        out = asdict(self)
        freq, mag = self.components()
        out.update(effective_scale=self.effective_scale, effective_pause_scale=self.effective_pause_scale,
                   pause_frequency_multiplier=freq, pause_magnitude_multiplier=mag)
        return out


def pause_components(k: float, k_cap: float) -> tuple[float, float]:
    if k <= k_cap:
        return k, 1.0
    return k_cap, k / k_cap


class TimingModel:
    """Draws millisecond gaps for one configuration."""

    def __init__(self, config: Config, config_name: str, table: TemplateTable, calibration: Calibration) -> None:
        timing = config.raw["timing"]
        base = timing["base_gap_seconds"]
        self.config_name = config_name
        self.base = {t.key: np.array([float(base[tr]) for tr in t.transitions]) for t in table.templates}
        self.min_ms = int(round(float(timing["min_gap_seconds"]) * 1000))
        self.max_ms = int(round(float(timing["max_gap_seconds"]) * 1000))
        self.max_pause_p = float(timing["calibration"]["max_pause_probability"])
        self.scale = calibration.effective_scale
        self.freq_mult, self.mag_mult = calibration.components()
        # Pause decisions are balanced so the realised pause count tracks the
        # sum of per-cluster pause probabilities (removes binomial noise that
        # would otherwise move the P90 by several percent).
        self.pause_sampler = BalancedSampler(("no", "yes"), config.balance_gain())

    def pause_probability(self, profile: EmployeeProfile) -> float:
        return min(profile.long_pause_probability[self.config_name] * self.freq_mult, self.max_pause_p)

    def gaps_ms(self, rng: np.random.Generator, template: Template, profile: EmployeeProfile) -> tuple[np.ndarray, bool]:
        base = self.base[template.key]
        n = len(base)
        noise = np.exp(profile.timing_sigma * rng.standard_normal(n))
        gaps = base * self.scale * profile.speed_multiplier[self.config_name] * noise
        p = self.pause_probability(profile)
        paused = self.pause_sampler.draw(rng, np.array([1.0 - p, p])) == 1
        if paused:
            lo, hi = profile.long_pause_multiplier_range[self.config_name]
            gaps[int(rng.integers(n))] *= rng.uniform(lo, hi) * self.mag_mult
        ms = np.clip(np.rint(gaps * 1000.0), self.min_ms, self.max_ms).astype(np.int64)
        return ms, paused


def calibrate(config: Config, config_name: str, table: TemplateTable, profiles: list[EmployeeProfile],
              shares: dict[str, float], template_dists: dict[str, np.ndarray],
              rng: np.random.Generator) -> Calibration:
    """Solve calibration_scale and pause_scale so median and P90 hit targets."""
    spec = config.configurations[config_name]
    timing = config.raw["timing"]
    cal = timing["calibration"]
    n = int(cal["sample_clusters"])
    max_p = float(cal["max_pause_probability"])
    max_mean_rate = float(cal["max_mean_pause_rate"])
    max_mag = float(cal["max_magnitude_multiplier"])
    iterations = int(cal["iterations"])
    base_gaps = timing["base_gap_seconds"]
    min_ms = int(round(float(timing["min_gap_seconds"]) * 1000))
    max_ms = int(round(float(timing["max_gap_seconds"]) * 1000))
    target_med = spec.duration_median_target
    target_p90 = spec.duration_p90_target

    ids = [p.user_id for p in profiles]
    by_id = {p.user_id: p for p in profiles}
    s = np.array([shares[e] for e in ids])
    s = s / s.sum()
    emp_idx = rng.choice(len(ids), size=n, p=s)
    tmpl_idx = np.empty(n, dtype=int)
    for i, e in enumerate(ids):
        mask = emp_idx == i
        m = int(mask.sum())
        if m:
            tmpl_idx[mask] = rng.choice(len(table.templates), size=m, p=template_dists[e])
    max_gaps = max(t.length for t in table.templates) - 1
    base = np.zeros((n, max_gaps))
    valid = np.zeros((n, max_gaps), dtype=bool)
    n_gaps = np.zeros(n, dtype=int)
    for j, t in enumerate(table.templates):
        mask = tmpl_idx == j
        vec = np.array([float(base_gaps[tr]) for tr in t.transitions])
        base[mask, : len(vec)] = vec
        valid[mask, : len(vec)] = True
        n_gaps[mask] = len(vec)

    def per_cluster(fn) -> np.ndarray:
        return np.array([fn(by_id[e]) for e in ids])[emp_idx]

    speed = per_cluster(lambda p: p.speed_multiplier[config_name])
    sigma = per_cluster(lambda p: p.timing_sigma)
    p_base = per_cluster(lambda p: p.long_pause_probability[config_name])
    f_lo = per_cluster(lambda p: p.long_pause_multiplier_range[config_name][0])
    f_hi = per_cluster(lambda p: p.long_pause_multiplier_range[config_name][1])
    z = rng.standard_normal((n, max_gaps))
    u_pause = rng.random(n)
    pause_gap = np.minimum((rng.random(n) * n_gaps).astype(int), n_gaps - 1)
    factor = f_lo + rng.random(n) * (f_hi - f_lo)
    unit = base * speed[:, None] * np.exp(sigma[:, None] * z)
    rows = np.arange(n)
    k_cap = max_mean_rate / float(p_base.mean())
    k_max = k_cap * max_mag

    def durations(scale: float, k: float) -> tuple[np.ndarray, np.ndarray]:
        freq, mag = pause_components(k, k_cap)
        paused = u_pause < np.minimum(p_base * freq, max_p)
        g = unit * scale
        g[rows[paused], pause_gap[paused]] *= factor[paused] * mag
        ms = np.clip(np.rint(g * 1000.0), min_ms, max_ms)
        ms[~valid] = 0
        return ms.sum(axis=1) / 1000.0, paused

    def solve_scale(k: float) -> tuple[float, np.ndarray, np.ndarray]:
        scale = 1.0
        d, paused = durations(scale, k)
        for _ in range(40):
            med = float(np.median(d))
            ratio = target_med / med
            if abs(ratio - 1.0) < 1e-7:
                break
            scale *= ratio
            d, paused = durations(scale, k)
        return scale, d, paused

    status = "converged"
    scale, d, paused = solve_scale(0.0)
    k = 0.0
    if float(np.percentile(d, 90)) >= target_p90:
        status = "P90 already at or above target without long pauses; pause scale set to 0"
    else:
        s_hi, d_hi, p_hi = solve_scale(k_max)
        if float(np.percentile(d_hi, 90)) < target_p90:
            k, scale, d, paused = k_max, s_hi, d_hi, p_hi
            status = "P90 target not reachable within the configured bounds; pause scale at its upper bound"
        else:
            lo, hi = 0.0, k_max
            k, scale, d, paused = k_max, s_hi, d_hi, p_hi
            for _ in range(iterations):
                mid = 0.5 * (lo + hi)
                sm, dm, pm = solve_scale(mid)
                if float(np.percentile(dm, 90)) < target_p90:
                    lo = mid
                else:
                    hi = mid
                k, scale, d, paused = mid, sm, dm, pm
                if hi - lo < 1e-6 * max(1.0, hi):
                    break
    post = config.raw.get("post_calibration", {})
    norm = np.empty(n)
    for j in range(len(table.templates)):
        mask = tmpl_idx == j
        if mask.any():
            norm[mask] = d[mask] / np.median(d[mask])
    sample_icc = icc1(emp_idx, np.log(norm))
    return Calibration(
        config_name=config_name,
        scale=float(scale),
        pause_scale=float(k),
        frequency_cap_scale=float(k_cap),
        target_median=target_med,
        target_p90=target_p90,
        achieved_median=float(np.median(d)),
        achieved_p90=float(np.percentile(d, 90)),
        sample_clusters=n,
        sample_pause_rate=float(paused.mean()),
        base_pause_rate=float(p_base.mean()),
        status=status,
        sample_mean=float(np.mean(d)),
        sample_icc=float(sample_icc),
        timing_multiplier=float(post.get("timing_multiplier", 1.0)),
        pause_multiplier=float(post.get("pause_multiplier", 1.0)),
    )
