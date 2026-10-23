"""The 89-column transaction schema.

All column names live here, keyed by stable internal field keys. The
generation code only uses keys; the display names can be replaced with
``--schema-file`` without touching generation logic. This schema is a
plausible stand-in and is not guaranteed to match any real export.

Null rules are explicit per transaction type:

* ``required`` - must be populated
* ``blank`` - must be empty
* ``optional`` - may be empty; group rules below decide when
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Iterable

import yaml

from .templates import ALL_TRANSACTION_TYPES

REQUIRED = "required"
BLANK = "blank"
OPTIONAL = "optional"

# Field groups whose members are populated together on a row.
PRODUCT_DETAIL_GROUP = (
    "from_quantity", "to_quantity", "from_product", "to_product",
    "from_lu", "to_lu", "from_material_status", "to_material_status",
)
FROM_LOT_GROUP = ("from_lot", "from_expiry_date")
TO_LOT_GROUP = ("to_lot", "to_expiry_date")


@dataclass(frozen=True)
class ColumnSpec:
    key: str
    name: str
    dtype: str  # datetime | date | int | string
    classification: str
    rule: str
    nulls: dict[str, str]  # transaction type -> required/blank/optional
    value_kinds: tuple[str, ...] = ()  # allowlist kinds for string columns

    def null_rule(self, transaction_type: str) -> str:
        return self.nulls.get(transaction_type, BLANK)


def _all(rule: str) -> dict[str, str]:
    return {t: rule for t in ALL_TRANSACTION_TYPES}


def _except(default: str, **per_type: str) -> dict[str, str]:
    out = _all(default)
    for key, rule in per_type.items():
        out[key.replace("_", " ")] = rule
    return out


def _only(types: Iterable[str], rule: str = REQUIRED, otherwise: str = BLANK) -> dict[str, str]:
    types = set(types)
    return {t: (rule if t in types else otherwise) for t in ALL_TRANSACTION_TYPES}


_PRODUCT_DETAIL_NULLS = {t: (OPTIONAL if t == "Adjust TU" else REQUIRED) for t in ALL_TRANSACTION_TYPES}
_LOT_NULLS = _all(OPTIONAL)

EXTRA_FIELD_NAMES = (
    "From Pallet", "To Pallet", "From Container", "To Container", "Carrier", "Shipment", "ASN",
    "Load ID", "Wave", "Task ID", "Work Order", "Order Line", "Shipment Line", "Priority",
    "Weight", "Weight UOM", "Volume", "Volume UOM", "Length", "Width", "Height", "Serial Number",
    "Batch Number", "Country of Origin", "Hazmat Class", "Temperature Reading", "Device ID",
    "Dock Door", "Route",
) + tuple(f"Attribute {i:02d}" for i in range(1, 11)) + tuple(f"UDF {i:02d}" for i in range(1, 11))


def _extra_key(name: str) -> str:
    return "extra_" + name.lower().replace(" ", "_")


def _base_columns() -> list[ColumnSpec]:
    req = _all(REQUIRED)
    cols = [
        ColumnSpec("create_date", "Create Date", "datetime", "timestamp",
                   "Row timestamp, millisecond precision; strictly increasing within a cluster.", req),
        ColumnSpec("transaction_type", "Transaction Type", "string", "enumeration",
                   "From the cluster template.", req, ("transaction_type",)),
        ColumnSpec("operation", "Operation", "string", "enumeration",
                   "Same for every row of a cluster; set by the workflow.", req, ("operation",)),
        ColumnSpec("from_quantity", "From Quantity", "int", "quantity",
                   "Bin on-hand before the row; blank on Adjust TU rows without product detail.",
                   _PRODUCT_DETAIL_NULLS),
        ColumnSpec("from_product", "From Product", "string", "synthetic identifier",
                   "Bin product before the row.", _PRODUCT_DETAIL_NULLS, ("product",)),
        ColumnSpec("from_tu", "From TU", "string", "synthetic identifier",
                   "The cluster's TU.", req, ("tu",)),
        ColumnSpec("from_location", "From Location", "string", "synthetic location",
                   "GRID for opening/re-presentation Moves, the cluster port otherwise.", req,
                   ("grid_location", "port_location")),
        ColumnSpec("transaction_quantity", "Transaction Quantity", "int", "quantity",
                   "Signed change on Adjust; blank, zero or on-hand snapshot on Adjust TU; blank otherwise.",
                   _only(["Adjust"], REQUIRED) | {"Adjust TU": OPTIONAL}),
        ColumnSpec("to_quantity", "To Quantity", "int", "quantity",
                   "Bin on-hand after the row (From + Transaction on Adjust, From otherwise).",
                   _PRODUCT_DETAIL_NULLS),
        ColumnSpec("updated_by", "Updated By", "string", "synthetic identifier",
                   "Cluster employee or 'system' on Moves; employee on middle actions.", req,
                   ("employee", "system_user")),
        ColumnSpec("to_product", "To Product", "string", "synthetic identifier",
                   "Bin product after the row; differs from From Product only on Change Product.",
                   _PRODUCT_DETAIL_NULLS, ("product",)),
        ColumnSpec("to_location", "To Location", "string", "synthetic location",
                   "PORT for opening/re-presentation Moves and middle actions, GRID for closing Moves.", req,
                   ("grid_location", "port_location")),
        ColumnSpec("from_order", "From Order", "string", "synthetic identifier",
                   "Populated on Unallocation rows only.", _only(["Unallocation"]), ("order",)),
        ColumnSpec("from_preselect_order_id", "From Preselect Order Id", "string", "unused",
                   "Always blank in these workflows.", _all(BLANK)),
        ColumnSpec("from_expiry_date", "From Expiry Date", "date", "date",
                   "Expiry of the bin's lot state before the row; populated together with From Lot.", _LOT_NULLS),
        ColumnSpec("transaction_id", "Transaction ID", "string", "synthetic identifier",
                   "Unique per row, assigned in chronological order.", req, ("transaction",)),
        ColumnSpec("to_tu", "To TU", "string", "synthetic identifier",
                   "Same as From TU.", req, ("tu",)),
        ColumnSpec("tu_type", "TU Type", "string", "enumeration",
                   "Persistent bin type of the TU.", req, ("bin_type",)),
        ColumnSpec("from_material_status", "From Material Status", "string", "enumeration",
                   "Cluster-level material status before the row.", _PRODUCT_DETAIL_NULLS, ("material_status",)),
        ColumnSpec("to_material_status", "To Material Status", "string", "enumeration",
                   "Material status after the row (may change on Adjust with SIM_EXPIRED/SIM_DAMAGED).",
                   _PRODUCT_DETAIL_NULLS, ("material_status",)),
        ColumnSpec("reason_code", "Reason Code", "string", "enumeration",
                   "Adjust, Adjust TU and Change Attribute rows only.",
                   _only(["Adjust", "Adjust TU", "Change Attribute"]), ("reason_code",)),
        ColumnSpec("reason_description", "Reason Description", "string", "enumeration",
                   "Fixed mapping from Reason Code.",
                   _only(["Adjust", "Adjust TU", "Change Attribute"]), ("reason_description",)),
        ColumnSpec("from_lot", "From Lot", "string", "synthetic identifier",
                   "Lot of the bin state before the row; populated together with From Expiry Date.",
                   _LOT_NULLS, ("lot",)),
        ColumnSpec("to_lot", "To Lot", "string", "synthetic identifier",
                   "Lot after the row; changes only on Change Attribute.",
                   _LOT_NULLS | {"Change Attribute": REQUIRED}, ("lot",)),
        ColumnSpec("to_expiry_date", "To Expiry Date", "date", "date",
                   "Expiry after the row; differs from From Expiry Date only on Change Attribute.",
                   _LOT_NULLS | {"Change Attribute": REQUIRED}),
        ColumnSpec("to_order", "To Order", "string", "unused",
                   "Always blank in these workflows (Unallocation clears the order).", _all(BLANK)),
        ColumnSpec("unit_of_measure", "Unit of Measure", "string", "constant",
                   "Always EA.", req, ("unit_of_measure",)),
        ColumnSpec("zone", "Zone", "string", "enumeration",
                   "AMBIENT or COOLER, from the environment.", req, ("zone",)),
        ColumnSpec("port", "Port", "string", "synthetic location",
                   "The cluster's port location.", req, ("port_location",)),
        ColumnSpec("activity_date", "Activity Date", "date", "date",
                   "Date of the cluster's first row.", req),
        ColumnSpec("update_date", "Update Date", "datetime", "timestamp",
                   "Equal to Create Date.", req),
        ColumnSpec("created_by", "Created By", "string", "synthetic identifier",
                   "Equal to Updated By.", req, ("employee", "system_user")),
        ColumnSpec("owner", "Owner", "string", "constant", "Always SIM_OWNER_01.", req, ("owner",)),
        ColumnSpec("site", "Site", "string", "constant", "Always SIM_SITE_01.", req, ("site",)),
        ColumnSpec("from_lu", "From LU", "string", "synthetic identifier",
                   "Load unit of the bin's product state before the row.", _PRODUCT_DETAIL_NULLS, ("lu",)),
        ColumnSpec("to_lu", "To LU", "string", "synthetic identifier",
                   "Load unit after the row; a new LU starts on Change Product.", _PRODUCT_DETAIL_NULLS, ("lu",)),
        ColumnSpec("transaction_source", "Transaction Source", "string", "constant",
                   "Always SIM_AUTOSTORE.", req, ("transaction_source",)),
        ColumnSpec("cluster_sequence_number", "Cluster Sequence Number", "int", "sequence",
                   "1..n within the cluster.", req),
        ColumnSpec("cluster_id", "Cluster ID", "string", "synthetic identifier",
                   "Blank unless --include-cluster-id is passed.", _all(BLANK), ("cluster",)),
        ColumnSpec("reference", "Reference", "string", "unused", "Always blank in these workflows.", _all(BLANK)),
    ]
    for name in EXTRA_FIELD_NAMES:
        cols.append(ColumnSpec(_extra_key(name), name, "string", "unused (generic warehouse field)",
                               "Always blank in these workflows.", _all(BLANK)))
    return cols


@dataclass
class SchemaDefinition:
    columns: list[ColumnSpec] = field(default_factory=_base_columns)
    include_cluster_id: bool = False

    def __post_init__(self) -> None:
        if len(self.columns) != 89:
            raise ValueError(f"schema must have exactly 89 columns, found {len(self.columns)}")
        keys = [c.key for c in self.columns]
        names = [c.name for c in self.columns]
        if len(set(keys)) != 89 or len(set(names)) != 89:
            raise ValueError("schema keys and names must be unique")
        if self.include_cluster_id:
            self.columns = [replace(c, nulls=_all(REQUIRED), rule="Synthetic cluster identifier (requested).")
                            if c.key == "cluster_id" else c for c in self.columns]

    @property
    def keys(self) -> list[str]:
        return [c.key for c in self.columns]

    @property
    def names(self) -> list[str]:
        return [c.name for c in self.columns]

    def by_key(self, key: str) -> ColumnSpec:
        for c in self.columns:
            if c.key == key:
                return c
        raise KeyError(key)

    def name_of(self, key: str) -> str:
        return self.by_key(key).name

    def with_names(self, names: list[str] | dict[str, str]) -> "SchemaDefinition":
        if isinstance(names, dict):
            new = [replace(c, name=str(names.get(c.key, c.name))) for c in self.columns]
        else:
            if len(names) != 89:
                raise ValueError(f"schema file must list 89 column names, found {len(names)}")
            new = [replace(c, name=str(n)) for c, n in zip(self.columns, names)]
        return SchemaDefinition(columns=new, include_cluster_id=self.include_cluster_id)


def load_schema(schema_file: str | Path | None = None, include_cluster_id: bool = False) -> SchemaDefinition:
    schema = SchemaDefinition(include_cluster_id=include_cluster_id)
    if schema_file:
        path = Path(schema_file)
        text = path.read_text(encoding="utf-8")
        data = json.loads(text) if path.suffix.lower() == ".json" else yaml.safe_load(text)
        if isinstance(data, dict) and "columns" in data:
            data = data["columns"]
        if not isinstance(data, (list, dict)):
            raise ValueError("schema file must contain a list of 89 names or a mapping key -> name")
        schema = schema.with_names(data)
    return schema
