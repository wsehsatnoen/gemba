"""Expand finished clusters into 89-column transaction rows.

Rows are produced only from complete clusters. Transaction IDs are assigned
in chronological order across every configuration of the run, so they are
unique in a combined workbook too. Internal helper columns (prefixed with
``_``) carry the cluster key, configuration and cluster employee for
validation; they are never exported.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .cluster_generator import ConfigResult, GenerationResult
from .config import Config
from .identifiers import cluster_id, transaction_id
from .schema import SchemaDefinition

INTERNAL_COLUMNS = ("_cluster", "_config", "_employee", "_template", "_bucket", "_paused", "_tu_index")


def _expand_config(config: Config, result: ConfigResult, schema: SchemaDefinition) -> dict[str, list]:
    spec = config.configurations[result.name]
    env = config.environments[spec.environment]
    consts = config.raw["constants"]
    descriptions = config.raw["reason_descriptions"]
    segs = result.segments
    cols: dict[str, list] = {k: [] for k in schema.keys}
    for k in INTERNAL_COLUMNS:
        cols[k] = []
    ts: list[int] = []
    for rec in result.records:
        port_loc = env.port_location(rec.port)
        cid = cluster_id(rec.cluster_number) if schema.include_cluster_id else None
        for seq, r in enumerate(rec.rows, start=1):
            ts.append(r.ts_ms)
            cols["transaction_type"].append(r.ttype)
            cols["operation"].append(spec.operation)
            cols["from_quantity"].append(r.from_qty)
            cols["from_product"].append(r.from_product)
            cols["from_tu"].append(rec.tu_id)
            cols["from_location"].append(r.from_loc)
            cols["transaction_quantity"].append(r.txn_qty)
            cols["to_quantity"].append(r.to_qty)
            cols["updated_by"].append(r.updated_by)
            cols["to_product"].append(r.to_product)
            cols["to_location"].append(r.to_loc)
            cols["from_order"].append(r.from_order)
            cols["from_preselect_order_id"].append(None)
            fs = segs[r.from_seg] if r.from_seg is not None else None
            tseg = segs[r.to_seg] if r.to_seg is not None else None
            cols["from_expiry_date"].append(fs.expiry if fs is not None and fs.populated else None)
            cols["from_lot"].append(fs.lot if fs is not None and fs.populated else None)
            cols["to_expiry_date"].append(tseg.expiry if tseg is not None and tseg.populated else None)
            cols["to_lot"].append(tseg.lot if tseg is not None and tseg.populated else None)
            cols["transaction_id"].append(None)  # assigned globally below
            cols["to_tu"].append(rec.tu_id)
            cols["tu_type"].append(rec.bin_type)
            cols["from_material_status"].append(r.from_status)
            cols["to_material_status"].append(r.to_status)
            cols["reason_code"].append(r.reason)
            cols["reason_description"].append(descriptions[r.reason] if r.reason else None)
            cols["to_order"].append(None)
            cols["unit_of_measure"].append(consts["unit_of_measure"])
            cols["zone"].append(env.zone)
            cols["port"].append(port_loc)
            cols["activity_date"].append(rec.date)
            cols["created_by"].append(r.updated_by)
            cols["owner"].append(consts["owner"])
            cols["site"].append(consts["site"])
            cols["from_lu"].append(r.from_lu)
            cols["to_lu"].append(r.to_lu)
            cols["transaction_source"].append(consts["transaction_source"])
            cols["cluster_sequence_number"].append(seq)
            cols["cluster_id"].append(cid)
            cols["reference"].append(None)
            cols["_cluster"].append(rec.cluster_number)
            cols["_config"].append(rec.config)
            cols["_employee"].append(rec.employee)
            cols["_template"].append(rec.template_key)
            cols["_bucket"].append(rec.bucket)
            cols["_paused"].append(rec.paused)
            cols["_tu_index"].append(rec.tu_index)
    cols["create_date"] = ts
    cols["update_date"] = ts
    n = len(ts)
    for c in schema.columns:
        if c.key.startswith("extra_"):
            cols[c.key] = [None] * n
    return cols


def expand(config: Config, result: GenerationResult, schema: SchemaDefinition) -> dict[str, pd.DataFrame]:
    """Return one DataFrame per configuration (schema keys as column names)."""
    raw: dict[str, dict[str, list]] = {}
    for name in result.config_names:
        raw[name] = _expand_config(config, result.config(name), schema)
    # Global chronological transaction IDs.
    keys = []
    for name in result.config_names:
        cols = raw[name]
        ts = np.asarray(cols["create_date"], dtype=np.int64)
        cl = np.asarray(cols["_cluster"], dtype=np.int64)
        sq = np.asarray(cols["cluster_sequence_number"], dtype=np.int64)
        keys.append((name, ts, cl, sq))
    if keys:
        all_ts = np.concatenate([k[1] for k in keys])
        all_cl = np.concatenate([k[2] for k in keys])
        all_sq = np.concatenate([k[3] for k in keys])
        order = np.lexsort((all_sq, all_cl, all_ts))
        numbers = np.empty(len(order), dtype=np.int64)
        numbers[order] = np.arange(1, len(order) + 1)
        offset = 0
        for name, ts, _, _ in keys:
            n = len(ts)
            raw[name]["transaction_id"] = [transaction_id(int(x)) for x in numbers[offset: offset + n]]
            offset += n
    frames: dict[str, pd.DataFrame] = {}
    int_cols = [c.key for c in schema.columns if c.dtype == "int"]
    for name in result.config_names:
        cols = raw[name]
        data: dict[str, object] = {}
        for c in schema.columns:
            values = cols[c.key]
            if c.dtype == "datetime":
                data[c.key] = pd.to_datetime(np.asarray(values, dtype=np.int64), unit="ms")
            elif c.key in int_cols:
                data[c.key] = pd.array(values, dtype="Int64")
            else:
                data[c.key] = pd.Series(values, dtype=object)
        for k in INTERNAL_COLUMNS:
            data[k] = cols[k]
        df = pd.DataFrame(data)
        df = df.sort_values(["create_date", "_cluster", "cluster_sequence_number"], kind="stable").reset_index(drop=True)
        frames[name] = df
    return frames
