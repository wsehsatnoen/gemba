"""End-to-end cluster generation.

Order of work per environment (the requested configurations of an
environment are generated together so they share ports and cross-trained
employees):

workforce -> per-employee template mixes -> duration calibration ->
joint scheduling (template + gaps per scheduled cluster) -> exact row/cluster
selection -> populations sized to the selected volume -> chronological state
pass (TUs, quantities, products, lots, statuses, reasons, updaters).

Clusters are complete objects at every stage; rows are produced only by the
row expander from finished clusters.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import numpy as np

from .config import Config
from .employees import EnvironmentWorkforce, build_workforce, employee_template_distributions
from .populations import ProductPool, TUPopulation, build_populations
from .quantity_state import ClusterRecord, RunCounters, Segment, StatePass, StateStats
from .rng import StreamFactory
from .rowcount import InsufficientPoolError, SelectionResult, planned_clusters, select_exact_rows
from .scheduling import EnvironmentScheduler, ScheduleStats, Skeleton, peak_port_utilization
from .templates import TemplateTable, build_template_table
from .timing import Calibration, TimingModel, calibrate

log = logging.getLogger(__name__)


@dataclass
class ConfigResult:
    name: str
    records: list[ClusterRecord]
    segments: list[Segment]
    tus: TUPopulation
    products: ProductPool
    table: TemplateTable
    calibration: Calibration
    template_dists: dict[str, np.ndarray]
    schedule_stats: ScheduleStats
    state_stats: StateStats
    selection: SelectionResult | None
    planned_clusters: int
    scheduled_clusters: int

    @property
    def n_rows(self) -> int:
        return sum(len(r.rows) for r in self.records)


@dataclass
class EnvironmentResult:
    name: str
    workforce: EnvironmentWorkforce
    configs: dict[str, ConfigResult]
    used_configs: list[str]
    peak_utilization: float = 0.0
    peak_hour: int = 18


@dataclass
class GenerationResult:
    seed: int
    mode: str  # "rows" or "clusters"
    target: int
    config_names: list[str]
    environments: dict[str, EnvironmentResult]
    timings: dict[str, float] = field(default_factory=dict)

    def config(self, name: str) -> ConfigResult:
        for env in self.environments.values():
            if name in env.configs:
                return env.configs[name]
        raise KeyError(name)

    def workforce_of(self, name: str) -> EnvironmentWorkforce:
        for env in self.environments.values():
            if name in env.configs:
                return env.workforce
        raise KeyError(name)


def generate(config: Config, config_names: list[str], mode: str, target: int, seed: int) -> GenerationResult:
    """Generate complete clusters for the requested configurations."""
    if mode not in ("rows", "clusters"):
        raise ValueError("mode must be 'rows' or 'clusters'")
    if target < 1:
        raise ValueError("target must be at least 1")
    streams = StreamFactory(seed)
    counters = RunCounters()
    used_starts: set[int] = set()
    timings: dict[str, float] = {}
    envs: dict[str, EnvironmentResult] = {}
    ordered = [c for c in config.configurations if c in config_names]
    for env_name in ("AMBIENT", "COOLER"):
        names = config.configs_in_environment(env_name, ordered)
        if not names:
            continue
        t0 = time.perf_counter()
        workforce = build_workforce(config, env_name, streams)
        tables = {c: build_template_table(config, c) for c in names}
        dists = {c: employee_template_distributions(tables[c], workforce.profiles_for(c),
                                                    workforce.expected_share[c]) for c in names}
        cals = {c: calibrate(config, c, tables[c], workforce.profiles_for(c), workforce.expected_share[c],
                             dists[c], streams.stream("calibration", c)) for c in names}
        timing_models = {c: TimingModel(config, c, tables[c], cals[c]) for c in names}
        for c in names:
            log.info("calibration %s: scale=%.4f pause_scale=%.4f status=%s",
                     config.configurations[c].short, cals[c].scale, cals[c].pause_scale, cals[c].status)
        timings[f"{env_name}.calibration"] = time.perf_counter() - t0

        rows_cfg = config.raw["run"]["rows_mode"]
        margin = float(rows_cfg["overgeneration_margin"])
        extra = int(rows_cfg["overgeneration_extra_clusters"])
        selections: dict[str, SelectionResult | None] = {}
        kept: dict[str, list[Skeleton]] = {}
        plans: dict[str, int] = {}
        schedule = None
        for attempt in range(4):
            t1 = time.perf_counter()
            if mode == "rows":
                plans = {c: planned_clusters(target, tables[c].mean_rows, margin * (2 ** attempt), extra * (2 ** attempt))
                         for c in names}
            else:
                plans = {c: target for c in names}
            scheduler = EnvironmentScheduler(config, env_name, names, workforce, tables, dists, timing_models,
                                             streams, set(used_starts))
            schedule = scheduler.run(plans)
            timings[f"{env_name}.scheduling"] = time.perf_counter() - t1
            if mode == "clusters":
                for c in names:
                    kept[c] = schedule.skeletons[c]
                    selections[c] = None
                break
            try:
                for c in names:
                    sel = select_exact_rows(schedule.skeletons[c], target, tables[c].length_probabilities(),
                                            streams.stream("selection", c),
                                            int(rows_cfg["dp_threshold_rows"]), int(rows_cfg["max_backoff_clusters"]))
                    selections[c] = sel
                    kept[c] = sel.kept
                break
            except InsufficientPoolError:
                log.info("re-planning %s with a larger cluster pool", env_name)
                continue
        else:  # pragma: no cover - four doublings of the margin always suffice
            raise RuntimeError("could not schedule enough clusters for the requested row count")
        assert schedule is not None
        for c in names:
            used_starts.update(s.start_ms for s in kept[c])
        peak, peak_hour = peak_port_utilization(config, env_name, {c: len(kept[c]) for c in names},
                                                {c: cals[c].sample_mean * cals[c].timing_multiplier for c in names})
        warn_level = float(config.raw["scheduling"]["capacity_warning_utilization"])
        if peak > warn_level:
            log.warning("%s: expected busiest-hour port utilisation %.0f%% at %dh exceeds %.0f%%; starts will be "
                        "pushed later and hour/port shares will drift - extend the date range or lower the volume",
                        env_name, peak * 100, peak_hour, warn_level * 100)

        t2 = time.perf_counter()
        tus, products = build_populations(config, env_name, {c: len(kept[c]) for c in names}, streams)
        results: dict[str, ConfigResult] = {}
        for c in names:
            sp = StatePass(config, c, tus[c], products, streams, counters)
            records = sp.run(kept[c])
            results[c] = ConfigResult(
                name=c, records=records, segments=sp.segments, tus=tus[c], products=products, table=tables[c],
                calibration=cals[c], template_dists=dists[c], schedule_stats=schedule.stats[c],
                state_stats=sp.stats, selection=selections[c], planned_clusters=plans[c],
                scheduled_clusters=len(schedule.skeletons[c]),
            )
            log.info("%s: %d clusters, %d rows", config.configurations[c].short, len(records), results[c].n_rows)
        timings[f"{env_name}.state"] = time.perf_counter() - t2
        envs[env_name] = EnvironmentResult(name=env_name, workforce=workforce, configs=results, used_configs=names,
                                           peak_utilization=peak, peak_hour=peak_hour)

    # Cluster numbers in chronological order across the run.
    all_records = [r for env in envs.values() for c in env.configs.values() for r in c.records]
    all_records.sort(key=lambda r: (r.start_ms, r.config))
    for n, rec in enumerate(all_records, start=1):
        rec.cluster_number = n
    return GenerationResult(seed=seed, mode=mode, target=target, config_names=ordered, environments=envs,
                            timings=timings)
