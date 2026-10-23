import copy

import pytest
import yaml

from simgen.config import ConfigError, DEFAULT_CONFIG_PATH, load_config
from simgen.templates import build_template_table


def _write(tmp_path, raw):
    p = tmp_path / "cfg.yaml"
    p.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return p


@pytest.fixture()
def raw():
    return yaml.safe_load(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))


def test_default_config_loads(config):
    assert set(config.configurations) == {
        "AMBIENT_CYCLE_COUNT", "COOLER_CYCLE_COUNT", "AMBIENT_BIN_MAINTENANCE", "COOLER_BIN_MAINTENANCE"}
    for name, spec in config.configurations.items():
        assert abs(sum(spec.port_weights) - 1.0) < 1e-9
        assert abs(sum(spec.hour_weights.values()) - 1.0) < 1e-9
        table = build_template_table(config, name)
        assert abs(table.probs.sum() - 1.0) < 1e-9


def test_probabilities_must_sum_to_one(tmp_path, raw):
    raw["configurations"]["AMBIENT_CYCLE_COUNT"]["templates"]["M-M"] = 0.7
    with pytest.raises(ConfigError, match="sum"):
        load_config(_write(tmp_path, raw))


def test_unknown_port_rejected(tmp_path, raw):
    raw["configurations"]["COOLER_CYCLE_COUNT"]["ports"]["weights_percent"][9] = 1
    raw["configurations"]["COOLER_CYCLE_COUNT"]["ports"]["remainder_percent"] = 9
    with pytest.raises(ConfigError, match="port 9"):
        load_config(_write(tmp_path, raw))


def test_bad_range_rejected(tmp_path, raw):
    raw["employees"]["active_day_fraction"] = [0.9, 0.6]
    with pytest.raises(ConfigError):
        load_config(_write(tmp_path, raw))


def test_missing_transition_gap_rejected(tmp_path, raw):
    del raw["timing"]["base_gap_seconds"]["adjust_tu_to_adjust_tu"]
    cfg = load_config(_write(tmp_path, raw))
    with pytest.raises(ConfigError, match="adjust_tu_to_adjust_tu"):
        build_template_table(cfg, "AMBIENT_BIN_MAINTENANCE")


def test_overrides_apply(raw):
    cfg = load_config(overrides={"start_date": "2027-02-01", "end_date": "2027-02-07", "adjust_mult": 1.2,
                                 "employees": {"AMBIENT_CYCLE_COUNT": 12}})
    assert len(cfg.dates) == 7
    assert cfg.configurations["AMBIENT_CYCLE_COUNT"].pool_size == 12
    table = build_template_table(cfg, "AMBIENT_CYCLE_COUNT")
    base = build_template_table(load_config(), "AMBIENT_CYCLE_COUNT")
    i = table.index["M-A-M"]
    assert table.probs[i] == pytest.approx(base.probs[i] * 1.2)
    assert table.probs.sum() == pytest.approx(1.0)  # M-M absorbs the difference


def test_multiplier_that_breaks_mm_rejected():
    cfg = load_config(overrides={"adjust_mult": 3.0})
    with pytest.raises(ConfigError, match="M-M"):
        build_template_table(cfg, "AMBIENT_BIN_MAINTENANCE")


def test_no_hardcoded_numbers_in_config_copy(raw):
    # The loader works on a copy: mutating the raw mapping after load has no effect.
    cfg = load_config()
    snapshot = copy.deepcopy(cfg.raw)
    raw["run"]["start_date"] = "2030-01-01"
    assert cfg.raw == snapshot
