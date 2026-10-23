"""Configuration loading and validation.

All tunable values live in ``config/default.yaml``. This module loads the
file, applies command-line overrides, validates every probability table and
range, and exposes typed views (:class:`EnvironmentSpec`,
:class:`ConfigurationSpec`) that the generation code uses. Generation code
never hardcodes a parameter; it reads it from a :class:`Config`.
"""

from __future__ import annotations

import copy
import datetime as dt
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

import numpy as np
import yaml

PROB_TOL = 1e-9
PERCENT_TOL = 1e-7

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "default.yaml"

CONFIG_NAMES = (
    "AMBIENT_CYCLE_COUNT",
    "COOLER_CYCLE_COUNT",
    "AMBIENT_BIN_MAINTENANCE",
    "COOLER_BIN_MAINTENANCE",
)

# Hours that make up the "other" start-hour bucket (14h or 20h).
OTHER_HOURS = (14, 20)
ALL_START_HOURS = tuple(range(14, 21))


class ConfigError(ValueError):
    """Raised when the configuration file or an override is invalid."""


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise ConfigError(message)


def _check_probabilities(table: Mapping[str, float], where: str) -> None:
    _require(isinstance(table, Mapping) and len(table) > 0, f"{where}: expected a non-empty mapping")
    for key, value in table.items():
        _require(isinstance(value, (int, float)) and not isinstance(value, bool),
                 f"{where}.{key}: probability must be numeric")
        _require(0.0 <= float(value) <= 1.0, f"{where}.{key}: probability {value} outside [0, 1]")
    total = math.fsum(float(v) for v in table.values())
    _require(abs(total - 1.0) <= PROB_TOL, f"{where}: probabilities sum to {total!r}, expected 1")


def _check_range(values: Any, where: str, lo: float | None = None, hi: float | None = None) -> tuple[float, float]:
    _require(isinstance(values, (list, tuple)) and len(values) == 2, f"{where}: expected [low, high]")
    a, b = float(values[0]), float(values[1])
    _require(a <= b, f"{where}: low {a} greater than high {b}")
    if lo is not None:
        _require(a >= lo, f"{where}: low {a} below {lo}")
    if hi is not None:
        _require(b <= hi, f"{where}: high {b} above {hi}")
    return a, b


def parse_clock(text: str) -> int:
    """Parse ``HH:MM`` or ``HH:MM:SS`` into seconds after midnight."""
    parts = [int(p) for p in str(text).split(":")]
    _require(len(parts) in (2, 3), f"invalid clock value {text!r}")
    if len(parts) == 2:
        parts.append(0)
    h, m, s = parts
    _require(0 <= h < 24 and 0 <= m < 60 and 0 <= s < 60, f"invalid clock value {text!r}")
    return h * 3600 + m * 60 + s


@dataclass(frozen=True)
class EnvironmentSpec:
    """Physical environment (grid + ports + bin types)."""

    name: str
    code: str
    zone: str
    grid_location: str
    port_prefix: str
    port_count: int
    bin_type_names: tuple[str, ...]
    bin_type_probs: tuple[float, ...]
    lot_populated_probability: float
    expiry_offset_days: tuple[int, int]

    def port_location(self, port: int) -> str:
        return f"{self.port_prefix}{port:02d}"

    @property
    def port_locations(self) -> tuple[str, ...]:
        return tuple(self.port_location(p) for p in range(1, self.port_count + 1))


@dataclass(frozen=True)
class ConfigurationSpec:
    """One of the four workflow configurations."""

    name: str
    short: str
    environment: str
    workflow: str  # "CC" or "BM"
    operation: str
    pool_size: int
    port_weights: tuple[float, ...]  # index 0 = port 01
    template_table: dict[str, float]
    adjust_sign: dict[str, float]
    magnitude_profile: str
    reason_profile: str
    magnitude_median_target: int | None
    magnitude_p90_target: float | None
    hour_weights: dict[int, float]  # hours 14..20, "other" already split
    hour_other_share: float
    unique_bins_ratio: float
    unique_products_ratio: float
    duration_median_target: float
    duration_p90_target: float
    pause_probability_range: tuple[float, float]
    pause_factor_range: tuple[float, float]
    adjust_tu_zero_or_blank_rate: float | None

    @property
    def is_cycle_count(self) -> bool:
        return self.workflow == "CC"

    @property
    def is_bin_maintenance(self) -> bool:
        return self.workflow == "BM"


@dataclass
class Config:
    """Validated configuration plus typed views."""

    raw: dict[str, Any]
    environments: dict[str, EnvironmentSpec] = field(default_factory=dict)
    configurations: dict[str, ConfigurationSpec] = field(default_factory=dict)
    source_name: str = "default.yaml"

    # ----- convenience accessors -------------------------------------------------
    def section(self, *keys: str) -> Any:
        node: Any = self.raw
        for key in keys:
            node = node[key]
        return node

    @property
    def start_date(self) -> dt.date:
        return dt.date.fromisoformat(str(self.raw["run"]["start_date"]))

    @property
    def end_date(self) -> dt.date:
        return dt.date.fromisoformat(str(self.raw["run"]["end_date"]))

    @property
    def dates(self) -> list[dt.date]:
        days = (self.end_date - self.start_date).days
        return [self.start_date + dt.timedelta(days=i) for i in range(days + 1)]

    @property
    def notice_text(self) -> str:
        return str(self.raw["meta"]["notice_text"])

    @property
    def system_user(self) -> str:
        return str(self.raw["constants"]["system_user"])

    def env_of(self, config_name: str) -> EnvironmentSpec:
        return self.environments[self.configurations[config_name].environment]

    def configs_in_environment(self, env_name: str, selected: Iterable[str]) -> list[str]:
        return [c for c in selected if self.configurations[c].environment == env_name]

    def balance_gain(self) -> float:
        return float(self.raw["sampling"]["balance_gain"])

    def bin_max(self, bin_type: str) -> int:
        return int(self.raw["bins"]["types"][bin_type]["max_quantity"])


# ----------------------------------------------------------------------------------
# Loading
# ----------------------------------------------------------------------------------

def load_config(path: str | Path | None = None, overrides: Mapping[str, Any] | None = None) -> Config:
    """Load, override and validate a configuration file."""
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    _require(cfg_path.is_file(), f"configuration file not found: {cfg_path.name}")
    with cfg_path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    _require(isinstance(raw, dict), "configuration root must be a mapping")
    raw = copy.deepcopy(raw)
    if overrides:
        apply_overrides(raw, overrides)
    config = Config(raw=raw, source_name=cfg_path.name)
    _validate_and_build(config)
    return config


def apply_overrides(raw: dict[str, Any], overrides: Mapping[str, Any]) -> None:
    """Apply CLI-style overrides to the raw configuration (in place).

    Supported keys: ``start_date``, ``end_date``, ``employees`` (dict config ->
    pool size), ``bin_ratio`` / ``product_ratio`` (dict config -> ratio),
    ``repeat_bin_rate``, ``adjust_mult``, ``exception_mult``, ``timing_mult``,
    ``pause_mult``.
    """
    run = raw.setdefault("run", {})
    if overrides.get("start_date"):
        run["start_date"] = str(overrides["start_date"])
    if overrides.get("end_date"):
        run["end_date"] = str(overrides["end_date"])
    for cfg_name, size in (overrides.get("employees") or {}).items():
        raw["configurations"][cfg_name]["employee_pool_size"] = int(size)
    for cfg_name, ratio in (overrides.get("bin_ratio") or {}).items():
        raw["configurations"][cfg_name]["population_ratios"]["unique_bins"] = float(ratio)
    for cfg_name, ratio in (overrides.get("product_ratio") or {}).items():
        raw["configurations"][cfg_name]["population_ratios"]["unique_products"] = float(ratio)
    if overrides.get("repeat_bin_rate") is not None:
        raw["bin_day"]["repeat_rate"] = float(overrides["repeat_bin_rate"])
    if overrides.get("adjust_mult") is not None:
        raw["template_multipliers"]["adjustment_rate_multiplier"] = float(overrides["adjust_mult"])
    if overrides.get("exception_mult") is not None:
        raw["template_multipliers"]["exception_rate_multiplier"] = float(overrides["exception_mult"])
    post = raw.setdefault("post_calibration", {})
    post["timing_multiplier"] = float(overrides.get("timing_mult") or post.get("timing_multiplier", 1.0))
    post["pause_multiplier"] = float(overrides.get("pause_mult") or post.get("pause_multiplier", 1.0))


def _validate_and_build(config: Config) -> None:
    raw = config.raw
    for key in ("meta", "run", "sampling", "environments", "bins", "bin_day", "configurations",
                "template_libraries", "template_multipliers", "adjust_magnitude_profiles",
                "adjust_reason_profiles", "positive_adjust_forbidden_reasons", "adjust_tu",
                "change_attribute", "material_status", "reason_descriptions", "employees",
                "scheduling", "timing", "updaters", "constants", "validation"):
        _require(key in raw, f"missing configuration section '{key}'")
    post = raw.setdefault("post_calibration", {})
    post.setdefault("timing_multiplier", 1.0)
    post.setdefault("pause_multiplier", 1.0)
    _require(float(post["timing_multiplier"]) > 0, "timing multiplier must be positive")
    _require(float(post["pause_multiplier"]) >= 0, "pause multiplier must be non-negative")

    # --- run ---------------------------------------------------------------------
    run = raw["run"]
    try:
        start = dt.date.fromisoformat(str(run["start_date"]))
        end = dt.date.fromisoformat(str(run["end_date"]))
    except ValueError as exc:  # pragma: no cover - defensive
        raise ConfigError(f"invalid run date: {exc}") from exc
    _require(start <= end, "run.start_date must not be after run.end_date")
    _require(0.0 <= float(run["clusters_per_date_noise"]) < 1.0, "run.clusters_per_date_noise must be in [0, 1)")
    parse_clock(run["day_end_limit"])
    rows_mode = run["rows_mode"]
    _require(int(rows_mode["dp_threshold_rows"]) >= 2, "rows_mode.dp_threshold_rows must be >= 2")
    _require(float(rows_mode["overgeneration_margin"]) >= 0, "rows_mode.overgeneration_margin must be >= 0")
    _require(int(rows_mode["overgeneration_extra_clusters"]) >= 0, "overgeneration_extra_clusters must be >= 0")
    _require(int(rows_mode["max_backoff_clusters"]) >= 1, "max_backoff_clusters must be >= 1")
    _require(float(raw["sampling"]["balance_gain"]) >= 0, "sampling.balance_gain must be >= 0")

    # --- environments ------------------------------------------------------------
    bin_types = raw["bins"]["types"]
    for env_name, env in raw["environments"].items():
        _require(env_name in ("AMBIENT", "COOLER"), f"unknown environment {env_name}")
        _check_probabilities(env["bin_type_shares"], f"environments.{env_name}.bin_type_shares")
        for bt in env["bin_type_shares"]:
            _require(bt in bin_types, f"environments.{env_name}: bin type {bt} has no capacity entry")
        _require(0.0 <= float(env["lot_expiry"]["populated_probability"]) <= 1.0,
                 f"environments.{env_name}.lot_expiry.populated_probability outside [0, 1]")
        lo, hi = _check_range(env["lot_expiry"]["expiry_offset_days"], f"environments.{env_name}.expiry_offset_days", lo=1)
        _require(int(env["port_count"]) >= 1, f"environments.{env_name}.port_count must be >= 1")
        config.environments[env_name] = EnvironmentSpec(
            name=env_name,
            code=str(env["code"]),
            zone=str(env["zone"]),
            grid_location=str(env["grid_location"]),
            port_prefix=str(env["port_location_prefix"]),
            port_count=int(env["port_count"]),
            bin_type_names=tuple(env["bin_type_shares"].keys()),
            bin_type_probs=tuple(float(v) for v in env["bin_type_shares"].values()),
            lot_populated_probability=float(env["lot_expiry"]["populated_probability"]),
            expiry_offset_days=(int(lo), int(hi)),
        )
    _require(set(config.environments) == {"AMBIENT", "COOLER"}, "both AMBIENT and COOLER environments are required")

    # --- bins ----------------------------------------------------------------------
    bins = raw["bins"]
    _require(float(bins["initial_on_hand_sigma"]) > 0, "bins.initial_on_hand_sigma must be > 0")
    _require(int(bins["min_initial_on_hand"]) >= 1, "bins.min_initial_on_hand must be >= 1")
    for bt, spec in bin_types.items():
        _require(1 <= int(spec["median_on_hand"]) <= int(spec["max_quantity"]),
                 f"bins.types.{bt}: median_on_hand must be within [1, max_quantity]")
    _require(float(bins["popularity_sigma"]) >= 0, "bins.popularity_sigma must be >= 0")
    _require(float(bins["product_pool_headroom"]) >= 1.0, "bins.product_pool_headroom must be >= 1")
    _require(int(bins["feasibility_attempts"]) >= 1, "bins.feasibility_attempts must be >= 1")
    _require(int(bins["minimum_population"]) >= 1, "bins.minimum_population must be >= 1")
    _require(0.0 <= float(raw["bin_day"]["repeat_rate"]) < 0.5, "bin_day.repeat_rate must be in [0, 0.5)")
    _require(int(raw["bin_day"]["max_clusters_per_bin_day"]) == 2,
             "bin_day.max_clusters_per_bin_day must be 2 (the bin-day rule allows one repeat)")

    # --- template libraries ----------------------------------------------------------
    for lib_name, lib in raw["template_libraries"].items():
        _check_probabilities(lib, f"template_libraries.{lib_name}")
    mult = raw["template_multipliers"]
    _require(float(mult["adjustment_rate_multiplier"]) >= 0, "adjustment_rate_multiplier must be >= 0")
    _require(float(mult["exception_rate_multiplier"]) >= 0, "exception_rate_multiplier must be >= 0")

    # --- magnitude / reasons -----------------------------------------------------
    for prof_name, prof in raw["adjust_magnitude_profiles"].items():
        buckets = prof["buckets"]
        _require(len(buckets) >= 1, f"adjust_magnitude_profiles.{prof_name}: no buckets")
        last_hi = 0
        for b in buckets:
            _require(len(b) == 3, f"adjust_magnitude_profiles.{prof_name}: bucket {b} must be [low, high, p]")
            lo, hi, p = int(b[0]), int(b[1]), float(b[2])
            _require(1 <= lo <= hi, f"adjust_magnitude_profiles.{prof_name}: invalid bucket {b}")
            _require(lo > last_hi, f"adjust_magnitude_profiles.{prof_name}: buckets must be ascending and disjoint")
            _require(0 <= p <= 1, f"adjust_magnitude_profiles.{prof_name}: bucket probability {p} outside [0, 1]")
            last_hi = hi
        total = math.fsum(float(b[2]) for b in buckets)
        _require(abs(total - 1.0) <= PROB_TOL, f"adjust_magnitude_profiles.{prof_name}: probabilities sum to {total}")
        _require(0.0 <= float(prof.get("median_anchor_mass", 0.0)) < 0.1,
                 f"adjust_magnitude_profiles.{prof_name}.median_anchor_mass must be in [0, 0.1)")
    descriptions = raw["reason_descriptions"]
    for prof_name, prof in raw["adjust_reason_profiles"].items():
        _check_probabilities(prof, f"adjust_reason_profiles.{prof_name}")
        for code in prof:
            _require(code in descriptions, f"reason {code} has no description")
    forbidden = raw["positive_adjust_forbidden_reasons"]
    for prof_name, prof in raw["adjust_reason_profiles"].items():
        allowed = [c for c in prof if c not in forbidden and prof[c] > 0]
        _require(len(allowed) > 0, f"adjust_reason_profiles.{prof_name}: no reason allowed for positive adjustments")
    atu = raw["adjust_tu"]
    _require(0 <= float(atu["blank_share_within_zero_or_blank"]) <= 1, "adjust_tu.blank_share_within_zero_or_blank outside [0, 1]")
    _require(0 <= float(atu["product_detail_blank_rate"]) <= 1, "adjust_tu.product_detail_blank_rate outside [0, 1]")
    _check_probabilities(atu["reasons"], "adjust_tu.reasons")
    for code in atu["reasons"]:
        _require(code in descriptions, f"reason {code} has no description")
    ca = raw["change_attribute"]
    _require(ca["reason"] in descriptions, "change_attribute.reason has no description")
    _require(0 <= float(ca["lot_change_probability"]) <= 1, "change_attribute.lot_change_probability outside [0, 1]")

    statuses = raw["material_status"]
    for key in ("default", "tu_damaged_cluster", "tu_dirty_cluster"):
        _check_probabilities(statuses[key], f"material_status.{key}")
    for code, spec in statuses["adjust_reason_changes"].items():
        _require(code in descriptions, f"material_status.adjust_reason_changes: unknown reason {code}")
        _require(0 <= float(spec["probability"]) <= 1, f"material_status.adjust_reason_changes.{code}.probability outside [0, 1]")

    # --- employees ------------------------------------------------------------------
    emp = raw["employees"]
    _require(0 <= float(emp["cross_trained_fraction"]) <= 1, "employees.cross_trained_fraction outside [0, 1]")
    _require(float(emp["cross_trained_activity_scale"]) > 0, "employees.cross_trained_activity_scale must be > 0")
    _require(float(emp["activity_weight_sigma"]) >= 0, "employees.activity_weight_sigma must be >= 0")
    _require(0 < float(emp["top_share_fraction"]) < 1, "employees.top_share_fraction must be in (0, 1)")
    _check_range(emp["top_share_target"], "employees.top_share_target", 0, 1)
    _check_range(emp["top_share_redraw_band"], "employees.top_share_redraw_band", 0, 1)
    _check_range(emp["active_day_fraction"], "employees.active_day_fraction", 0.01, 1)
    s0, s1 = (parse_clock(x) for x in emp["shift_start_window"])
    e0, e1 = (parse_clock(x) for x in emp["shift_end_window"])
    _require(s0 <= s1 and e0 <= e1 and s1 < e0, "employees shift windows must be ordered and non-overlapping")
    _require(0 <= float(emp["port_stickiness"]) <= 1, "employees.port_stickiness outside [0, 1]")
    tiers = emp["speed_tiers"]
    _require(len(tiers) >= 2, "employees.speed_tiers needs at least two tiers")
    _check_probabilities({t["name"]: t["share"] for t in tiers}, "employees.speed_tiers (shares)")
    mults = [float(t["multiplier"]) for t in tiers]
    _require(all(m > 0 for m in mults) and mults == sorted(mults), "speed tier multipliers must be positive and ascending")
    _require(0 <= float(emp["speed_multiplier_jitter"]) < 0.5, "employees.speed_multiplier_jitter must be in [0, 0.5)")
    _require(str(emp.get("tier_assignment", "activity_balanced")) in ("activity_balanced", "random"),
             "employees.tier_assignment must be 'activity_balanced' or 'random'")
    _check_probabilities({str(k): v for k, v in emp["cross_trained_tier_shift"].items()}, "employees.cross_trained_tier_shift")
    cats = emp["variability_categories"]
    _check_probabilities({c["name"]: c["share"] for c in cats}, "employees.variability_categories (shares)")
    for c in cats:
        _check_range(c["sigma_range"], f"employees.variability_categories.{c['name']}.sigma_range", 0, 3)
    _require(0 <= float(emp["long_pause_range_inset"]) < 0.5, "employees.long_pause_range_inset must be in [0, 0.5)")
    for key in ("adjustment_tendency_sigma", "repeat_adjustment_tendency_sigma", "exception_tendency_sigma"):
        _require(float(emp[key]) >= 0, f"employees.{key} must be >= 0")

    # --- scheduling / timing / updaters -------------------------------------------------
    _check_range(raw["scheduling"]["handoff_gap_seconds"], "scheduling.handoff_gap_seconds", 0)
    _require(raw["scheduling"]["port_busy_policy"] in ("wait", "reassign"),
             "scheduling.port_busy_policy must be 'wait' or 'reassign'")
    _require(float(raw["scheduling"]["employee_balance_gain"]) >= 0, "scheduling.employee_balance_gain must be >= 0")
    _require(float(raw["scheduling"]["port_balance_gain"]) >= 0, "scheduling.port_balance_gain must be >= 0")
    _require(float(raw["scheduling"]["capacity_warning_utilization"]) > 0,
             "scheduling.capacity_warning_utilization must be > 0")
    timing = raw["timing"]
    for key, value in timing["base_gap_seconds"].items():
        _require(float(value) > 0, f"timing.base_gap_seconds.{key} must be > 0")
    _require(0 < float(timing["min_gap_seconds"]) < float(timing["max_gap_seconds"]), "timing min/max gap invalid")
    cal = timing["calibration"]
    _require(int(cal["sample_clusters"]) >= 20000, "timing.calibration.sample_clusters must be >= 20,000")
    _require(0 < float(cal["max_pause_probability"]) <= 1, "timing.calibration.max_pause_probability outside (0, 1]")
    _require(0 < float(cal["max_mean_pause_rate"]) < 1, "timing.calibration.max_mean_pause_rate outside (0, 1)")
    _require(float(cal["max_magnitude_multiplier"]) >= 1, "timing.calibration.max_magnitude_multiplier must be >= 1")
    _require(int(cal["iterations"]) >= 10, "timing.calibration.iterations must be >= 10")
    upd = raw["updaters"]
    for key in ("opening_move_system_probability", "closing_move_system_probability"):
        _require(0 <= float(upd[key]) <= 1, f"updaters.{key} outside [0, 1]")

    # --- configurations ---------------------------------------------------------------
    for cfg_name in CONFIG_NAMES:
        _require(cfg_name in raw["configurations"], f"missing configuration {cfg_name}")
    for cfg_name, c in raw["configurations"].items():
        _require(cfg_name in CONFIG_NAMES, f"unknown configuration {cfg_name}")
        env_name = c["environment"]
        _require(env_name in config.environments, f"{cfg_name}: unknown environment {env_name}")
        env = config.environments[env_name]
        _require(c["workflow"] in ("CC", "BM"), f"{cfg_name}: workflow must be CC or BM")
        _require(int(c["employee_pool_size"]) >= 1, f"{cfg_name}: employee_pool_size must be >= 1")
        _require(int(c["employee_pool_size"]) <= 999, f"{cfg_name}: employee_pool_size must be <= 999")
        # ports
        weights_pct = {int(k): float(v) for k, v in c["ports"]["weights_percent"].items()}
        for port in weights_pct:
            _require(1 <= port <= env.port_count, f"{cfg_name}: port {port} does not exist in {env_name}")
        remainder = float(c["ports"]["remainder_percent"])
        unlisted = [p for p in range(1, env.port_count + 1) if p not in weights_pct]
        total_pct = sum(weights_pct.values()) + remainder
        _require(abs(total_pct - 100.0) <= PERCENT_TOL, f"{cfg_name}: port percentages sum to {total_pct}, expected 100")
        _require(remainder == 0 or unlisted, f"{cfg_name}: remainder_percent given but every port is listed")
        vec = np.zeros(env.port_count)
        for port, pct in weights_pct.items():
            vec[port - 1] = pct / 100.0
        for port in unlisted:
            vec[port - 1] = remainder / 100.0 / len(unlisted)
        _require(abs(vec.sum() - 1.0) <= PROB_TOL, f"{cfg_name}: port weights do not sum to 1")
        # templates
        templates = {str(k): float(v) for k, v in c["templates"].items()}
        _check_probabilities(templates, f"{cfg_name}.templates")
        for key in templates:
            if key.startswith("RARE_"):
                _require(key in raw["template_libraries"], f"{cfg_name}: unknown rare library {key}")
        # signs
        _check_probabilities(c["adjust_sign"], f"{cfg_name}.adjust_sign")
        _require(set(c["adjust_sign"]) == {"negative", "positive", "zero"}, f"{cfg_name}.adjust_sign needs negative/positive/zero")
        _require(c["adjust_magnitude_profile"] in raw["adjust_magnitude_profiles"], f"{cfg_name}: unknown magnitude profile")
        _require(c["adjust_reason_profile"] in raw["adjust_reason_profiles"], f"{cfg_name}: unknown reason profile")
        # hours
        hours_pct = {int(k): float(v) for k, v in c["start_hours"]["weights_percent"].items()}
        other_pct = float(c["start_hours"].get("other_percent", 0.0))
        for hour in hours_pct:
            _require(hour in ALL_START_HOURS and hour not in OTHER_HOURS,
                     f"{cfg_name}: start hour {hour} must be one of 15..19 (14/20 belong to 'other')")
        total_h = sum(hours_pct.values()) + other_pct
        _require(abs(total_h - 100.0) <= PERCENT_TOL, f"{cfg_name}: start-hour percentages sum to {total_h}")
        hour_weights = {h: 0.0 for h in ALL_START_HOURS}
        for hour, pct in hours_pct.items():
            hour_weights[hour] = pct / 100.0
        for hour in OTHER_HOURS:
            hour_weights[hour] = other_pct / 100.0 / len(OTHER_HOURS)
        # ratios and targets
        ratios = c["population_ratios"]
        _require(0 < float(ratios["unique_bins"]) <= 1, f"{cfg_name}: unique_bins ratio must be in (0, 1]")
        _require(0 < float(ratios["unique_products"]) <= float(ratios["unique_bins"]),
                 f"{cfg_name}: unique_products ratio must be in (0, unique_bins]")
        targets = c["duration_targets_seconds"]
        _require(0 < float(targets["median"]) < float(targets["p90"]), f"{cfg_name}: duration targets must satisfy 0 < median < p90")
        pp = _check_range(c["long_pause"]["probability_range"], f"{cfg_name}.long_pause.probability_range", 0, 1)
        pf = _check_range(c["long_pause"]["factor_range"], f"{cfg_name}.long_pause.factor_range", 1)
        mag_t = c.get("adjust_magnitude_targets") or {}
        atu_rate = None
        if c["workflow"] == "BM":
            _require("adjust_tu" in c, f"{cfg_name}: Bin Maintenance configurations need adjust_tu settings")
            atu_rate = float(c["adjust_tu"]["zero_or_blank_rate"])
            _require(0 <= atu_rate <= 1, f"{cfg_name}.adjust_tu.zero_or_blank_rate outside [0, 1]")
        config.configurations[cfg_name] = ConfigurationSpec(
            name=cfg_name,
            short=str(c["short_name"]),
            environment=env_name,
            workflow=str(c["workflow"]),
            operation=str(c["operation"]),
            pool_size=int(c["employee_pool_size"]),
            port_weights=tuple(float(x) for x in vec),
            template_table=templates,
            adjust_sign={k: float(v) for k, v in c["adjust_sign"].items()},
            magnitude_profile=str(c["adjust_magnitude_profile"]),
            reason_profile=str(c["adjust_reason_profile"]),
            magnitude_median_target=(int(mag_t["median_nonzero"]) if mag_t.get("median_nonzero") is not None else None),
            magnitude_p90_target=(float(mag_t["p90_including_zeros"]) if mag_t.get("p90_including_zeros") is not None else None),
            hour_weights=hour_weights,
            hour_other_share=other_pct / 100.0,
            unique_bins_ratio=float(ratios["unique_bins"]),
            unique_products_ratio=float(ratios["unique_products"]),
            duration_median_target=float(targets["median"]),
            duration_p90_target=float(targets["p90"]),
            pause_probability_range=pp,
            pause_factor_range=pf,
            adjust_tu_zero_or_blank_rate=atu_rate,
        )

    # --- validation tolerances --------------------------------------------------------
    tol = raw["validation"]["tolerances"]
    for key, value in tol.items():
        _require(float(value) >= 0, f"validation.tolerances.{key} must be >= 0")
    _require(int(raw["validation"]["pattern_scan"]["long_token_min_length"]) >= 16,
             "validation.pattern_scan.long_token_min_length must be >= 16")


def config_summary(config: Config) -> dict[str, Any]:
    """Small, identifier-free summary used on the notice sheet and in the report."""
    mult = config.raw["template_multipliers"]
    post = config.raw.get("post_calibration", {})
    return {
        "configuration_file": config.source_name,
        "date_range": f"{config.start_date.isoformat()} to {config.end_date.isoformat()}",
        "adjustment_rate_multiplier": float(mult["adjustment_rate_multiplier"]),
        "exception_rate_multiplier": float(mult["exception_rate_multiplier"]),
        "repeat_bin_rate": float(config.raw["bin_day"]["repeat_rate"]),
        "timing_multiplier": float(post.get("timing_multiplier", 1.0)),
        "pause_multiplier": float(post.get("pause_multiplier", 1.0)),
    }
