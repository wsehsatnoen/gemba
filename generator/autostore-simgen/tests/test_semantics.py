"""Quantity, event-type, employee and bin-day semantics."""

import numpy as np
import pandas as pd

from simgen.validators.statistical import cluster_frame


def _num(s):
    return pd.to_numeric(s, errors="coerce").to_numpy(dtype=float)


def test_adjust_reconciles_and_never_negative(medium, config):
    for name, df in medium.frames.items():
        adj = df[df["transaction_type"] == "Adjust"]
        assert np.allclose(_num(adj["from_quantity"]) + _num(adj["transaction_quantity"]), _num(adj["to_quantity"]))
        assert (_num(df["from_quantity"])[~np.isnan(_num(df["from_quantity"]))] >= 0).all()
        assert (_num(df["to_quantity"])[~np.isnan(_num(df["to_quantity"]))] >= 0).all()
        caps = df["tu_type"].map(lambda b: config.bin_max(b)).to_numpy()
        tq = _num(df["to_quantity"])
        assert np.all(np.isnan(tq) | (tq <= caps))


def test_quantity_chain_across_clusters(medium):
    for name, df in medium.frames.items():
        d = df[df["from_quantity"].notna()].sort_values(["from_tu", "create_date", "cluster_sequence_number"])
        same = d["from_tu"].to_numpy()[1:] == d["from_tu"].to_numpy()[:-1]
        fq = d["from_quantity"].to_numpy(dtype=float)
        tq = d["to_quantity"].to_numpy(dtype=float)
        assert np.all(fq[1:][same] == tq[:-1][same])


def test_adjust_and_adjust_tu_rules_differ(medium, config):
    df = medium.frames["AMBIENT_BIN_MAINTENANCE"]
    t = df[df["transaction_type"] == "Adjust TU"]
    # Adjust TU never changes quantity, and its quantity is blank, zero or the on-hand snapshot
    both = t["from_quantity"].notna()
    assert (t.loc[both, "from_quantity"] == t.loc[both, "to_quantity"]).all()
    tq = t["transaction_quantity"]
    snap = t["transaction_quantity"].notna() & (t["transaction_quantity"] != 0) & both
    assert (tq[snap] == t.loc[snap, "from_quantity"]).all()
    # some Adjust TU rows carry no product detail; Adjust rows always do
    assert t["from_product"].isna().any()
    adj = df[df["transaction_type"] == "Adjust"]
    assert adj["from_product"].notna().all() and adj["transaction_quantity"].notna().all()
    # reasons come from different vocabularies
    assert set(t["reason_code"]) <= set(config.raw["adjust_tu"]["reasons"])
    assert not set(adj["reason_code"]) & set(config.raw["adjust_tu"]["reasons"])
    # zero-or-blank rate near its configured value
    zb = (tq.isna() | (tq == 0)).mean()
    assert abs(zb - config.configurations["AMBIENT_BIN_MAINTENANCE"].adjust_tu_zero_or_blank_rate) < 0.03


def test_positive_adjust_reasons(medium, config):
    forbidden = set(config.raw["positive_adjust_forbidden_reasons"])
    for df in medium.frames.values():
        pos = df[(df["transaction_type"] == "Adjust") & (_num(df["transaction_quantity"]) > 0)]
        assert not set(pos["reason_code"]) & forbidden


def test_cp_ca_u_semantics(medium):
    seen = {"Change Product": 0, "Change Attribute": 0, "Unallocation": 0}
    for df in medium.frames.values():
        cp = df[df["transaction_type"] == "Change Product"]
        assert (cp["from_product"] != cp["to_product"]).all()
        assert (cp["from_quantity"] == cp["to_quantity"]).all()
        assert (cp["from_lu"] != cp["to_lu"]).all()
        ca = df[df["transaction_type"] == "Change Attribute"]
        assert (ca["from_expiry_date"].astype(object) != ca["to_expiry_date"].astype(object)).all()
        assert ca["to_lot"].notna().all() and (ca["from_product"] == ca["to_product"]).all()
        assert (ca["reason_code"] == "SIM_ATTRIBUTE_UPDATE").all()
        u = df[df["transaction_type"] == "Unallocation"]
        assert u["from_order"].notna().all() and u["to_order"].isna().all()
        assert df.loc[df["transaction_type"] != "Unallocation", "from_order"].isna().all()
        other = df[~df["transaction_type"].isin(["Change Product"])]
        pb = other["from_product"].notna()
        assert (other.loc[pb, "from_product"] == other.loc[pb, "to_product"]).all()
        for k in seen:
            seen[k] += int((df["transaction_type"] == k).sum())
    assert all(v > 0 for v in seen.values())


def test_product_state_carries_forward_after_change_product(medium):
    for df in medium.frames.values():
        cp = df[df["transaction_type"] == "Change Product"]
        for _, row in cp.head(5).iterrows():
            later = df[(df["from_tu"] == row["from_tu"]) & (df["create_date"] > row["create_date"])
                       & df["from_product"].notna()].sort_values("create_date")
            if len(later):
                assert later.iloc[0]["from_product"] == row["to_product"]


def test_lot_and_expiry_rules(medium):
    for df in medium.frames.values():
        assert (df["from_lot"].isna() == df["from_expiry_date"].isna()).all()
        assert (df["to_lot"].isna() == df["to_expiry_date"].isna()).all()
        pop = df[df["to_expiry_date"].notna()]
        assert (pd.to_datetime(pop["to_expiry_date"]) > pd.to_datetime(pop["activity_date"])).all()


def test_updater_rules(medium, config):
    sysu = config.system_user
    for df in medium.frames.values():
        mids = df[df["transaction_type"] != "Move"]
        assert (mids["updated_by"] != sysu).all()
        assert (mids["updated_by"] == mids["_employee"]).all()
        moves = df[df["transaction_type"] == "Move"]
        assert ((moves["updated_by"] == sysu) | (moves["updated_by"] == moves["_employee"])).all()
        humans = df[df["updated_by"] != sysu].groupby("_cluster")["updated_by"].nunique()
        assert (humans <= 1).all()
        first = moves[moves["cluster_sequence_number"] == 1]
        assert abs((first["updated_by"] == sysu).mean() - 0.60) < 0.03


def test_persistent_employee_profiles(medium, config):
    for name in medium.frames:
        wf = medium.result.workforce_of(name)
        cf = cluster_frame(config, medium.result, name)
        # each employee carries exactly one tier for this configuration across all of their clusters
        assert (cf.groupby("employee")["tier"].nunique() == 1).all()
        # activity is not uniform
        counts = cf["employee"].value_counts()
        assert counts.max() > 3 * counts.min()
        for e in wf.workforce[name]:
            p = wf.employees[e]
            assert p.environment == config.configurations[name].environment


def test_cross_training_keeps_bm_ids(medium, config):
    for env in ("AMBIENT", "COOLER"):
        cc = next(n for n in medium.frames if n.startswith(env) and "CYCLE" in n)
        bm = next(n for n in medium.frames if n.startswith(env) and "BIN" in n)
        wf = medium.result.workforce_of(cc)
        cross = [e for e in wf.workforce[cc] if "-BM-" in e]
        expected = round(config.raw["employees"]["cross_trained_fraction"] * config.configurations[bm].pool_size)
        assert len(cross) == expected
        assert all(e in wf.workforce[bm] for e in cross)
        # no employee crosses environments
        other = "CLR" if env == "AMBIENT" else "AMB"
        assert not any(f"-{other}-" in e for e in wf.workforce[cc] + wf.workforce[bm])


def test_tier_ordering(medium, config):
    for name in medium.frames:
        cf = cluster_frame(config, medium.result, name)
        norm = cf["duration"] / cf.groupby("template")["duration"].transform("median")
        med = norm.groupby(cf["tier_index"]).median().sort_index().to_numpy()
        assert np.all(np.diff(med) > 0), name


def test_bin_day_rule_and_repeats(medium, config):
    for name in medium.frames:
        cf = cluster_frame(config, medium.result, name)
        per_day = cf.groupby(["tu", "date"]).size()
        assert per_day.max() <= 2
        rate = (per_day == 2).sum() / len(per_day)
        assert 0.0 < rate < 0.03
        recs = sorted(medium.result.config(name).records, key=lambda r: (r.tu_id, r.start_ms))
        for a, b in zip(recs, recs[1:]):
            if a.tu_id == b.tu_id and a.date == b.date:
                assert b.start_ms > a.end_ms
                # the repeat starts from the first cluster's final quantity and product
                last = [r for r in a.rows if r.to_qty is not None][-1]
                first = [r for r in b.rows if r.from_qty is not None][0]
                assert first.from_qty == last.to_qty and first.from_product == last.to_product


def test_population_ratios_near_targets(medium, config):
    for name, df in medium.frames.items():
        spec = config.configurations[name]
        n = df["_cluster"].nunique()
        assert abs(df["from_tu"].nunique() / n - spec.unique_bins_ratio) / spec.unique_bins_ratio < 0.12
