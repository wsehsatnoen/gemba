# Assumptions and limitations

The specification is detailed, but a few rules conflict with each other at realistic volumes, a few values are not given, and a few statements can be read more than one way. This document records every one of those decisions, why it was made, and where the setting lives. Values marked as assumptions in `config/default.yaml` are the same ones described here.

## Scheduling and ports

With `--all`, the Cycle Count and Bin Maintenance workflows of an environment share one calendar. Ports are physical and cross-trained associates work both workflows, so scheduling them separately would let a combined workbook show one port presenting two bins at once, or one associate in two clusters at once. A single `--config` run schedules its workflow alone. Thus, the same seed will produce a different AMB_CC workbook from `--config` than from `--all`.

The specification says each active employee gets a port for the date and that no two employees share a port at the same time. Read strictly, one port per employee for the whole date is impossible in the Cooler environment: seven ports serve about 23 active Cycle Count associates on a typical date. The generator therefore assigns a port per employee, per configuration, per date, and enforces exclusivity in time instead. An employee counts as idle only when they are free and their port is free (`scheduling.port_busy_policy: reassign`). The alternative `wait` policy lets a selected employee queue for an occupied port, but in testing it built queues of several minutes on busy ports and flattened the activity distribution, so it is not the default.

Port assignment keeps the previous working date's port with 90 percent probability, with one exception: an employee will not keep a port if at least half of their expected load for the date no longer fits that port's remaining target share. Heavy employees are handled first, and new draws lean toward ports behind their target. Without that exception, a port with a 2.6 percent target reached nearly 7 percent in testing.

Selection among idle employees is weighted by activity weight, as specified, but tilted by two balancing factors: employees who were blocked earlier (busy, or their port occupied) are favored when free, and employees on ports behind their target share are favored. Both gains live under `scheduling` and either can be set to 0. When no active employee's shift contains a start time, which only happens for the rare 14h and 20h starts, the employees with the nearest shift take it. A pushed start later than 22:00 fails the run loudly rather than spilling into the next date (`run.day_end_limit`).

Every run estimates the busiest-hour port utilization from the selected volume and the calibrated mean duration, and warns above 85 percent (`scheduling.capacity_warning_utilization`). Above roughly 100 percent the hour mix, port shares, and durations will drift from their targets, because waiting moves starts later, away from saturated ports, and toward faster employees (slow employees spend more time blocked). The four 20,000-row samples run at 26 percent (Ambient) and 75 percent (Cooler). A longer date range is the fix.

## Populations and TU state

Each configuration owns a disjoint, randomly interleaved block of its environment's TU numbers. Bin and product populations are separate per environment, as specified, but sharing TUs between Cycle Count and Bin Maintenance would break the quantity chain inside each per-configuration workbook, because a TU's quantity would change in the other workflow between two visits. Products are shared: each configuration uses an overlapping random subset of the environment's product pool.

A TU's persistent attributes are drawn the first time it is used rather than up front: bin type (through the balanced sampler, so the mix among TUs that appear in the data tracks the configured shares exactly), initial on-hand, product, and whether its lot state carries a lot and expiry. The specification gives the on-hand median and maximum per bin type but not the spread, so the lognormal uses a sigma of 0.6 (`bins.initial_on_hand_sigma`).

TU selection is feasibility aware. The events of a cluster are sampled before its TU is chosen, and the generator will re-draw a popularity-weighted TU up to 30 times to find one whose stock can absorb the sampled adjustments without going below zero or above the bin maximum. The specification's count-to-zero and capacity rules still apply when no such TU turns up.

The reason is a mismatch in the specification itself: Cycle Count magnitudes reach 60, while a 1x1 bin holds a median of 12. Measured on AMB_CC at 20,000 rows, without the re-draw 15.4 percent of negative adjustments counted the bin to zero and the magnitude P90 fell to 11 against a target of 15. With it, count-to-zero happened 4 times (0.2 percent) and the P90 came out at 14.

The bin-day rule is implemented as a per-cluster repeat probability of r / (1 + r), which makes the share of bin-days with two clusters equal r. A repeat picks a TU that has exactly one cluster earlier that date and whose cluster has already ended, so repeats never overlap and always start from the first cluster's final quantity and product state.

## Events within a cluster

Change Attribute will always change the expiry and will change the lot as well with 50 percent probability (`change_attribute.lot_change_probability`). On a TU whose lot state is blank, it creates one, lot and expiry together. Change Product changes the product and starts a new LU (load unit), but keeps the lot and expiry, because the validator rule says attribute changes happen only on Change Attribute rows. LUs change only on Change Product.

Lot and expiry are assigned per lot state after the whole run is generated. The offset is drawn from the configured range relative to the state's first activity date, but never less than one day past the last activity date on which that state is visible. Thus, "expiry after activity date" holds for every row, including bins revisited weeks later.

Material status is drawn once per cluster from the table that matches it (TU Damaged clusters first, then TU Dirty, then the default table) and is carried on every row with product detail. An Adjust with SIM_EXPIRED or SIM_DAMAGED switches the To status with 50 percent probability, and the new status carries through the rest of that cluster. Status does not persist between clusters, because the specification describes it as cluster level; a bin can be HOLD in one cluster and AVAILABLE in the next.

Adjust TU rows without product detail (30 percent) blank the whole product-detail group: product, lot, expiry, LU, From and To quantity, and material status. Their Transaction Quantity can still carry the on-hand snapshot, since it is a TU-level value. Reasons appear on Adjust, Adjust TU, and Change Attribute rows only; TU Dirty, TU Damaged, Change Product, Unallocation, and Move rows leave them blank.

## Updaters

The opening Move uses the 60 percent system probability and every later Move, closing or re-presentation, uses the 85 percent probability. The sentence "a system row always follows the employee action that precedes it" is read as chronological ordering, because an opening Move recorded by system cannot be preceded by any employee row inside its cluster. The consequence is worth stating plainly: a cluster with no middle actions can have both Moves recorded by system, which happens to about 33 percent of AMB_CC clusters. The employee is known internally and drives timing, but the rows do not show it. Setting `updaters.require_employee_row: true` attributes the opening Move to the employee in exactly those clusters.

## Timing and calibration

Two transitions in the templates have no base gap in the specification: Adjust into an event (M-A-CA-M) and Adjust TU into an event (M-T-X-M). They use 10 seconds and 8 seconds (`timing.base_gap_seconds.adjust_to_event` and `adjust_tu_to_event`).

The long-pause probabilities in the specification cannot produce the P90 targets on their own. P90 sits at the 90th percentile, so at least 10 percent of clusters have to carry the tail; at 1 to 3 percent (Cycle Count) or 2 to 5 percent (Bin Maintenance) the P90 stays between about 2.3 and 2.8 times the median, against targets of 3.9 to 7.1 times. The long-pause scale therefore works in two steps: it first multiplies every employee's pause probability, keeping their relative propensity, until the average pause rate reaches 15 percent (`timing.calibration.max_mean_pause_rate`), and past that point it lengthens pauses.

Pure frequency scaling was tried first and does not work for Bin Maintenance: past about 30 percent pauses the median itself moves and the P90-to-median ratio falls again, topping out near 6 against a target of 6.3 to 7.1. The 15 percent cap is also where the reachable ICC is highest. The Calibration sheet reports both multipliers and the resulting pause rate for every configuration.

Each employee's personal pause factor range sits inside the configuration's range with a 25 percent inset (`employees.long_pause_range_inset`). Pause decisions go through the balanced sampler so the realized pause count follows the calibrated rate; plain independent draws moved the Bin Maintenance P90 by up to 9 percent between seeds.

## Employees

The specification gives a distribution for adjustment and exception tendency but not for repeat-adjustment tendency, which uses the same lognormal sigma as adjustment tendency, 0.35. Adjustment tendency applies to templates containing A or T, repeat tendency to templates with two or more of them, and exception tendency to templates containing D, X, CA, CP, or U. An iterative proportional fit then makes the share-weighted average across employees equal the configured table exactly.

A cross-trained employee's Cycle Count activity weight is half of their Bin Maintenance weight (`employees.cross_trained_activity_scale`), and their Cycle Count speed tier is their Bin Maintenance tier shifted down one, kept, or shifted up one (25 / 50 / 25 percent), clamped to the tier range.

Activity weights are lognormal with sigma 0.9 as specified, but they are re-drawn (deterministically from the seed) until the expected top-20 percent share sits between 48 and 57 percent, so the realized share lands inside the 45 to 60 percent target. Speed tiers and variability categories keep their exact per-pool counts, but they are dealt so the cluster-weighted mix matches the configured shares (`employees.tier_assignment: activity_balanced`). With a purely random deal, the two or three busiest employees decide the whole duration distribution: in one test, the busiest Bin Maintenance associates were concentrated in the middle tiers, and the between-employee variance came out about a third lower than the tier shares imply.

## Sampling and statistics

Categorical draws use a deficit-corrected sampler (`sampling.balance_gain`, where 0 means plain independent draws). It keeps realized counts within about one observation of their expected values, which is what lets 0.2 percent templates and 40-cluster status tables meet their tolerances.

The Cycle Count magnitude table puts exactly 50 percent of nonzero magnitudes at or below 3, so the realized median would be a coin flip between 3 and 4. One percentage point is moved from the 4 to 5 bucket into the 3 bucket (`median_anchor_mass`), so the realized median equals the target of 3. Bin Maintenance has no median target, so its median is reported as INFO. Magnitude medians use the lower median, since magnitudes are integers; P90 values use linear interpolation.

A share metric is graded only when its tolerance spans at least one observation (`validation.min_tolerance_counts`), and a relative-tolerance metric only when its expected count is at least 4. Below that, it is reported as INFO with its counts. For example, AMB_CC has about 30 TU Damaged clusters, so one cluster is worth 3.4 percentage points and the plus or minus 3 point tolerance cannot be graded. Samples under 20,000 rows report every statistical metric as INFO, as the specification asks for at least 20,000.

The ICC is the one-way ICC(1) of the log of template-normalized duration, grouped by the cluster's employee, including clusters whose rows are all recorded by system. The log is used because durations are lognormal and long pauses would otherwise dominate the variance. Bin-type shares are measured over the unique TUs that appear in the sample.

## Identifiers and workbooks

Transaction IDs are assigned in chronological order across every configuration in a run, so they stay unique in the combined workbook; cluster IDs work the same way. TU and product numbers depend on the population sizes, which depend on the requested volume, so different targets produce different numbering. The Transactions sheets use inline strings, and the workbook's Application property reads "Synthetic Data Generator".

## Limitations

The speed persistence check is structurally out of reach for Bin Maintenance. With the specification's tiers, variability ranges, and P90 targets, a simulated population of 400 employees lands at about 0.26 to 0.28 against the 0.3 threshold (Cycle Count lands at 0.35 to 0.38), so individual seeds will fall on either side of it. In the seed 42 samples, AMB_BM passed at 0.354 and CLR_BM did not at 0.270. Each run's Calibration sheet shows the ICC its own employee population should produce.

Calibrated pause rates sit near 15 percent of clusters, well above the specification's 1 to 5 percent, for the reason given above. The specification's durations and its pause probabilities cannot both be honored.

At the default volume (20,000 rows over four weeks), each associate works only about 10 to 15 clusters a day and is idle for most of their shift. That is a property of the requested volume rather than of the model; more rows or fewer dates will raise utilization until the ports saturate.

Workbooks were checked with openpyxl, pandas, and LibreOffice Calc in headless mode. Microsoft Excel itself was not available in the build environment.
