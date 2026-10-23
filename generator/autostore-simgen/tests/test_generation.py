"""Determinism, exact volume and cluster-structure tests."""

import numpy as np
import pandas as pd
import pytest

from simgen.cluster_generator import generate
from simgen.config import CONFIG_NAMES
from simgen.pipeline import RunOptions, build
from simgen.rowcount import ExactRowCountError, achievable_neighbours, solve_remainder
from simgen.templates import CODE_OF_TYPE, build_template_table


def _frames(seed, target=400, configs=None):
    out = build(RunOptions(configs=configs or list(CONFIG_NAMES), target=target, seed=seed, export=False))
    return out


def test_same_seed_identical_data():
    a = _frames(3)
    b = _frames(3)
    for name in a.frames:
        pd.testing.assert_frame_equal(a.frames[name], b.frames[name])


def test_different_seed_differs():
    a = _frames(3, configs=["AMBIENT_CYCLE_COUNT"])
    b = _frames(4, configs=["AMBIENT_CYCLE_COUNT"])
    fa, fb = a.frames["AMBIENT_CYCLE_COUNT"], b.frames["AMBIENT_CYCLE_COUNT"]
    assert not fa["create_date"].equals(fb["create_date"])


@pytest.mark.parametrize("target", list(range(2, 21)) + [57, 1234])
def test_exact_row_count_small_and_odd_targets(config, target):
    res = generate(config, ["COOLER_BIN_MAINTENANCE"], "rows", target, seed=target)
    cr = res.config("COOLER_BIN_MAINTENANCE")
    assert cr.n_rows == target
    table = build_template_table(config, "COOLER_BIN_MAINTENANCE")
    codes = {t.code for t in table.templates}
    assert all(r.template_code in codes and len(r.rows) == len(r.template_code.split("-")) for r in cr.records)


def test_exact_row_count_all_configs(config):
    res = generate(config, list(CONFIG_NAMES), "rows", 777, seed=9)
    for name in CONFIG_NAMES:
        assert res.config(name).n_rows == 777


def test_exact_cluster_count(config):
    res = generate(config, ["AMBIENT_CYCLE_COUNT", "AMBIENT_BIN_MAINTENANCE"], "clusters", 321, seed=2)
    for name in ("AMBIENT_CYCLE_COUNT", "AMBIENT_BIN_MAINTENANCE"):
        assert len(res.config(name).records) == 321


def test_impossible_row_count_fails_loudly(config):
    with pytest.raises(ExactRowCountError, match="nearest achievable totals are 0 and 2"):
        generate(config, ["AMBIENT_CYCLE_COUNT"], "rows", 1, seed=1)


def test_remainder_solver_prefers_probable_lengths():
    probs = {2: 0.64, 3: 0.34, 4: 0.015, 5: 0.005}
    avail = {2: 50, 3: 50, 4: 5, 5: 5}
    assert sorted(solve_remainder(7, avail, probs)) == [2, 2, 3]
    assert sorted(solve_remainder(4, avail, probs)) == [2, 2]
    assert solve_remainder(1, avail, probs) is None
    assert sorted(solve_remainder(5, {2: 0, 3: 0, 5: 1}, probs)) == [5]
    assert achievable_neighbours(1, [2, 3]) == (0, 2)


def test_every_cluster_matches_template_and_alternates(medium, config):
    for name, df in medium.frames.items():
        env = config.env_of(name)
        table = build_template_table(config, name)
        enabled = {t.code for t in table.templates}
        df = df.sort_values(["_cluster", "cluster_sequence_number"])
        for cid, g in df.groupby("_cluster", sort=False):
            codes = "-".join(CODE_OF_TYPE[t] for t in g["transaction_type"])
            assert codes in enabled
            port = g["port"].iloc[0]
            moves = g[g["transaction_type"] == "Move"]
            for k, (_, row) in enumerate(moves.iterrows()):
                if k % 2 == 0:
                    assert (row["from_location"], row["to_location"]) == (env.grid_location, port)
                else:
                    assert (row["from_location"], row["to_location"]) == (port, env.grid_location)
            mids = g[g["transaction_type"] != "Move"]
            assert (mids["from_location"] == port).all() and (mids["to_location"] == port).all()
            locs = set(g["from_location"]) | set(g["to_location"])
            assert locs <= set(env.port_locations) | {env.grid_location}
            assert g["from_tu"].nunique() == 1 and g["operation"].nunique() == 1
            break_after = 400
            if cid > break_after:
                break


def test_no_environment_mixing(medium):
    for name, df in medium.frames.items():
        code = "AMB" if name.startswith("AMBIENT") else "CLR"
        other = "CLR" if code == "AMB" else "AMB"
        for col in ("from_tu", "from_product", "to_product", "from_location", "port"):
            assert not df[col].dropna().astype(str).str.contains(other).any()


def test_chronology_and_no_overlaps(medium):
    for name, df in medium.frames.items():
        d = df.sort_values(["_cluster", "cluster_sequence_number"])
        ts = d["create_date"].to_numpy().astype("datetime64[ms]").astype(np.int64)
        same = d["_cluster"].to_numpy()[1:] == d["_cluster"].to_numpy()[:-1]
        assert np.all(np.diff(ts)[same] > 0)
    for env in ("AMBIENT", "COOLER"):
        names = [n for n in medium.frames if n.startswith(env)]
        clusters = []
        for n in names:
            d = medium.frames[n]
            ts = d["create_date"].to_numpy().astype("datetime64[ms]").astype(np.int64)
            g = pd.DataFrame({"c": d["_cluster"], "ts": ts, "e": d["_employee"], "p": d["port"]}).groupby("c")
            clusters.append(pd.DataFrame({"s": g["ts"].min(), "e_": g["ts"].max(), "emp": g["e"].first(), "port": g["p"].first()}))
        ct = pd.concat(clusters)
        for key in ("emp", "port"):
            sub = ct.sort_values([key, "s"])
            k = sub[key].to_numpy()
            assert not np.any((k[1:] == k[:-1]) & (sub["s"].to_numpy()[1:] <= sub["e_"].to_numpy()[:-1]))
        assert not ct["s"].duplicated().any()


def test_logical_validation_clean(medium):
    assert medium.report.errors("logical") == 0
    assert medium.report.errors("privacy") == 0


def test_operation_constant_per_workflow(medium, config):
    for name, df in medium.frames.items():
        assert set(df["operation"]) == {config.configurations[name].operation}
