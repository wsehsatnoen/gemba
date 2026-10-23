"""Synthetic employee populations with persistent behaviour profiles.

Each environment has a Cycle Count pool and a Bin Maintenance pool. A share of
each BM pool is cross-trained into CC in the same environment and keeps its BM
identifier. Profiles are drawn once per run from the ``employees`` streams and
never change: speed tier, variability, pause behaviour, tendencies, active
days and shift window are all fixed for the whole run.

Timing traits describe synthetic processing behaviour only; they are not a
judgement of anyone.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field

import numpy as np

from .config import Config, parse_clock
from .identifiers import employee_id
from .rng import StreamFactory
from .templates import TemplateTable


@dataclass
class EmployeeProfile:
    user_id: str
    environment: str
    home_config: str
    extra_configs: tuple[str, ...]
    raw_activity: dict[str, float]
    speed_tier: dict[str, str]
    speed_tier_index: dict[str, int]
    speed_multiplier: dict[str, float]
    timing_sigma: float
    variability: str
    long_pause_probability: dict[str, float]
    long_pause_multiplier_range: dict[str, tuple[float, float]]
    adjustment_tendency: float
    repeat_adjustment_tendency: float
    exception_tendency: float
    active_days: frozenset[dt.date]
    active_fraction: float
    shift_start: int  # seconds after midnight
    shift_end: int
    activity_weight: dict[str, float] = field(default_factory=dict)  # normalised within the workforce

    @property
    def configs(self) -> tuple[str, ...]:
        return (self.home_config,) + self.extra_configs

    @property
    def cross_trained(self) -> bool:
        return bool(self.extra_configs)

    def works(self, config_name: str) -> bool:
        return config_name == self.home_config or config_name in self.extra_configs

    def shift_distance(self, seconds: float) -> float:
        if seconds < self.shift_start:
            return self.shift_start - seconds
        if seconds > self.shift_end:
            return seconds - self.shift_end
        return 0.0


@dataclass
class EnvironmentWorkforce:
    environment: str
    employees: dict[str, EmployeeProfile]
    workforce: dict[str, list[str]]  # config -> employee ids able to work it
    expected_share: dict[str, dict[str, float]]  # config -> employee -> expected cluster share
    redraws: dict[str, int]

    def profiles_for(self, config_name: str) -> list[EmployeeProfile]:
        return [self.employees[e] for e in self.workforce[config_name]]


def _stratified_labels(rng: np.random.Generator, n: int, shares: list[float]) -> np.ndarray:
    """Exact-proportion label assignment (largest remainder), shuffled."""
    raw = np.array(shares) * n
    counts = np.floor(raw).astype(int)
    remainder = n - counts.sum()
    if remainder > 0:
        order = np.argsort(-(raw - counts), kind="stable")
        counts[order[:remainder]] += 1
    labels = np.repeat(np.arange(len(shares)), counts)
    rng.shuffle(labels)
    return labels


class ExposureModel:
    """Who is on shift when starts arrive, per date and time point.

    ``shares(weights)`` returns each employee's expected share of clusters if
    every start went to an on-shift employee with probability proportional to
    activity weight. It accounts for active days and shift windows exactly,
    which a simple weight x active-fraction product does not.
    """

    POINTS_PER_HOUR = 12

    def __init__(self, config: Config, config_name: str, profiles: list[EmployeeProfile]) -> None:
        dates = config.dates
        weights = config.configurations[config_name].hour_weights
        rows: list[np.ndarray] = []
        omegas: list[float] = []
        starts = np.array([p.shift_start for p in profiles])
        ends = np.array([p.shift_end for p in profiles])
        for d in dates:
            active = np.array([d in p.active_days for p in profiles])
            for hour, w in weights.items():
                if w <= 0:
                    continue
                for k in range(self.POINTS_PER_HOUR):
                    t = hour * 3600 + (k + 0.5) * 3600 / self.POINTS_PER_HOUR
                    mask = active & (starts <= t) & (t <= ends)
                    if not mask.any():
                        mask = active.copy() if active.any() else np.ones(len(profiles), dtype=bool)
                    rows.append(mask)
                    omegas.append(w / self.POINTS_PER_HOUR / len(dates))
        self.matrix = np.vstack(rows).astype(float) if rows else np.zeros((0, len(profiles)))
        self.omega = np.array(omegas)

    def shares(self, weights: np.ndarray) -> np.ndarray:
        if self.matrix.shape[0] == 0:
            return weights / weights.sum()
        m = self.matrix * weights[None, :]
        totals = m.sum(axis=1, keepdims=True)
        totals[totals == 0] = 1.0
        out = (self.omega[:, None] * m / totals).sum(axis=0)
        return out / out.sum()


def _top_share(values: np.ndarray, fraction: float) -> float:
    if values.sum() <= 0:
        return 0.0
    k = max(1, int(round(fraction * len(values))))
    return float(np.sort(values)[::-1][:k].sum() / values.sum())


def _draw_pool(config: Config, config_name: str, size: int, streams: StreamFactory,
               dates: list[dt.date]) -> list[EmployeeProfile]:
    spec = config.configurations[config_name]
    env = config.environments[spec.environment]
    emp_cfg = config.raw["employees"]
    rng = streams.stream("employees", config_name, "profiles")
    pmin, pmax = spec.pause_probability_range
    flo, fhi = spec.pause_factor_range
    inset = float(emp_cfg["long_pause_range_inset"])
    afrac_lo, afrac_hi = (float(x) for x in emp_cfg["active_day_fraction"])
    s0, s1 = (parse_clock(x) for x in emp_cfg["shift_start_window"])
    e0, e1 = (parse_clock(x) for x in emp_cfg["shift_end_window"])
    profiles: list[EmployeeProfile] = []
    for i in range(size):
        a = flo + rng.uniform(0, inset) * (fhi - flo)
        b = fhi - rng.uniform(0, inset) * (fhi - flo)
        frac = float(rng.uniform(afrac_lo, afrac_hi))
        n_days = max(1, int(round(frac * len(dates))))
        day_idx = rng.choice(len(dates), size=min(n_days, len(dates)), replace=False)
        profile = EmployeeProfile(
            user_id=employee_id(env.code, spec.workflow, i + 1),
            environment=spec.environment,
            home_config=config_name,
            extra_configs=(),
            raw_activity={config_name: 1.0},
            speed_tier={},  # assigned by _assign_tiers once activity weights are known
            speed_tier_index={},
            speed_multiplier={},
            timing_sigma=0.0,  # assigned by _assign_tiers with the variability category
            variability="",
            long_pause_probability={config_name: float(rng.uniform(pmin, pmax))},
            long_pause_multiplier_range={config_name: (float(min(a, b)), float(max(a, b)))},
            adjustment_tendency=float(rng.lognormal(0.0, float(emp_cfg["adjustment_tendency_sigma"]))),
            repeat_adjustment_tendency=float(rng.lognormal(0.0, float(emp_cfg["repeat_adjustment_tendency_sigma"]))),
            exception_tendency=float(rng.lognormal(0.0, float(emp_cfg["exception_tendency_sigma"]))),
            active_days=frozenset(dates[int(j)] for j in day_idx),
            active_fraction=len(day_idx) / len(dates),
            shift_start=int(rng.integers(s0, s1 + 1)),
            shift_end=int(rng.integers(e0, e1 + 1)),
        )
        profiles.append(profile)
    return profiles


def _assign_activity(config: Config, config_name: str, pool: list[EmployeeProfile],
                     fixed: list[EmployeeProfile], streams: StreamFactory) -> int:
    """Draw lognormal activity weights for ``pool`` (re-drawing into the band).

    ``fixed`` employees (cross-trained) already carry a weight for this
    configuration and are part of the workforce when the expected top share is
    evaluated. Returns the number of re-draws used.
    """
    emp_cfg = config.raw["employees"]
    sigma = float(emp_cfg["activity_weight_sigma"])
    lo, hi = (float(x) for x in emp_cfg["top_share_redraw_band"])
    frac = float(emp_cfg["top_share_fraction"])
    max_redraws = int(emp_cfg["top_share_max_redraws"])
    rng = streams.stream("employees", config_name, "activity")
    exposure = ExposureModel(config, config_name, pool + fixed)
    fixed_raw = np.array([p.raw_activity[config_name] for p in fixed])
    best = None
    best_gap = math.inf
    used = 0
    for attempt in range(max_redraws + 1):
        weights = rng.lognormal(0.0, sigma, size=len(pool))
        shares = exposure.shares(np.concatenate([weights, fixed_raw]))
        share = _top_share(shares, frac)
        gap = 0.0 if lo <= share <= hi else min(abs(share - lo), abs(share - hi))
        if gap < best_gap:
            best, best_gap, used = weights, gap, attempt
        if gap == 0.0:
            break
    assert best is not None
    for p, w in zip(pool, best):
        p.raw_activity[config_name] = float(w)
    return used


def _deal_labels(shares_cfg: np.ndarray, pool_ids: list[str], share: dict[str, float],
                 fixed_labels: list[tuple[str, int]], rng: np.random.Generator, balanced: bool) -> dict[str, int]:
    """Exact per-label counts; balanced dealing tracks the share-weighted label mix."""
    labels_count = len(shares_cfg)
    counts = np.bincount(_stratified_labels(rng, len(pool_ids), list(shares_cfg)), minlength=labels_count)
    if not balanced:
        seq = _stratified_labels(rng, len(pool_ids), list(shares_cfg))
        return {e: int(t) for e, t in zip(pool_ids, seq)}
    assigned = np.zeros(labels_count)
    for e, t in fixed_labels:
        assigned[t] += share[e]
    total = sum(share[e] for e in pool_ids) + sum(share[e] for e, _ in fixed_labels)
    remaining = counts.copy()
    out: dict[str, int] = {}
    for e in sorted(pool_ids, key=lambda x: -share[x]):
        deficit = np.maximum(shares_cfg * total - assigned, 0.0) * (remaining > 0)
        if deficit.sum() <= 0:
            deficit = (remaining > 0).astype(float)
        t = int(rng.choice(labels_count, p=deficit / deficit.sum()))
        out[e] = t
        remaining[t] -= 1
        assigned[t] += share[e]
    return out


def _assign_tiers(config: Config, config_name: str, pool: list[EmployeeProfile],
                  fixed: list[EmployeeProfile], streams: StreamFactory) -> None:
    """Assign speed tiers and variability categories with exact per-label counts.

    With ``tier_assignment: activity_balanced`` (default) employees are taken
    in descending expected cluster share and each draws a label with
    probability proportional to that label's remaining share-weighted deficit,
    so the cluster-weighted mix matches the configured shares instead of
    depending on which label the few busiest employees happen to get.
    ``random`` shuffles the labels with no regard to activity.
    """
    emp_cfg = config.raw["employees"]
    tiers = emp_cfg["speed_tiers"]
    cats = emp_cfg["variability_categories"]
    rng = streams.stream("employees", config_name, "tiers")
    jitter = float(emp_cfg["speed_multiplier_jitter"])
    balanced = str(emp_cfg.get("tier_assignment", "activity_balanced")) == "activity_balanced"
    model = ExposureModel(config, config_name, pool + fixed)
    weights = np.array([p.raw_activity[config_name] for p in pool + fixed])
    share = dict(zip([p.user_id for p in pool + fixed], model.shares(weights)))
    ids = [p.user_id for p in pool]
    tier_of = _deal_labels(np.array([float(t["share"]) for t in tiers]), ids, share,
                           [(p.user_id, p.speed_tier_index[config_name]) for p in fixed], rng, balanced)
    cat_index = {c["name"]: i for i, c in enumerate(cats)}
    fixed_cats = [(p.user_id, cat_index[p.variability]) for p in fixed if p.variability in cat_index]
    cat_of = _deal_labels(np.array([float(c["share"]) for c in cats]), ids, share, fixed_cats, rng, balanced)
    for p in pool:
        t = tier_of[p.user_id]
        p.speed_tier[config_name] = str(tiers[t]["name"])
        p.speed_tier_index[config_name] = t
        p.speed_multiplier[config_name] = float(tiers[t]["multiplier"]) * float(rng.uniform(1 - jitter, 1 + jitter))
        cat = cats[cat_of[p.user_id]]
        lo, hi = (float(x) for x in cat["sigma_range"])
        p.variability = str(cat["name"])
        p.timing_sigma = float(rng.uniform(lo, hi))


def build_workforce(config: Config, env_name: str, streams: StreamFactory,
                    pool_sizes: dict[str, int] | None = None) -> EnvironmentWorkforce:
    """Build both pools of an environment plus cross-training."""
    dates = config.dates
    cc_name = next(c for c, s in config.configurations.items() if s.environment == env_name and s.workflow == "CC")
    bm_name = next(c for c, s in config.configurations.items() if s.environment == env_name and s.workflow == "BM")
    sizes = {c: config.configurations[c].pool_size for c in (cc_name, bm_name)}
    if pool_sizes:
        sizes.update({k: v for k, v in pool_sizes.items() if k in sizes})
    emp_cfg = config.raw["employees"]
    bm_pool = _draw_pool(config, bm_name, sizes[bm_name], streams, dates)
    cc_pool = _draw_pool(config, cc_name, sizes[cc_name], streams, dates)
    redraws: dict[str, int] = {}
    redraws[bm_name] = _assign_activity(config, bm_name, bm_pool, [], streams)
    _assign_tiers(config, bm_name, bm_pool, [], streams)

    # Cross-training: a share of the BM pool also works CC, keeping BM IDs.
    xrng = streams.stream("employees", bm_name, "cross_training")
    n_cross = int(round(float(emp_cfg["cross_trained_fraction"]) * len(bm_pool)))
    cross_idx = sorted(xrng.choice(len(bm_pool), size=n_cross, replace=False).tolist()) if n_cross else []
    tiers = emp_cfg["speed_tiers"]
    shift_table = {int(k): float(v) for k, v in emp_cfg["cross_trained_tier_shift"].items()}
    shifts = np.array(sorted(shift_table))
    shift_p = np.array([shift_table[s] for s in shifts])
    cc_spec = config.configurations[cc_name]
    jitter = float(emp_cfg["speed_multiplier_jitter"])
    inset = float(emp_cfg["long_pause_range_inset"])
    scale = float(emp_cfg["cross_trained_activity_scale"])
    cross_profiles: list[EmployeeProfile] = []
    for i in cross_idx:
        p = bm_pool[i]
        bm_tier = p.speed_tier_index[bm_name]
        shift = int(xrng.choice(shifts, p=shift_p))
        cc_tier = int(min(max(bm_tier + shift, 0), len(tiers) - 1))
        flo, fhi = cc_spec.pause_factor_range
        a = flo + xrng.uniform(0, inset) * (fhi - flo)
        b = fhi - xrng.uniform(0, inset) * (fhi - flo)
        p.extra_configs = (cc_name,)
        p.speed_tier[cc_name] = str(tiers[cc_tier]["name"])
        p.speed_tier_index[cc_name] = cc_tier
        p.speed_multiplier[cc_name] = float(tiers[cc_tier]["multiplier"]) * float(xrng.uniform(1 - jitter, 1 + jitter))
        p.long_pause_probability[cc_name] = float(xrng.uniform(*cc_spec.pause_probability_range))
        p.long_pause_multiplier_range[cc_name] = (float(min(a, b)), float(max(a, b)))
        p.raw_activity[cc_name] = p.raw_activity[bm_name] * scale
        cross_profiles.append(p)
    redraws[cc_name] = _assign_activity(config, cc_name, cc_pool, cross_profiles, streams)
    _assign_tiers(config, cc_name, cc_pool, cross_profiles, streams)

    employees = {p.user_id: p for p in cc_pool + bm_pool}
    workforce = {
        cc_name: [p.user_id for p in cc_pool] + [p.user_id for p in cross_profiles],
        bm_name: [p.user_id for p in bm_pool],
    }
    expected: dict[str, dict[str, float]] = {}
    for cfg_name, ids in workforce.items():
        raw = np.array([employees[e].raw_activity[cfg_name] for e in ids])
        for e, w in zip(ids, raw / raw.sum()):
            employees[e].activity_weight[cfg_name] = float(w)
        model = ExposureModel(config, cfg_name, [employees[e] for e in ids])
        shares = model.shares(raw)
        expected[cfg_name] = {e: float(x) for e, x in zip(ids, shares)}
    return EnvironmentWorkforce(environment=env_name, employees=employees, workforce=workforce,
                                expected_share=expected, redraws=redraws)


def tendency_factors(profile: EmployeeProfile, table: TemplateTable) -> np.ndarray:
    """Multiplicative tilt of each template for one employee."""
    out = np.ones(len(table.templates))
    for j, t in enumerate(table.templates):
        f = 1.0
        if t.has_adjust:
            f *= profile.adjustment_tendency
        if t.repeated_adjust:
            f *= profile.repeat_adjustment_tendency
        if t.is_exception:
            f *= profile.exception_tendency
        out[j] = f
    return out


def employee_template_distributions(table: TemplateTable, profiles: list[EmployeeProfile],
                                    shares: dict[str, float], iterations: int = 500) -> dict[str, np.ndarray]:
    """Per-employee template probabilities whose share-weighted average equals the table.

    Employee tendencies tilt templates multiplicatively (multinomial-logit
    style, so every probability stays valid); per-template intercepts are then
    fitted by iterative proportional fitting so the population average matches
    the configured (multiplier-adjusted) table exactly.
    """
    target = table.probs
    ids = [p.user_id for p in profiles]
    s = np.array([shares[e] for e in ids])
    s = s / s.sum()
    f = np.vstack([tendency_factors(p, table) for p in profiles])  # employees x templates
    c = np.ones(len(target))
    active = target > 0
    for _ in range(iterations):
        w = f * (c * target)[None, :]
        q = w / w.sum(axis=1, keepdims=True)
        avg = s @ q
        if np.max(np.abs(avg - target)) < 1e-13:
            break
        ratio = np.ones_like(c)
        ratio[active] = target[active] / np.maximum(avg[active], 1e-300)
        c *= ratio
    w = f * (c * target)[None, :]
    q = w / w.sum(axis=1, keepdims=True)
    return {e: q[i] for i, e in enumerate(ids)}
