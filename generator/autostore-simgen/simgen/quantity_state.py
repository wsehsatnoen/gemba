"""Chronological bin-state pass.

Scheduled clusters of one configuration are processed in start-time order.
For each cluster the pass

1. pre-samples the template's events (Adjust signs and magnitudes, reasons,
   Adjust TU quantity modes, attribute and product changes, the cluster's
   material status and the updater of every Move);
2. picks a TU: a same-day repeat with the configured probability, otherwise a
   popularity-weighted TU not yet visited that date whose on-hand can absorb
   the sampled adjustments without going below zero or above the bin-type
   maximum (the specification's count-to-zero and capacity rules still apply
   if no such TU turns up);
3. walks the template row by row, carrying quantity, product, lot/expiry
   state, load unit and material status forward, so the quantity chain holds
   within and across clusters for the same TU.

Lot and expiry values are filled in afterwards per lot state ("segment") so
every expiry falls after every activity date on which that state is visible.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np

from .balanced import BalancedSampler, BinarySampler
from .config import Config
from .identifiers import Counter, lot_id, lu_id, order_id
from .populations import ProductPool, TUPopulation
from .rng import StreamFactory
from .scheduling import Skeleton


@dataclass(slots=True)
class RowRecord:
    ttype: str
    ts_ms: int
    from_loc: str
    to_loc: str
    updated_by: str
    from_qty: int | None = None
    txn_qty: int | None = None
    to_qty: int | None = None
    from_product: str | None = None
    to_product: str | None = None
    from_seg: int | None = None
    to_seg: int | None = None
    from_lu: str | None = None
    to_lu: str | None = None
    from_status: str | None = None
    to_status: str | None = None
    reason: str | None = None
    from_order: str | None = None


@dataclass
class ClusterRecord:
    config: str
    env_code: str
    date: dt.date
    start_ms: int
    end_ms: int
    employee: str
    port: int
    tu_id: str
    tu_index: int
    bin_type: str
    template_key: str
    template_code: str
    bucket: str
    paused: bool
    pushed: bool
    cluster_status: str
    repeat_same_day: bool
    rows: list[RowRecord]
    cluster_number: int = 0  # assigned after all configurations are generated


@dataclass
class Segment:
    """One lot/expiry state of a TU."""

    tu_index: int
    populated: bool
    first_date: dt.date
    last_date: dt.date
    parent: int | None = None
    lot_change: bool = True
    lot: str | None = None
    expiry: dt.date | None = None


@dataclass
class RunCounters:
    lu: Counter = field(default_factory=Counter)
    lot: Counter = field(default_factory=Counter)
    order: Counter = field(default_factory=Counter)


@dataclass
class StateStats:
    repeat_clusters: int = 0
    repeat_fallbacks: int = 0
    feasibility_fallbacks: int = 0
    count_to_zero_events: int = 0
    capacity_clamps: int = 0
    reversal_fixes: int = 0
    forced_employee_rows: int = 0


def _rebook(sampler: BalancedSampler, planned: int, realized: int) -> None:
    if planned != realized:
        sampler.realized[planned] -= 1
        sampler.realized[realized] += 1


class ClusterIntegrityError(RuntimeError):
    """A freshly built cluster violates a structural rule (generator bug)."""


def check_cluster(steps: tuple[str, ...], roles: tuple[str, ...], rows: list[RowRecord], cap: int, grid: str,
                  port_loc: str, system: str, employee: str) -> None:
    """Validate one complete cluster in memory before its rows are kept."""
    names = {"M": "Move", "A": "Adjust", "T": "Adjust TU", "D": "TU Dirty", "X": "TU Damaged",
             "CA": "Change Attribute", "CP": "Change Product", "U": "Unallocation"}
    if len(rows) != len(steps):
        raise ClusterIntegrityError("row count differs from the template")
    prev_ts = None
    prev_to: int | None = None
    for step, role, r in zip(steps, roles, rows):
        if r.ttype != names[step]:
            raise ClusterIntegrityError("row type differs from the template")
        if prev_ts is not None and r.ts_ms <= prev_ts:
            raise ClusterIntegrityError("timestamps not strictly increasing")
        prev_ts = r.ts_ms
        if step == "M":
            want = (grid, port_loc) if role == "open" else (port_loc, grid)
            if (r.from_loc, r.to_loc) != want or r.updated_by not in (system, employee):
                raise ClusterIntegrityError("invalid Move")
        elif (r.from_loc, r.to_loc) != (port_loc, port_loc) or r.updated_by != employee:
            raise ClusterIntegrityError("invalid middle action")
        if r.from_qty is not None:
            if prev_to is not None and r.from_qty != prev_to:
                raise ClusterIntegrityError("quantity chain broken inside the cluster")
            expected = r.from_qty + (r.txn_qty or 0) if step == "A" else r.from_qty
            if r.to_qty != expected or r.to_qty < 0 or r.to_qty > cap:
                raise ClusterIntegrityError("quantity rule violated")
            prev_to = r.to_qty


def magnitude_buckets(config: Config, config_name: str) -> list[tuple[int, int, float]]:
    """Configured magnitude buckets with the optional median anchor applied."""
    spec = config.configurations[config_name]
    prof = config.raw["adjust_magnitude_profiles"][spec.magnitude_profile]
    buckets = [(int(b[0]), int(b[1]), float(b[2])) for b in prof["buckets"]]
    anchor = float(prof.get("median_anchor_mass", 0.0))
    target = spec.magnitude_median_target
    if target is not None and anchor > 0:
        idx = next((i for i, (lo, hi, _) in enumerate(buckets) if lo <= target <= hi), None)
        if idx is not None and idx + 1 < len(buckets):
            cdf = sum(p for (_, _, p) in buckets[: idx + 1])
            if cdf < 0.5 + anchor:
                move = min(anchor, buckets[idx + 1][2])
                lo, hi, p = buckets[idx]
                buckets[idx] = (lo, hi, p + move)
                lo2, hi2, p2 = buckets[idx + 1]
                buckets[idx + 1] = (lo2, hi2, p2 - move)
    return buckets


class StatePass:
    """Runs the chronological state pass for one configuration."""

    def __init__(self, config: Config, config_name: str, tus: TUPopulation, products: ProductPool,
                 streams: StreamFactory, counters: RunCounters) -> None:
        self.config = config
        self.name = config_name
        self.spec = spec = config.configurations[config_name]
        self.env = config.environments[spec.environment]
        self.tus = tus
        self.products = products
        self.counters = counters
        raw = config.raw
        gain = config.balance_gain()
        self.system = config.system_user
        # random streams per sub-component
        self.rng_events = streams.stream("quantities", config_name, "events")
        self.rng_tu = streams.stream("quantities", config_name, "tu_selection")
        self.rng_upd = streams.stream("quantities", config_name, "updaters")
        self.rng_prod = streams.stream("quantities", config_name, "products")
        self.rng_lots = streams.stream("quantities", config_name, "lots")
        # Adjust
        self.sign_labels = ("negative", "positive", "zero")
        self.sign_p = np.array([spec.adjust_sign[k] for k in self.sign_labels])
        self.sign_sampler = BalancedSampler(self.sign_labels, gain)
        self.buckets = magnitude_buckets(config, config_name)
        self.mag_p = np.array([b[2] for b in self.buckets])
        self.mag_sampler = BalancedSampler([f"{lo}-{hi}" for lo, hi, _ in self.buckets], gain)
        reasons = raw["adjust_reason_profiles"][spec.reason_profile]
        self.reason_codes = tuple(reasons)
        self.reason_p = np.array([float(reasons[c]) for c in self.reason_codes])
        forbidden = set(raw["positive_adjust_forbidden_reasons"])
        self.forbidden_positive = forbidden
        self.positive_mask = np.array([0.0 if c in forbidden else 1.0 for c in self.reason_codes])
        self.reason_sampler = BalancedSampler(self.reason_codes, gain)
        self.status_change = {code: (str(v["to_status"]), BinarySampler(float(v["probability"]), gain))
                              for code, v in raw["material_status"]["adjust_reason_changes"].items()}
        # Material status tables
        ms = raw["material_status"]
        self.status_tables = {}
        for key in ("default", "tu_damaged_cluster", "tu_dirty_cluster"):
            labels = tuple(ms[key])
            self.status_tables[key] = (labels, np.array([float(ms[key][s]) for s in labels]),
                                       BalancedSampler(labels, gain))
        # Adjust TU
        atu = raw["adjust_tu"]
        self.t_zero_blank = BinarySampler(spec.adjust_tu_zero_or_blank_rate or 0.0, gain)
        self.t_blank = BinarySampler(float(atu["blank_share_within_zero_or_blank"]), gain)
        self.t_product_blank = BinarySampler(float(atu["product_detail_blank_rate"]), gain)
        self.t_reason_codes = tuple(atu["reasons"])
        self.t_reason_p = np.array([float(atu["reasons"][c]) for c in self.t_reason_codes])
        self.t_reason_sampler = BalancedSampler(self.t_reason_codes, gain)
        # Change attribute
        self.ca_reason = str(raw["change_attribute"]["reason"])
        self.ca_lot_change = BinarySampler(float(raw["change_attribute"]["lot_change_probability"]), gain)
        # Updaters
        upd = raw["updaters"]
        self.open_system = BinarySampler(float(upd["opening_move_system_probability"]), gain)
        self.close_system = BinarySampler(float(upd["closing_move_system_probability"]), gain)
        self.require_employee_row = bool(upd["require_employee_row"])
        # Bin-day rule
        r = float(raw["bin_day"]["repeat_rate"])
        self.repeat_sampler = BinarySampler(r / (1.0 + r), gain)
        self.handoff_lo_ms = int(round(float(raw["scheduling"]["handoff_gap_seconds"][0]) * 1000))
        self.attempts = int(raw["bins"]["feasibility_attempts"])
        # TU attributes drawn at first use
        bins = raw["bins"]
        self.bt_names = self.env.bin_type_names
        self.bt_p = np.array(self.env.bin_type_probs)
        self.bt_sampler = BalancedSampler(self.bt_names, gain)
        self.bt_cap = {b: int(bins["types"][b]["max_quantity"]) for b in self.bt_names}
        self.bt_median = {b: float(bins["types"][b]["median_on_hand"]) for b in self.bt_names}
        self.on_hand_sigma = float(bins["initial_on_hand_sigma"])
        self.min_on_hand = int(bins["min_initial_on_hand"])
        self.lot_sampler = BinarySampler(self.env.lot_populated_probability, gain)
        self.rng_init = streams.stream("quantities", config_name, "tu_attributes")
        # TU state
        m = tus.size
        self.initialized = np.zeros(m, dtype=bool)
        self.bin_type: list[str | None] = [None] * m
        self.cap = np.zeros(m, dtype=int)
        self.qty = np.zeros(m, dtype=int)
        self.product = np.full(m, -1, dtype=int)
        self.lot_populated = np.zeros(m, dtype=bool)
        self.lu = [None] * m  # type: list[str | None]
        self.seg = np.full(m, -1, dtype=int)
        self.day_ord = np.full(m, -1, dtype=int)
        self.day_count = np.zeros(m, dtype=int)
        self.last_end = np.full(m, -10**15, dtype=np.int64)
        self.today_once: list[int] = []
        self.today_ord = -1
        self.segments: list[Segment] = []
        self.stats = StateStats()
        self.grid = self.env.grid_location

    # ------------------------------------------------------------------
    def _draw_sign_and_quantity(self, prev_q: int | None) -> tuple[int, int, int | None]:
        rng = self.rng_events
        s_idx = self.sign_sampler.draw(rng, self.sign_p, record=False)
        sign = self.sign_labels[s_idx]
        if sign == "zero":
            self.sign_sampler.record_outcome(self.sign_p, s_idx)
            return 0, s_idx, None
        b_idx = self.mag_sampler.draw(rng, self.mag_p, record=False)
        lo, hi, _ = self.buckets[b_idx]
        mag = int(rng.integers(lo, hi + 1))
        q = mag if sign == "positive" else -mag
        tries = 0
        while prev_q not in (None, 0) and q == -prev_q and tries < 25:
            if hi > lo:
                choices = [v for v in range(lo, hi + 1) if v != mag]
                mag = int(choices[int(rng.integers(len(choices)))])
            else:
                b_idx = self.mag_sampler.draw(rng, self.mag_p, record=False)
                lo, hi, _ = self.buckets[b_idx]
                mag = int(rng.integers(lo, hi + 1))
            q = mag if sign == "positive" else -mag
            tries += 1
        self.sign_sampler.record_outcome(self.sign_p, s_idx)
        self.mag_sampler.record_outcome(self.mag_p, b_idx)
        return q, s_idx, b_idx

    def _plan(self, template_steps: tuple[str, ...]) -> list[dict]:
        plans: list[dict] = []
        prev_q: int | None = None
        rng = self.rng_events
        for step in template_steps:
            if step == "M":
                continue
            if step == "A":
                q, s_idx, b_idx = self._draw_sign_and_quantity(prev_q)
                allowed = self.positive_mask if q > 0 else None
                r_idx = self.reason_sampler.draw(rng, self.reason_p, allowed=allowed)
                plans.append({"step": "A", "q": q, "sign_idx": s_idx, "reason": self.reason_codes[r_idx]})
                prev_q = q
            elif step == "T":
                zero_or_blank = self.t_zero_blank.draw(rng)
                blank = self.t_blank.draw(rng) if zero_or_blank else False
                pblank = self.t_product_blank.draw(rng)
                r_idx = self.t_reason_sampler.draw(rng, self.t_reason_p)
                plans.append({"step": "T", "zero_or_blank": zero_or_blank, "blank": blank,
                              "product_blank": pblank, "reason": self.t_reason_codes[r_idx]})
            elif step == "CA":
                plans.append({"step": "CA", "lot_change": self.ca_lot_change.draw(rng)})
            else:
                plans.append({"step": step})
        return plans

    @staticmethod
    def _fits(qty: int, cap: int, deltas: list[int]) -> bool:
        x = qty
        for d in deltas:
            x += d
            if x < 0 or x > cap:
                return False
        return True

    def _feasible(self, i: int, deltas: list[int]) -> bool:
        return self._fits(int(self.qty[i]), int(self.cap[i]), deltas)

    def _propose(self) -> tuple[int, int, int]:
        """Tentative (bin-type index, initial on-hand, capacity) for a TU's first use."""
        bt = self.bt_sampler.draw(self.rng_init, self.bt_p, record=False)
        name = self.bt_names[bt]
        cap = self.bt_cap[name]
        qty = int(np.clip(np.rint(self.rng_init.lognormal(np.log(self.bt_median[name]), self.on_hand_sigma)),
                          self.min_on_hand, cap))
        return bt, qty, cap

    def _commit(self, i: int, proposal: tuple[int, int, int]) -> None:
        bt, qty, cap = proposal
        self.bt_sampler.record_outcome(self.bt_p, bt)
        self.bin_type[i] = self.bt_names[bt]
        self.cap[i] = cap
        self.qty[i] = qty
        self.product[i] = self.products.draw(self.name, self.rng_prod)
        self.lot_populated[i] = self.lot_sampler.draw(self.rng_init)
        self.initialized[i] = True

    def _select_tu(self, sk: Skeleton, deltas: list[int]) -> tuple[int, bool]:
        rng = self.rng_tu
        today = sk.date.toordinal()
        if today != self.today_ord:
            self.today_ord = today
            self.today_once = []
        want_repeat = self.repeat_sampler.draw(rng)
        if want_repeat:
            cands = [i for i in self.today_once
                     if self.day_ord[i] == today and self.day_count[i] == 1
                     and self.last_end[i] + self.handoff_lo_ms <= sk.start_ms]
            if cands:
                order = rng.permutation(len(cands))
                for k in order[: self.attempts]:
                    i = cands[int(k)]
                    if self._feasible(i, deltas):
                        return i, True
                return cands[int(order[0])], True
            # No candidate yet today: book the draw as a fresh visit instead.
            self.repeat_sampler._sampler.correct_last(1, 0)
            self.stats.repeat_fallbacks += 1
        first_unvisited: int | None = None
        proposals: dict[int, tuple[int, int, int]] = {}
        for _ in range(self.attempts):
            i = self.tus.draw(rng)
            if self.day_ord[i] == today:
                continue
            if not self.initialized[i]:
                prop = proposals.get(i) or self._propose()
                proposals[i] = prop
                if first_unvisited is None:
                    first_unvisited = i
                if self._fits(prop[1], prop[2], deltas):
                    self._commit(i, prop)
                    return i, False
                continue
            if first_unvisited is None:
                first_unvisited = i
            if self._feasible(i, deltas):
                return i, False
        if first_unvisited is not None:
            self.stats.feasibility_fallbacks += 1
            if not self.initialized[first_unvisited]:
                self._commit(first_unvisited, proposals[first_unvisited])
            return first_unvisited, False
        # Tiny populations: scan for any TU not visited today.
        for i in rng.permutation(self.tus.size):
            i = int(i)
            if self.day_ord[i] != today:
                self.stats.feasibility_fallbacks += 1
                if not self.initialized[i]:
                    self._commit(i, self._propose())
                return i, False
        for i in rng.permutation(self.tus.size):
            i = int(i)
            if self.day_count[i] < 2 and self.last_end[i] + self.handoff_lo_ms <= sk.start_ms:
                self.stats.feasibility_fallbacks += 1
                return i, True
        raise RuntimeError(f"{self.name}: TU population too small for the bin-day rule on {sk.date}")

    def _new_segment(self, i: int, populated: bool, date: dt.date, parent: int | None = None,
                     lot_change: bool = True) -> int:
        self.segments.append(Segment(tu_index=i, populated=populated, first_date=date, last_date=date,
                                     parent=parent, lot_change=lot_change))
        return len(self.segments) - 1

    def _cluster_status(self, steps: tuple[str, ...]) -> str:
        key = "tu_damaged_cluster" if "X" in steps else ("tu_dirty_cluster" if "D" in steps else "default")
        labels, p, sampler = self.status_tables[key]
        return labels[sampler.draw(self.rng_events, p)]

    def _new_product(self, current: int) -> int:
        for _ in range(100):
            k = self.products.draw(self.name, self.rng_prod)
            if k != current:
                return k
        k = int(self.rng_prod.integers(len(self.products.ids) - 1))
        return k if k < current else k + 1

    # ------------------------------------------------------------------
    def process(self, sk: Skeleton) -> ClusterRecord:
        template = sk.template
        plans = self._plan(template.steps)
        deltas = [p["q"] for p in plans if p["step"] == "A"]
        i, repeat = self._select_tu(sk, deltas)
        if repeat:
            self.stats.repeat_clusters += 1
        date = sk.date
        if self.lu[i] is None:
            self.lu[i] = lu_id(self.counters.lu.next())
        if self.seg[i] < 0:
            self.seg[i] = self._new_segment(i, bool(self.lot_populated[i]), date)
        status = self._cluster_status(template.steps)
        ts = sk.timestamps_ms()
        port_loc = self.env.port_location(sk.port)
        employee = sk.employee
        cur_qty = int(self.qty[i])
        cur_prod = int(self.product[i])
        cur_lu = self.lu[i]
        cur_seg = int(self.seg[i])
        self.segments[cur_seg].last_date = date
        cap = int(self.cap[i])
        pid = self.products.ids
        # Updaters for Moves
        move_updaters: list[str] = []
        first_move = True
        for step in template.steps:
            if step != "M":
                continue
            sampler = self.open_system if first_move else self.close_system
            move_updaters.append(self.system if sampler.draw(self.rng_upd) else employee)
            first_move = False
        has_middle = any(s != "M" for s in template.steps)
        if self.require_employee_row and not has_middle and all(u == self.system for u in move_updaters):
            move_updaters[0] = employee
            self.open_system._sampler.correct_last(1, 0)
            self.stats.forced_employee_rows += 1
        rows: list[RowRecord] = []
        plan_iter = iter(plans)
        move_k = 0
        prev_realized_q: int | None = None
        for k, (step, role) in enumerate(zip(template.steps, template.roles)):
            t = int(ts[k])
            if step == "M":
                frm, to = (self.grid, port_loc) if role == "open" else (port_loc, self.grid)
                rows.append(RowRecord("Move", t, frm, to, move_updaters[move_k], cur_qty, None, cur_qty,
                                      pid[cur_prod], pid[cur_prod], cur_seg, cur_seg, cur_lu, cur_lu,
                                      status, status))
                move_k += 1
                continue
            plan = next(plan_iter)
            if step == "A":
                q = int(plan["q"])
                planned_sign = plan["sign_idx"]
                if cur_qty + q < 0:
                    q = -cur_qty
                    self.stats.count_to_zero_events += 1
                elif cur_qty + q > cap:
                    q = cap - cur_qty
                    self.stats.capacity_clamps += 1
                if prev_realized_q not in (None, 0) and q == -prev_realized_q:
                    # never exactly reverse the previous Adjust
                    q = q - 1 if q > 0 else (q + 1 if cur_qty + q + 1 <= cap else q)
                    if q == -prev_realized_q:
                        q = 0
                    self.stats.reversal_fixes += 1
                realized_sign = 0 if q < 0 else (1 if q > 0 else 2)
                _rebook(self.sign_sampler, planned_sign, realized_sign)
                reason = plan["reason"]
                if q > 0 and reason in self.forbidden_positive:  # pragma: no cover - draws use the mask
                    raise RuntimeError("positive adjustment drew a forbidden reason")
                new_status = status
                if reason in self.status_change:
                    target_status, sampler = self.status_change[reason]
                    if status == target_status:
                        sampler.record(True)
                    elif sampler.draw(self.rng_events):
                        new_status = target_status
                rows.append(RowRecord("Adjust", t, port_loc, port_loc, employee, cur_qty, q, cur_qty + q,
                                      pid[cur_prod], pid[cur_prod], cur_seg, cur_seg, cur_lu, cur_lu,
                                      status, new_status, reason))
                cur_qty += q
                status = new_status
                prev_realized_q = q
            elif step == "T":
                if plan["zero_or_blank"]:
                    txn = None if plan["blank"] else 0
                else:
                    txn = cur_qty
                    if cur_qty == 0:
                        self.t_zero_blank._sampler.correct_last(0, 1)
                if plan["product_blank"]:
                    rows.append(RowRecord("Adjust TU", t, port_loc, port_loc, employee, None, txn, None,
                                          reason=plan["reason"]))
                else:
                    rows.append(RowRecord("Adjust TU", t, port_loc, port_loc, employee, cur_qty, txn, cur_qty,
                                          pid[cur_prod], pid[cur_prod], cur_seg, cur_seg, cur_lu, cur_lu,
                                          status, status, plan["reason"]))
            elif step in ("D", "X"):
                ttype = "TU Dirty" if step == "D" else "TU Damaged"
                rows.append(RowRecord(ttype, t, port_loc, port_loc, employee, cur_qty, None, cur_qty,
                                      pid[cur_prod], pid[cur_prod], cur_seg, cur_seg, cur_lu, cur_lu,
                                      status, status))
            elif step == "CA":
                old_seg = cur_seg
                parent_populated = self.segments[old_seg].populated
                lot_change = bool(plan["lot_change"]) or not parent_populated
                new_seg = self._new_segment(i, True, date, parent=old_seg, lot_change=lot_change)
                rows.append(RowRecord("Change Attribute", t, port_loc, port_loc, employee, cur_qty, None, cur_qty,
                                      pid[cur_prod], pid[cur_prod], old_seg, new_seg, cur_lu, cur_lu,
                                      status, status, self.ca_reason))
                cur_seg = new_seg
            elif step == "CP":
                new_prod = self._new_product(cur_prod)
                new_lu = lu_id(self.counters.lu.next())
                rows.append(RowRecord("Change Product", t, port_loc, port_loc, employee, cur_qty, None, cur_qty,
                                      pid[cur_prod], pid[new_prod], cur_seg, cur_seg, cur_lu, new_lu,
                                      status, status))
                cur_prod = new_prod
                cur_lu = new_lu
            elif step == "U":
                order = order_id(self.counters.order.next())
                rows.append(RowRecord("Unallocation", t, port_loc, port_loc, employee, cur_qty, None, cur_qty,
                                      pid[cur_prod], pid[cur_prod], cur_seg, cur_seg, cur_lu, cur_lu,
                                      status, status, None, order))
            else:  # pragma: no cover - templates are validated on load
                raise ValueError(f"unknown step {step}")
        # Persist TU state.
        self.qty[i] = cur_qty
        self.product[i] = cur_prod
        self.lu[i] = cur_lu
        self.seg[i] = cur_seg
        today = date.toordinal()
        if self.day_ord[i] == today:
            self.day_count[i] += 1
        else:
            self.day_ord[i] = today
            self.day_count[i] = 1
            self.today_once.append(i)
        self.last_end[i] = sk.end_ms
        check_cluster(template.steps, template.roles, rows, cap, self.grid, port_loc, self.system, employee)
        return ClusterRecord(config=self.name, env_code=self.env.code, date=date, start_ms=sk.start_ms,
                             end_ms=sk.end_ms, employee=employee, port=sk.port, tu_id=self.tus.ids[i], tu_index=i,
                             bin_type=str(self.bin_type[i]), template_key=template.key,
                             template_code=template.code, bucket=template.bucket, paused=sk.paused,
                             pushed=sk.pushed, cluster_status=self._first_status(rows, status),
                             repeat_same_day=repeat, rows=rows)

    @staticmethod
    def _first_status(rows: list[RowRecord], fallback: str) -> str:
        for r in rows:
            if r.from_status is not None:
                return r.from_status
        return fallback

    def assign_lots(self) -> None:
        """Fill lot IDs and expiry dates per segment (after all clusters)."""
        lo, hi = self.env.expiry_offset_days
        rng = self.rng_lots
        for seg in self.segments:
            if not seg.populated:
                continue
            parent = self.segments[seg.parent] if seg.parent is not None else None
            if parent is not None and parent.populated and not seg.lot_change:
                seg.lot = parent.lot
            else:
                seg.lot = lot_id(self.counters.lot.next())
            min_off = max(lo, (seg.last_date - seg.first_date).days + 1)
            off = int(rng.integers(min_off, max(min_off, hi) + 1))
            expiry = seg.first_date + dt.timedelta(days=off)
            if parent is not None and parent.populated and parent.expiry == expiry:
                expiry = expiry + dt.timedelta(days=1)
            seg.expiry = expiry

    def run(self, skeletons: list[Skeleton]) -> list[ClusterRecord]:
        records = [self.process(sk) for sk in sorted(skeletons, key=lambda s: s.start_ms)]
        self.assign_lots()
        return records
