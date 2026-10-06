# ADR-001: Transaction schema and task-duration rule

- **Status:** Proposed
- **Date:** 2026-10-05
- **Story:** #2 (0.4 Spike: transaction schema and duration rule)

## Context

gemba turns raw bin moves exported from a warehouse management system (WMS) into timed tasks. The source system does not record a task's duration. It records moves:

- When a partner starts work on a bin, the WMS logs a move that carries the partner's ID.
- When the work finishes, the WMS logs a second move on the same bin **without** a partner ID.

So a task's duration has to be derived by pairing a start move with the end move that follows it on the same bin. The generator (#6), schema (#7), CSV ingest (#8) and pairing logic (#10) all depend on one shared definition of the input file and the pairing rule. This ADR is that definition.

All names, codes and values in this document and in the project are generic and synthetic. No real data, system names, location codes or partner identifiers are used anywhere.

## Decision

### 1. CSV format

- UTF-8, comma-delimited, RFC 4180 quoting, one header row.
- Column order is not significant; columns are matched by header name.
- Row order in the file is not significant. Pairing sorts by time (see section 3).

### 2. Columns

| Column        | Type (CSV)                     | Type (Postgres) | Required | Notes |
|---------------|--------------------------------|-----------------|----------|-------|
| `txn_id`      | string, max 64                 | `VARCHAR(64)`   | yes      | Unique ID of the move in the source system. Used for de-duplication and as a tiebreaker. |
| `occurred_at` | ISO 8601 timestamp with offset | `TIMESTAMPTZ`   | yes      | e.g. `2026-03-02T14:05:31-06:00`. A timestamp without an offset is rejected. |
| `bin_id`      | string, max 32                 | `VARCHAR(32)`   | yes      | The bin being worked. The pairing key. |
| `partner_id`  | string, max 32                 | `VARCHAR(32)`   | no       | Present on start moves, empty on end moves. **Its presence is what makes a row a start.** |
| `task_type`   | string, max 32                 | `VARCHAR(32)`   | yes      | e.g. `PICK`, `PUTAWAY`, `REPLEN`, `COUNT` (placeholder set). |
| `zone`        | string, max 16                 | `VARCHAR(16)`   | yes      | e.g. `AMB`, `CHL`, `FRZ` (placeholder set). |

Classification:

- **Start move:** `partner_id` is not empty.
- **End move:** `partner_id` is empty.

There is deliberately no `move_type` column. Classifying by partner ID mirrors how the source data actually behaves, so the generator can't produce data that is cleaner than reality in this respect.

A task takes its `partner_id`, `task_type` and `zone` from its **start** move. The end move's `task_type` and `zone` are stored but not used for attribution.

Example:

```csv
txn_id,occurred_at,bin_id,partner_id,task_type,zone
T000001,2026-03-02T14:05:31-06:00,B-0412,P-1007,PICK,AMB
T000002,2026-03-02T14:06:02-06:00,B-0388,P-1021,PICK,CHL
T000003,2026-03-02T14:07:48-06:00,B-0412,,PICK,AMB
T000004,2026-03-02T14:09:10-06:00,B-0388,,PICK,CHL
```

This produces two tasks: `B-0412` by `P-1007` (2m17s) and `B-0388` by `P-1021` (3m08s). The bins are interleaved in the file, which is normal.

### 3. Pairing rule

For each bin, order its moves by `occurred_at`, then by `txn_id` as a tiebreaker. Then look at each move together with the **next** move on the same bin (`LEAD() OVER (PARTITION BY bin_id ORDER BY occurred_at, txn_id)`):

| This move | Next move on the bin | Result |
|-----------|----------------------|--------|
| start     | end                  | **Task.** Duration = end `occurred_at` − start `occurred_at`. |
| start     | start                | The earlier start is **superseded**. No task; the later start wins. |
| start     | none                 | **Unclosed start.** No task yet; may be closed by a later upload. |
| end       | (previous move is not a start) | **Orphan end.** No task. |

"Later start wins" covers a different partner taking over the bin and a station malfunction that forces a re-scan. In both cases the earlier start does not represent the task that was actually completed.

Durations are always computed from absolute timestamps, so tasks that cross midnight or a shift boundary need no special handling. A task is attributed to the **date of its start move** in the facility's time zone.

### 4. Re-pairing across uploads

Tasks are **derived data and disposable**. On each import:

1. Insert the new transactions.
2. Collect the set of bins touched by the import.
3. Delete existing tasks for those bins.
4. Re-run the pairing query over **all** transactions on those bins and insert the resulting tasks.

This one mechanism handles:

- **Pairs split across uploads.** A start in Monday's file and its end in Tuesday's file pair up when Tuesday is imported.
- **Unclosed starts.** They are re-evaluated whenever their bin is touched again.
- **Orphan ends** that are really the close of a start from an earlier upload.
- **Out-of-order or backfilled rows.** Ordering is always by `occurred_at`, never by import order.

It requires an index on `transaction (bin_id, occurred_at, txn_id)`.

### 5. De-duplication

`txn_id` is unique. A row whose `txn_id` already exists is skipped, not an error, so re-uploading an overlapping file is safe. Reporting skipped and rejected rows is M2 scope.

## Alternatives considered

- **Incremental pairing that only looks at new rows plus pending starts.** Faster on paper, but it breaks on backfilled or out-of-order data and needs a separate "pending" state. Rejected: re-pairing touched bins is simpler and correct, and a bin has few moves.
- **Pairing in Java instead of SQL.** Rejected for M1: a window function expresses "next move on the same bin" directly, and the database already has the rows sorted by the index.
- **Explicit `move_type` column.** Rejected: see section 2.

## Consequences

- The generator (#6) must emit exactly these columns and leave `partner_id` empty on end moves.
- Pairing tests (#10) must cover: interleaved bins, rows out of order in the file, a second start before an end, an unclosed start, an orphan end, and a pair split across two imports.
- An import's cost scales with the total history of the bins it touches. That's fine at demo scale; revisit if bin history grows into the millions.

## Open questions (owner to decide)

1. **Maximum plausible duration.** Should a pair longer than some cap (e.g. 4 hours) be treated as an anomaly instead of a task? Without a cap, a start left open overnight and closed the next morning becomes a 14-hour task.
2. **Zero-duration tasks.** A start and end with identical timestamps: keep, drop, or flag?
3. **End-move attributes.** If an end move's `task_type` or `zone` disagrees with its start move, is that worth flagging in M2?
4. **Placeholder codes.** Confirm or rename the task types and zones above. Keep them generic.
