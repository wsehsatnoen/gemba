"""Scheduling: dates, start times, port assignment and employee assignment.

Scheduling runs per environment. When both workflows of an environment are
generated together they share one calendar: ports are physical, and
cross-trained employees work both workflows, so neither may be double-booked
across configurations.

Per date:

1. Each configuration samples its start times from its hour weights.
2. Every active employee gets a port per configuration for the date (sticky
   with the previous working date; new draws lean toward ports that are behind
   their target share).
3. Start times are processed in order. Each goes to an idle employee whose
   shift window contains it, weighted by activity weight. If nobody is idle the
   start is pushed to the earliest moment an employee frees up plus a handoff
   gap. If the chosen employee's port is still occupied, the start waits for
   the port plus a handoff gap.
4. The template is drawn from the employee's own template mix and the gaps
   from the employee's timing profile, which fixes the cluster's duration and
   the busy intervals of employee and port.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np

from .balanced import BalancedSampler
from .config import Config, parse_clock
from .employees import EnvironmentWorkforce
from .rng import StreamFactory
from .templates import Template, TemplateTable
from .timing import TimingModel

EPOCH = dt.datetime(1970, 1, 1)


class SchedulingCapacityError(RuntimeError):
    """Raised when the requested volume does not fit the date range."""


def day_start_ms(date: dt.date) -> int:
    return int((dt.datetime(date.year, date.month, date.day) - EPOCH).total_seconds()) * 1000


@dataclass
class Skeleton:
    """A scheduled cluster before TU/product/quantity assignment."""

    config: str
    date: dt.date
    start_ms: int
    gaps_ms: np.ndarray
    employee: str
    port: int
    template: Template
    paused: bool
    pushed: bool
    planned_start_ms: int

    @property
    def duration_ms(self) -> int:
        return int(self.gaps_ms.sum())

    @property
    def end_ms(self) -> int:
        return self.start_ms + self.duration_ms

    @property
    def length(self) -> int:
        return self.template.length

    def timestamps_ms(self) -> np.ndarray:
        return self.start_ms + np.concatenate([[0], np.cumsum(self.gaps_ms)])


@dataclass
class ScheduleStats:
    pushed_no_idle: int = 0
    pushed_port_wait: int = 0
    shift_fallbacks: int = 0
    port_wait_ms_total: int = 0
    starts_total: int = 0


@dataclass
class ScheduleResult:
    skeletons: dict[str, list[Skeleton]]
    stats: dict[str, ScheduleStats]
    port_assignments: dict[str, dict[str, dict[dt.date, int]]] = field(default_factory=dict)


def peak_port_utilization(config: Config, env_name: str, plans: dict[str, int],
                          mean_durations: dict[str, float]) -> tuple[float, int]:
    """Expected busiest-hour port utilisation for the planned volume.

    Sums, per start hour, the expected port-seconds of every configuration in
    the environment (clusters per date x hour share x (mean duration + mean
    handoff)) and divides by the ports' capacity. Values near or above 1 mean
    starts will be pushed later, which shifts the hour mix and port shares.
    """
    env = config.environments[env_name]
    n_dates = len(config.dates)
    lo, hi = (float(x) for x in config.raw["scheduling"]["handoff_gap_seconds"])
    handoff = 0.5 * (lo + hi)
    demand = {h: 0.0 for h in range(14, 21)}
    for c, n in plans.items():
        spec = config.configurations[c]
        per_day = n / n_dates
        for h, w in spec.hour_weights.items():
            demand[h] += per_day * w * (mean_durations[c] + handoff)
    util = {h: d / (env.port_count * 3600.0) for h, d in demand.items()}
    peak_hour = max(util, key=lambda h: util[h])
    return util[peak_hour], peak_hour


def date_quotas(n_clusters: int, n_dates: int, noise: float, rng: np.random.Generator) -> np.ndarray:
    """Equal share per date with +/-noise, integerised to sum to n_clusters."""
    if n_dates <= 0:
        raise ValueError("no dates")
    w = 1.0 + rng.uniform(-noise, noise, size=n_dates)
    raw = w / w.sum() * n_clusters
    counts = np.floor(raw).astype(int)
    remainder = n_clusters - int(counts.sum())
    if remainder > 0:
        order = np.argsort(-(raw - counts), kind="stable")
        counts[order[:remainder]] += 1
    return counts


def sample_start_offsets(n: int, hour_weights: dict[int, float], rng: np.random.Generator) -> np.ndarray:
    """Start offsets (ms after midnight) from hour weights, sorted."""
    if n == 0:
        return np.zeros(0, dtype=np.int64)
    hours = np.array(sorted(hour_weights))
    p = np.array([hour_weights[h] for h in hours], dtype=float)
    p = p / p.sum()
    chosen = rng.choice(hours, size=n, p=p)
    offsets = chosen.astype(np.int64) * 3_600_000 + rng.integers(0, 3_600_000, size=n)
    return np.sort(offsets)


class EnvironmentScheduler:
    """Joint scheduler for the requested configurations of one environment."""

    def __init__(self, config: Config, env_name: str, config_names: list[str], workforce: EnvironmentWorkforce,
                 tables: dict[str, TemplateTable], template_dists: dict[str, dict[str, np.ndarray]],
                 timing_models: dict[str, TimingModel], streams: StreamFactory,
                 used_starts: set[int]) -> None:
        self.config = config
        self.env = config.environments[env_name]
        self.config_names = config_names
        self.workforce = workforce
        self.tables = tables
        self.template_dists = template_dists
        self.timing = timing_models
        self.streams = streams
        self.used_starts = used_starts
        sched = config.raw["scheduling"]
        self.handoff_lo_ms = int(round(float(sched["handoff_gap_seconds"][0]) * 1000))
        self.handoff_hi_ms = int(round(float(sched["handoff_gap_seconds"][1]) * 1000))
        self.day_end_limit_ms = parse_clock(config.raw["run"]["day_end_limit"]) * 1000
        emp = config.raw["employees"]
        self.stickiness = float(emp["port_stickiness"])
        self.port_gain = float(emp["port_balance_gain"])
        self.policy = str(sched["port_busy_policy"])
        self.emp_gain = float(sched["employee_balance_gain"])
        self.port_select_gain = float(sched["port_balance_gain"])
        gain = config.balance_gain()
        self.template_samplers = {c: BalancedSampler([t.key for t in tables[c].templates], gain) for c in config_names}
        self.port_counts = {c: np.zeros(self.env.port_count) for c in config_names}
        self.port_expected = {c: np.zeros(self.env.port_count) for c in config_names}
        self.port_targets = {c: np.array(config.configurations[c].port_weights) for c in config_names}
        self.emp_expected: dict[str, dict[str, float]] = {c: {} for c in config_names}
        self.emp_realized: dict[str, dict[str, int]] = {c: {} for c in config_names}
        self.prev_port: dict[str, dict[str, int]] = {c: {} for c in config_names}

    # ------------------------------------------------------------------
    def _assign_ports(self, cfg_name: str, date: dt.date, active: list[str], expected_today: int,
                      rng: np.random.Generator) -> dict[str, int]:
        """Port per active employee for the date.

        Employees are handled heaviest expected load first. Each keeps their
        previous port with the configured stickiness unless at least half of
        their load would no longer fit that port's remaining share (cumulative
        target minus realised clusters, plus one average employee load of
        slack); otherwise they draw a port leaning toward ports behind target,
        restricted to ports where at least half their load fits when any do.
        """
        target = np.array(self.config.configurations[cfg_name].port_weights)
        shares = self.workforce.expected_share[cfg_name]
        raw = np.array([shares[e] for e in active], dtype=float)
        loads = raw / raw.sum() * expected_today if raw.sum() > 0 else np.zeros(len(active))
        load_of = dict(zip(active, loads))
        keep_roll = {e: rng.random() < self.stickiness for e in active}
        total_so_far = float(self.port_counts[cfg_name].sum())
        room = target * (total_so_far + expected_today) - self.port_counts[cfg_name]
        unit = max(expected_today / max(len(active), 1), 1e-9)
        assigned = np.zeros(self.env.port_count)
        result: dict[str, int] = {}
        for e in sorted(active, key=lambda x: (-load_of[x], x)):
            load = load_of[e]
            prev = self.prev_port[cfg_name].get(e)
            if prev is not None and keep_roll[e] and assigned[prev - 1] + 0.5 * load <= room[prev - 1] + unit:
                port = prev
            else:
                deficit = room - assigned
                w = target * np.exp(np.clip(self.port_gain * deficit / unit, -8.0, 8.0))
                fits = deficit >= 0.5 * load
                if fits.any():
                    w = w * fits
                w = w / w.sum()
                port = int(rng.choice(self.env.port_count, p=w)) + 1
            result[e] = port
            assigned[port - 1] += load
            self.prev_port[cfg_name][e] = port
        return result

    def _handoff(self, rng: np.random.Generator) -> int:
        return int(rng.integers(self.handoff_lo_ms, self.handoff_hi_ms + 1))

    # ------------------------------------------------------------------
    def run(self, plans: dict[str, int]) -> ScheduleResult:
        dates = self.config.dates
        noise = float(self.config.raw["run"]["clusters_per_date_noise"])
        quotas = {c: date_quotas(plans[c], len(dates), noise, self.streams.stream("scheduling", c, "quotas"))
                  for c in self.config_names}
        skeletons: dict[str, list[Skeleton]] = {c: [] for c in self.config_names}
        stats = {c: ScheduleStats() for c in self.config_names}
        port_log: dict[str, dict[str, dict[dt.date, int]]] = {c: {} for c in self.config_names}
        employees = self.workforce.employees
        for d_idx, date in enumerate(dates):
            base_ms = day_start_ms(date)
            iso = date.isoformat()
            events: list[tuple[int, int, str]] = []
            for c in self.config_names:
                offsets = sample_start_offsets(int(quotas[c][d_idx]), self.config.configurations[c].hour_weights,
                                               self.streams.stream("scheduling", c, iso, "starts"))
                events.extend((int(o), i, c) for i, o in enumerate(offsets))
            events.sort()
            active_by_cfg: dict[str, list[str]] = {}
            ports_by_cfg: dict[str, dict[str, int]] = {}
            for c in self.config_names:
                active = [e for e in self.workforce.workforce[c] if date in employees[e].active_days]
                if not active:
                    if quotas[c][d_idx] > 0:
                        raise SchedulingCapacityError(f"{c}: no employee is active on {iso}")
                    active_by_cfg[c] = []
                    ports_by_cfg[c] = {}
                    continue
                active_by_cfg[c] = active
                ports_by_cfg[c] = self._assign_ports(c, date, active, int(quotas[c][d_idx]),
                                                     self.streams.stream("scheduling", c, iso, "ports"))
                for e, p in ports_by_cfg[c].items():
                    port_log[c].setdefault(e, {})[date] = p
            pick_rng = {c: self.streams.stream("scheduling", c, iso, "assign") for c in self.config_names}
            tmpl_rng = {c: self.streams.stream("templates", c, iso) for c in self.config_names}
            time_rng = {c: self.streams.stream("timing", c, iso) for c in self.config_names}
            emp_free: dict[str, int] = {}
            port_free: dict[int, int] = {}
            never = -10**12
            for offset, _, c in events:
                rng = pick_rng[c]
                st = stats[c]
                st.starts_total += 1
                t = offset
                planned = offset
                active = active_by_cfg[c]
                ports_today = ports_by_cfg[c]
                candidates = [e for e in active
                              if employees[e].shift_start * 1000 <= t <= employees[e].shift_end * 1000]
                if not candidates:
                    st.shift_fallbacks += 1
                    dist = np.array([employees[e].shift_distance(t / 1000.0) for e in active])
                    best = dist.min()
                    candidates = [e for e, dd in zip(active, dist) if dd <= best + 60.0]
                # Running expectations used by the balancing factors.
                cand_w = np.array([employees[e].raw_activity[c] for e in candidates])
                exp_e = self.emp_expected[c]
                for e, share in zip(candidates, cand_w / cand_w.sum()):
                    exp_e[e] = exp_e.get(e, 0.0) + float(share)
                self.port_expected[c] += self.port_targets[c]

                def ready_time(e: str) -> int:
                    if self.policy == "reassign":
                        return max(emp_free.get(e, never), port_free.get(ports_today[e], never))
                    return emp_free.get(e, never)

                pushed = False
                idle = [e for e in candidates if ready_time(e) + self.handoff_lo_ms <= t]
                if not idle:
                    first_free = min(ready_time(e) for e in candidates)
                    t = max(t, first_free + self._handoff(rng))
                    idle = [e for e in candidates if ready_time(e) + self.handoff_lo_ms <= t]
                    pushed = True
                    st.pushed_no_idle += 1
                weights = np.array([employees[e].raw_activity[c] for e in idle], dtype=float)
                if self.emp_gain > 0 or self.port_select_gain > 0:
                    real_e = self.emp_realized[c]
                    port_def = self.port_expected[c] - self.port_counts[c]
                    tilt = np.array([self.emp_gain * (exp_e.get(e, 0.0) - real_e.get(e, 0))
                                     + self.port_select_gain * port_def[ports_today[e] - 1] for e in idle])
                    weights = weights * np.exp(np.clip(tilt - tilt.max(), -30.0, 0.0))
                e = idle[int(rng.choice(len(idle), p=weights / weights.sum()))]
                self.emp_realized[c][e] = self.emp_realized[c].get(e, 0) + 1
                port = ports_today[e]
                pf = port_free.get(port, never)
                if pf + self.handoff_lo_ms > t:
                    waited_from = t
                    t = pf + self._handoff(rng)
                    pushed = True
                    st.pushed_port_wait += 1
                    st.port_wait_ms_total += t - waited_from
                if t > self.day_end_limit_ms:
                    raise SchedulingCapacityError(
                        f"{c}: starts on {iso} spill past the day-end limit; extend the date range or reduce the volume")
                abs_start = base_ms + t
                while abs_start in self.used_starts:
                    abs_start += 1
                    t += 1
                self.used_starts.add(abs_start)
                table = self.tables[c]
                profile = employees[e]
                j = self.template_samplers[c].draw(tmpl_rng[c], base=self.template_dists[c][e], target=table.probs)
                template = table.templates[j]
                gaps, paused = self.timing[c].gaps_ms(time_rng[c], template, profile)
                end_rel = t + int(gaps.sum())
                emp_free[e] = end_rel
                port_free[port] = end_rel
                self.port_counts[c][port - 1] += 1
                skeletons[c].append(Skeleton(config=c, date=date, start_ms=abs_start, gaps_ms=gaps, employee=e,
                                             port=port, template=template, paused=paused, pushed=pushed,
                                             planned_start_ms=base_ms + planned))
        for c in self.config_names:
            skeletons[c].sort(key=lambda s: s.start_ms)
        return ScheduleResult(skeletons=skeletons, stats=stats, port_assignments=port_log)
