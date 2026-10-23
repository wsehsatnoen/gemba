"""Logical and relational validation (zero errors required).

Works on the per-configuration DataFrames produced by the row expander (schema
keys as columns plus internal ``_cluster`` / ``_employee`` helpers). Every
check reports a violation count; nothing here prints identifier values.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd

from ..config import Config
from ..schema import BLANK, PRODUCT_DETAIL_GROUP, REQUIRED, SchemaDefinition
from ..templates import CODE_OF_TYPE, build_template_table
from .results import FAIL, PASS, CheckResult

FORBIDDEN_POSITIVE_DEFAULT = ("SIM_MISSING", "SIM_DAMAGED", "SIM_EXPIRED")


def _res(scope: str, name: str, violations: int, detail: str = "") -> CheckResult:
    return CheckResult("logical", scope, name, PASS if violations == 0 else FAIL, int(violations), detail)


def _isnull(arr: np.ndarray) -> np.ndarray:
    return pd.isna(pd.Series(arr, dtype=object)).to_numpy()


def _obj(df: pd.DataFrame, col: str) -> np.ndarray:
    s = df[col]
    return s.astype(object).where(s.notna(), None).to_numpy(dtype=object)


def _num(df: pd.DataFrame, col: str) -> np.ndarray:
    return pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)


def ts_ms(series: pd.Series) -> np.ndarray:
    """Timestamps as int64 milliseconds, whatever the stored resolution."""
    return series.to_numpy().astype("datetime64[ms]").astype(np.int64)


def _date_ord(values: np.ndarray) -> np.ndarray:
    out = np.full(len(values), np.nan)
    for i, v in enumerate(values):
        if v is not None and not (isinstance(v, float) and np.isnan(v)):
            out[i] = pd.Timestamp(v).toordinal()
    return out


def cluster_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per cluster: start, end, TU, port, employee, date, size."""
    g = df.groupby("_cluster", sort=False)
    ts = ts_ms(df["create_date"])
    tmp = pd.DataFrame({"_cluster": df["_cluster"].to_numpy(), "ts": ts})
    agg = tmp.groupby("_cluster", sort=False)["ts"].agg(["min", "max", "size"])
    first = g.head(1).set_index("_cluster")
    out = pd.DataFrame({
        "start": agg["min"],
        "end": agg["max"],
        "size": agg["size"],
        "tu": first["from_tu"],
        "port": first["port"],
        "employee": first["_employee"] if "_employee" in first else None,
        "date": first["activity_date"],
        "config": first["_config"] if "_config" in first else None,
    })
    return out.reset_index()


def validate_config(config: Config, name: str, df: pd.DataFrame, schema: SchemaDefinition,
                    expectation: dict | None) -> list[CheckResult]:
    spec = config.configurations[name]
    env = config.environments[spec.environment]
    scope = spec.short
    checks: list[CheckResult] = []
    table = build_template_table(config, name)
    system = config.system_user
    forbidden = tuple(config.raw.get("positive_adjust_forbidden_reasons", FORBIDDEN_POSITIVE_DEFAULT))

    # ---- schema / volume -------------------------------------------------------
    present = [c for c in df.columns if not c.startswith("_")]
    checks.append(_res(scope, "Exact schema and column order (89 columns)",
                       0 if present == schema.keys and len(present) == 89 else 1,
                       f"{len(present)} schema columns present"))
    df = df.sort_values(["_cluster", "cluster_sequence_number"], kind="stable").reset_index(drop=True)
    n = len(df)
    clusters = df["_cluster"].to_numpy()
    n_clusters = len(np.unique(clusters))
    if expectation:
        if expectation["mode"] == "rows":
            checks.append(_res(scope, "Exact row count", 0 if n == expectation["target"] else 1,
                               f"requested {expectation['target']}, produced {n}"))
        else:
            checks.append(_res(scope, "Exact cluster count", 0 if n_clusters == expectation["target"] else 1,
                               f"requested {expectation['target']}, produced {n_clusters}"))
    if n == 0:
        return checks

    seq = df["cluster_sequence_number"].to_numpy(dtype=np.int64)
    new_cluster = np.ones(n, dtype=bool)
    new_cluster[1:] = clusters[1:] != clusters[:-1]
    same_prev = ~new_cluster
    # sequence numbers 1..n contiguous
    expected_seq = np.ones(n, dtype=np.int64)
    for i in range(1, n):
        if same_prev[i]:
            expected_seq[i] = expected_seq[i - 1] + 1
    checks.append(_res(scope, "Cluster sequence numbers 1..n", int((seq != expected_seq).sum())))

    types = _obj(df, "transaction_type")
    codes = np.array([CODE_OF_TYPE.get(t, "?") for t in types], dtype=object)
    seqs = pd.Series(codes).groupby(clusters, sort=False).agg("-".join)
    enabled = {t.code for t in table.templates}
    checks.append(_res(scope, "Every cluster matches an enabled template", int((~seqs.isin(enabled)).sum()),
                       f"{len(seqs)} clusters checked"))
    valid_types = table.transaction_types
    checks.append(_res(scope, "Transaction types valid for the workflow",
                       int(sum(1 for t in types if t not in valid_types))))

    # ---- locations -------------------------------------------------------------
    frm = _obj(df, "from_location")
    to = _obj(df, "to_location")
    port = _obj(df, "port")
    grid = env.grid_location
    ports_ok = set(env.port_locations)
    is_move = types == "Move"
    # opening moves: count moves within cluster so far
    move_rank = np.zeros(n, dtype=int)
    count = 0
    for i in range(n):
        if new_cluster[i]:
            count = 0
        if is_move[i]:
            move_rank[i] = count
            count += 1
    open_move = is_move & (move_rank % 2 == 0)
    close_move = is_move & (move_rank % 2 == 1)
    bad = 0
    bad += int(np.sum(open_move & ~((frm == grid) & (to == port))))
    bad += int(np.sum(close_move & ~((frm == port) & (to == grid))))
    last_row = np.zeros(n, dtype=bool)
    last_row[:-1] = new_cluster[1:]
    last_row[-1] = True
    bad += int(np.sum(new_cluster & ~open_move))  # first row must be an opening Move
    bad += int(np.sum(last_row & ~close_move))  # last row must be a closing Move
    checks.append(_res(scope, "Moves alternate GRID->PORT / PORT->GRID; first opens, last closes", bad))
    middle = ~is_move
    checks.append(_res(scope, "Middle rows are PORT->PORT at the cluster port",
                       int(np.sum(middle & ~((frm == port) & (to == port))))))
    in_env = np.array([(a in ports_ok or a == grid) and (b in ports_ok or b == grid) and p in ports_ok
                       for a, b, p in zip(frm, to, port)])
    checks.append(_res(scope, "Single environment (no Ambient/Cooler mixing)",
                       int((~in_env).sum()) + int(np.sum(_obj(df, "zone") != env.zone))))

    # ---- single port / TU / employee / operation per cluster ------------------
    g = df.groupby("_cluster", sort=False)
    multi_port = int((g["port"].nunique() > 1).sum())
    tu_from = _obj(df, "from_tu")
    tu_to = _obj(df, "to_tu")
    multi_tu = int((g["from_tu"].nunique() > 1).sum()) + int(np.sum(tu_from != tu_to))
    ops = _obj(df, "operation")
    bad_ops = int(np.sum(ops != spec.operation)) + int((g["operation"].nunique() > 1).sum())
    checks.append(_res(scope, "Single port per cluster", multi_port))
    checks.append(_res(scope, "Single TU per cluster", multi_tu))
    checks.append(_res(scope, "Single Operation per cluster (matches workflow)", bad_ops))
    tu_env = int(sum(1 for t in tu_from if not str(t).startswith(f"SIMTU-{env.code}-")))
    checks.append(_res(scope, "TU identifiers belong to the environment", tu_env))

    # ---- updaters -----------------------------------------------------------------
    upd = _obj(df, "updated_by")
    created = _obj(df, "created_by")
    human = upd != system
    human_ids = pd.Series(np.where(human, upd, None), dtype=object)
    n_humans = human_ids.groupby(clusters, sort=False).nunique()
    bad_humans = int((n_humans > 1).sum())
    if "_employee" in df.columns:
        emp_internal = _obj(df, "_employee")
        known = np.array([e is not None for e in emp_internal])
        bad_humans += int(np.sum(human & known & (upd != emp_internal)))
    checks.append(_res(scope, "One human employee per cluster (Moves: system or the cluster employee)", bad_humans))
    checks.append(_res(scope, "Middle actions always updated by the cluster employee",
                       int(np.sum(middle & ~human))))
    pool_ok = {"CC": (f"SIMUSR-{env.code}-CC-", f"SIMUSR-{env.code}-BM-"), "BM": (f"SIMUSR-{env.code}-BM-",)}[spec.workflow]
    bad_pool = int(sum(1 for u in upd if u != system and not str(u).startswith(pool_ok)))
    checks.append(_res(scope, "Employee IDs belong to the workflow's pools", bad_pool))
    checks.append(_res(scope, "Created By equals Updated By", int(np.sum(created != upd))))

    # ---- timestamps --------------------------------------------------------------
    ts = ts_ms(df["create_date"])
    upd_ts = ts_ms(df["update_date"])
    diffs = np.diff(ts)
    nonincreasing = int(np.sum((diffs <= 0) & same_prev[1:]))
    checks.append(_res(scope, "Timestamps strictly increase within clusters", nonincreasing))
    checks.append(_res(scope, "Update Date equals Create Date", int(np.sum(ts != upd_ts))))
    act = _date_ord(_obj(df, "activity_date"))
    first_ord = (ts // 86_400_000 + 719_163).astype(float)  # days since 0001-01-01 (ordinal)
    cluster_first_ord = pd.Series(first_ord).groupby(clusters, sort=False).transform("first").to_numpy()
    checks.append(_res(scope, "Activity Date is the cluster's first-row date",
                       int(np.sum(act != cluster_first_ord))))

    # ---- quantities ------------------------------------------------------------------
    fq = _num(df, "from_quantity")
    tq = _num(df, "to_quantity")
    xq = _num(df, "transaction_quantity")
    is_adj = types == "Adjust"
    is_t = types == "Adjust TU"
    rec_bad = int(np.sum(is_adj & ~(np.abs(fq + xq - tq) < 1e-9)))
    checks.append(_res(scope, "Adjust rows reconcile (To = From + Transaction)", rec_bad))
    both = ~np.isnan(fq) & ~np.isnan(tq)
    nonadj_bad = int(np.sum(~is_adj & both & (fq != tq))) + int(np.sum(~is_adj & (np.isnan(fq) != np.isnan(tq))))
    checks.append(_res(scope, "T, D, X, CA, CP, U and Move rows never change quantity", nonadj_bad))
    t_bad = int(np.sum(is_t & ~np.isnan(xq) & (xq != 0) & ~np.isnan(fq) & (xq != fq)))
    checks.append(_res(scope, "Adjust TU quantity is blank, zero or the on-hand snapshot", t_bad))
    neg = int(np.sum((fq < 0) | (tq < 0)))
    checks.append(_res(scope, "No negative quantities", neg))
    tu_type = _obj(df, "tu_type")
    caps = np.array([config.bin_max(t) if t in config.raw["bins"]["types"] else -1 for t in tu_type], dtype=float)
    over = int(np.sum((fq > caps) | (tq > caps) | (caps < 0)))
    checks.append(_res(scope, "No quantity above the bin-type maximum", over))
    tu_types_per_tu = df.groupby("from_tu")["tu_type"].nunique()
    checks.append(_res(scope, "TU Type is persistent per TU", int((tu_types_per_tu > 1).sum())))
    pos_bad = int(np.sum(is_adj & (xq > 0) & np.isin(_obj(df, "reason_code"), forbidden)))
    checks.append(_res(scope, "Positive adjustments never carry SIM_MISSING, SIM_DAMAGED or SIM_EXPIRED", pos_bad))

    # ---- chains per TU across clusters (chronological) --------------------------
    order = np.lexsort((seq, ts, tu_from.astype(str)))
    tu_o = tu_from[order]
    same_tu = np.zeros(n, dtype=bool)
    same_tu[1:] = tu_o[1:] == tu_o[:-1]
    fq_o, tq_o = fq[order], tq[order]
    qb = ~np.isnan(fq_o)
    idx = np.where(qb)[0]
    chain_bad = 0
    if len(idx) > 1:
        a, b = idx[:-1], idx[1:]
        same = tu_o[a] == tu_o[b]
        chain_bad = int(np.sum(same & (fq_o[b] != tq_o[a])))
    checks.append(_res(scope, "Quantity chain holds across clusters for each TU", chain_bad))

    fp, tp = _obj(df, "from_product")[order], _obj(df, "to_product")[order]
    flu, tlu = _obj(df, "from_lu")[order], _obj(df, "to_lu")[order]
    flot, tlot = _obj(df, "from_lot")[order], _obj(df, "to_lot")[order]
    fexp, texp = _obj(df, "from_expiry_date")[order], _obj(df, "to_expiry_date")[order]
    types_o = types[order]
    pb = np.array([v is not None for v in fp])
    pidx = np.where(pb)[0]
    prod_chain = lu_chain = attr_chain = 0
    if len(pidx) > 1:
        a, b = pidx[:-1], pidx[1:]
        same = tu_o[a] == tu_o[b]
        prod_chain = int(np.sum(same & (fp[b] != tp[a])))
        lu_chain = int(np.sum(same & (flu[b] != tlu[a])))
        attr_chain = int(np.sum(same & ((flot[b] != tlot[a]) | (fexp[b] != texp[a]))))
    is_cp = types_o == "Change Product"
    is_ca = types_o == "Change Attribute"
    prod_change = pb & (fp != tp)
    checks.append(_res(scope, "Product changes only on Change Product rows (and every CP changes it)",
                       prod_chain + int(np.sum(prod_change & ~is_cp)) + int(np.sum(is_cp & ~prod_change))))
    lu_change = pb & (flu != tlu)
    checks.append(_res(scope, "Load unit continuity (new LU only on Change Product)",
                       lu_chain + int(np.sum(lu_change & ~is_cp))))
    attr_change = pb & ((flot != tlot) | (fexp != texp))
    exp_change = pb & (fexp != texp)
    checks.append(_res(scope, "Attribute changes only on Change Attribute rows (expiry always changes there)",
                       attr_chain + int(np.sum(attr_change & ~is_ca)) + int(np.sum(is_ca & ~exp_change))))

    # ---- lot / expiry -----------------------------------------------------------------
    f_lot, f_exp = _obj(df, "from_lot"), _obj(df, "from_expiry_date")
    t_lot, t_exp = _obj(df, "to_lot"), _obj(df, "to_expiry_date")
    pair_bad = int(sum(1 for a, b in zip(f_lot, f_exp) if (a is None) != (b is None)))
    pair_bad += int(sum(1 for a, b in zip(t_lot, t_exp) if (a is None) != (b is None)))
    fe = _date_ord(f_exp)
    te = _date_ord(t_exp)
    exp_bad = int(np.sum(~np.isnan(fe) & (fe <= act))) + int(np.sum(~np.isnan(te) & (te <= act)))
    checks.append(_res(scope, "Lot and expiry populated together", pair_bad))
    checks.append(_res(scope, "Expiry after activity date", exp_bad))

    # ---- orders -------------------------------------------------------------------------
    f_ord = _obj(df, "from_order")
    is_u = types == "Unallocation"
    ord_bad = int(np.sum(is_u & np.array([v is None for v in f_ord])))
    ord_bad += int(np.sum(~is_u & np.array([v is not None for v in f_ord])))
    ord_bad += int(sum(1 for v in _obj(df, "to_order") if v is not None))
    checks.append(_res(scope, "Order columns populated only on Unallocation (From Order)", ord_bad))

    # ---- null rules -------------------------------------------------------------------
    null_bad = 0
    type_masks = {t: types == t for t in set(types)}
    for col in schema.columns:
        values = df[col.key]
        isna = values.isna().to_numpy()
        for t, mask in type_masks.items():
            rule = col.null_rule(t)
            if rule == REQUIRED:
                null_bad += int(np.sum(mask & isna))
            elif rule == BLANK:
                null_bad += int(np.sum(mask & ~isna))
    # product-detail group on Adjust TU rows: all populated or all blank
    group_na = np.vstack([df[k].isna().to_numpy() for k in PRODUCT_DETAIL_GROUP])
    mixed = group_na.any(axis=0) & ~group_na.all(axis=0)
    null_bad += int(np.sum(mixed))
    checks.append(_res(scope, "Null rules from the schema definition", null_bad,
                       f"{len(schema.columns)} columns x {len(type_masks)} transaction types"))

    # ---- bin-day rule ----------------------------------------------------------------
    ct = cluster_table(df)
    ct = ct.sort_values(["tu", "start"])
    by_day = ct.groupby(["tu", "date"]).size()
    over_two = int((by_day > 2).sum())
    tu_arr = ct["tu"].to_numpy()
    st = ct["start"].to_numpy()
    en = ct["end"].to_numpy()
    overlap = int(np.sum((tu_arr[1:] == tu_arr[:-1]) & (st[1:] <= en[:-1])))
    checks.append(_res(scope, "Bin-day rule: at most two clusters per TU per date", over_two))
    checks.append(_res(scope, "Clusters of the same TU never overlap", overlap))
    return checks


def validate_cross(config: Config, frames: dict[str, pd.DataFrame], scope: str) -> list[CheckResult]:
    """Employee, port and start-time exclusivity across the given configurations."""
    tables = [cluster_table(df) for df in frames.values() if len(df)]
    if not tables:
        return []
    ct = pd.concat(tables, ignore_index=True)
    checks: list[CheckResult] = []
    for key, label in (("employee", "No employee works overlapping clusters"),
                       ("port", "No two clusters occupy a port at overlapping times")):
        sub = ct.dropna(subset=[key]).sort_values([key, "start"])
        k = sub[key].to_numpy()
        s = sub["start"].to_numpy()
        e = sub["end"].to_numpy()
        bad = int(np.sum((k[1:] == k[:-1]) & (s[1:] <= e[:-1])))
        checks.append(_res(scope, label, bad, f"{len(sub)} clusters across {len(frames)} configuration(s)"))
    dup = int(ct["start"].duplicated().sum())
    checks.append(_res(scope, "No two clusters share an identical start timestamp", dup))
    return checks


def validate_logical(config: Config, frames: dict[str, pd.DataFrame], schema: SchemaDefinition,
                     expectations: dict[str, dict]) -> list[CheckResult]:
    checks: list[CheckResult] = []
    for name, df in frames.items():
        checks.extend(validate_config(config, name, df, schema, expectations.get(name)))
    by_env: dict[str, dict[str, pd.DataFrame]] = defaultdict(dict)
    for name, df in frames.items():
        by_env[config.configurations[name].environment][name] = df
    for env_name, env_frames in by_env.items():
        checks.extend(validate_cross(config, env_frames, env_name))
    if len(by_env) > 1:
        checks.extend([c for c in validate_cross(config, frames, "run") if "start timestamp" in c.name])
    return checks
