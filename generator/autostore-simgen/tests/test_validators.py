"""The logical validator must catch injected faults (so a clean result means something)."""

import pandas as pd
import pytest

from simgen.validators.logical import validate_logical


def _run(medium, mutate):
    frames = {k: v.copy() for k, v in medium.frames.items()}
    name = "AMBIENT_CYCLE_COUNT"
    mutate(frames, name)
    checks = validate_logical(medium.config, frames, medium.schema,
                              {n: {"mode": "rows", "target": 6000} for n in frames})
    return {c.name for c in checks if c.failed}


def test_clean_frames_pass(medium):
    assert _run(medium, lambda f, n: None) == set()


def test_unreconciled_adjust_detected(medium):
    def m(f, n):
        df = f[n]
        i = df.index[df["transaction_type"] == "Adjust"][0]
        df.loc[i, "to_quantity"] = df.loc[i, "to_quantity"] + 1
    assert "Adjust rows reconcile (To = From + Transaction)" in _run(medium, m)


def test_environment_mix_detected(medium):
    def m(f, n):
        df = f[n]
        i = df.index[df["transaction_type"] == "Move"][0]
        df.loc[i, "from_location"] = "SIM_COOLER_GRID"
    assert "Single environment (no Ambient/Cooler mixing)" in _run(medium, m)


def test_overlap_detected(medium):
    def m(f, n):
        df = f[n]
        e = df["_employee"].iloc[0]
        cl = df.loc[df["_employee"] == e, "_cluster"].unique()[:2]
        a = df.index[df["_cluster"] == cl[0]]
        b = df.index[df["_cluster"] == cl[1]]
        shift = df.loc[b[0], "create_date"] - df.loc[a[0], "create_date"] - pd.Timedelta(milliseconds=1)
        df.loc[b, "create_date"] = df.loc[b, "create_date"] - shift
        df.loc[b, "update_date"] = df.loc[b, "create_date"]
    assert "No employee works overlapping clusters" in _run(medium, m)


def test_truncated_cluster_detected(medium):
    def m(f, n):
        df = f[n]
        i = df.index[df["transaction_type"] == "Adjust"][0]
        f[n] = df.drop(index=i)
    failed = _run(medium, m)
    assert "Exact row count" in failed and "Cluster sequence numbers 1..n" in failed


@pytest.mark.parametrize("col,value,check", [
    ("reason_code", None, "Null rules from the schema definition"),
    ("to_product", "SIMSKU-AMB-999999", "Product changes only on Change Product rows (and every CP changes it)"),
    ("updated_by", "SIMUSR-AMB-CC-998", "One human employee per cluster (Moves: system or the cluster employee)"),
])
def test_field_faults_detected(medium, col, value, check):
    def m(f, n):
        df = f[n]
        mask = df["transaction_type"] == ("Adjust" if col == "reason_code" else "Move")
        df.loc[df.index[mask][2], col] = value
    assert check in _run(medium, m)
