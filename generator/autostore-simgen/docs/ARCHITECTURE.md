# Architecture

The generator is a single pipeline that runs per environment and then per configuration. Clusters are complete objects at every stage, and rows exist only at the very end. This matters because almost every rule in the specification is a rule about a cluster (one TU, one port, one employee, one Operation, Moves that alternate, quantities that reconcile), and those rules are much easier to keep than to repair.

## The pipeline

Generation will run in eight stages: build the workforce, fit each employee's template mix, calibrate durations, schedule, select the exact volume, size the populations, run the bin-state pass, and expand to rows. Validation, export, and the report follow.

The workforce comes first because almost everything downstream depends on it. Each environment has a Cycle Count pool and a Bin Maintenance pool, and 20 percent of each Bin Maintenance pool is cross-trained into Cycle Count while keeping its Bin Maintenance ID. Every profile is drawn once from the seed and never changes: activity weight, speed tier and multiplier, timing variability, long-pause probability and factor range, adjustment and exception tendencies, active days, and shift window. An exposure model works out who is on shift at each start time of each date, which gives every employee an expected share of clusters that accounts for active days and shift windows exactly.

Template mixes are fitted next. Each employee's tendencies tilt the template probabilities multiplicatively, and an iterative proportional fit then adjusts per-template intercepts until the share-weighted average across employees equals the configured table. In other words, individuals differ, but the population still matches the specification to machine precision.

Calibration then simulates 60,000 clusters from the actual employee population and solves two numbers per configuration. The calibration scale multiplies every gap and sets the median duration. The long-pause scale sets the P90: it first raises every employee's pause probability (keeping their relative propensity) until the average pause rate reaches 15 percent, and past that point it lengthens pauses instead. Because the P90 rises steadily along that path, a bisection will always find the answer, and the frozen values are written to the Calibration sheet.

Scheduling runs one date at a time with both workflows of an environment on one calendar. Start times are sampled from each configuration's hour weights, every active employee gets a port per configuration for the date, and each start goes to an idle employee whose shift contains it and whose port is free. The choice is weighted by activity weight, tilted toward employees who were blocked earlier and toward ports behind their target share. When nobody is available, the start is pushed to the earliest moment someone frees up plus a 2 to 20 second handoff. The template is drawn at assignment time from that employee's own mix, and the gaps from that employee's timing profile, which fixes the cluster's duration and therefore the busy intervals of the employee and the port.

Exact volume is handled by planning about 3 percent more clusters than the target needs. Selection walks the scheduled clusters in random order and keeps each one while the remaining gap is 12 rows or more. A small dynamic program then picks the most probable combination of template lengths for the remainder, and the matching number of unused clusters of exactly those lengths is kept. Nothing is truncated or modified; the unused clusters are simply dropped whole.

Populations are sized only after the volume is known. The TU population is solved so that drawing the selected number of clusters with lognormal popularity weights will touch the target number of distinct TUs, and the product subset is solved the same way. Each configuration owns a disjoint, randomly interleaved block of the environment's TU numbers, while products come from one environment pool with overlapping subsets per configuration.

The bin-state pass processes clusters in start-time order. For each one it samples the events first (Adjust signs and magnitudes, reasons, Adjust TU quantity modes, attribute and product changes, the material status, and the updater of each Move), then picks a TU that can absorb those events, then walks the template row by row while carrying quantity, product, lot state, load unit, and status forward. A TU's bin type and initial on-hand are drawn the first time it is used. Lot and expiry values are filled in afterwards per lot state, so every expiry falls after every activity date on which that state appears.

## Sampling

Categorical draws go through a deficit-corrected sampler. It keeps a running tally of expected and realized counts and tilts each draw toward categories that are behind, so the realized share of a 0.2 percent template or a status that only applies to 40 clusters will track its target closely while every individual draw stays random. Randomness comes from one seed: each component asks for a named sub-stream (scheduling, templates, timing, quantities, and so on), so drawing more numbers in one component never shifts the numbers another component sees.

## Export

Supporting sheets are built with openpyxl, but the Transactions sheets are streamed as SpreadsheetML directly, because openpyxl alone needs about 30 seconds for 100,000 rows. The two are merged by rewriting the saved package, the document properties are replaced with a minimal clean set, and the result is verified for macros, formulas, external links, data connections, hidden sheets, the notice line, metadata, and a pattern scan of every string in the file. Only then is it renamed into place.

## Module map

| Module | Role |
|---|---|
| `config.py` | Loads `config/default.yaml`, applies CLI overrides, validates every table and range |
| `identifiers.py` | SIM identifier formats and the regular expressions that enforce them |
| `rng.py` | Named, independent random sub-streams from one seed |
| `balanced.py` | Deficit-corrected categorical sampler |
| `templates.py` | Template parsing, Move roles, transitions, flattened tables, expected row mix |
| `schema.py` | The 89 columns, null rules per transaction type, schema-file renaming |
| `employees.py` | Pools, cross-training, profiles, exposure model, per-employee template mixes |
| `timing.py` | Gap model and the two-parameter duration calibration |
| `scheduling.py` | Date quotas, start times, port assignment, joint employee and port calendar |
| `rowcount.py` | Exact row selection and the remainder solver |
| `populations.py` | TU and product population sizing |
| `quantity_state.py` | Chronological bin-state pass and per-cluster integrity check |
| `cluster_generator.py` | Per-environment orchestration |
| `row_expander.py` | Cluster records to 89-column DataFrames, global transaction IDs |
| `validators/logical.py` | Cluster, location, quantity, chain, overlap, null-rule and bin-day checks |
| `validators/privacy.py` | Allowlist, identifier, pattern-scan, deny-list and metadata checks |
| `validators/statistical.py` | Targets with tolerances, ICC, tier ordering, population ratios |
| `exporter.py` | Workbook writer, package verification, atomic rename |
| `report.py` | Supporting sheet content and the Markdown report |
| `pipeline.py` | Generate, expand, validate, export, report |
| `validate_file.py` | Re-validation of an exported workbook from the file alone |
| `cli.py` | `generate` and `validate` commands |
