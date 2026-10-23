# AutoStore/WMS Synthetic Transaction Generator

This package will generate fictional AutoStore/WMS (warehouse management system) inventory-control transactions and export them as Excel workbooks. It was built entirely from a written specification: no source workbooks, production exports, employee lists, or product masters were used or required, and every identifier is generated from scratch in the SIM formats (SIMUSR, SIMTU, SIMSKU, and so on). Nothing in it makes a network call.

The data is made of transaction clusters. One cluster is one bin, or TU (transport unit), presented to a port: the bin comes up from the grid, the associate performs zero or more actions at the port, and the bin goes back down. The generator will build every cluster as a complete object first and only then expand it into rows, which is what keeps timestamps, quantities, products, locations, and users consistent with each other.

Four configurations are supported, each with its own parameters: Ambient Cycle Count (AMB_CC), Cooler Cycle Count (CLR_CC), Ambient Bin Maintenance (AMB_BM), and Cooler Bin Maintenance (CLR_BM).

## Setup

Python 3.11 or newer is required. The only runtime dependencies are numpy, pandas, openpyxl, and PyYAML, plus pytest for the tests. On a machine with internet access:

```
python -m pip install -r requirements.txt
```

For a machine without internet access, download the wheels once on a connected machine, carry the folder over, and install from it:

```
python -m pip download -r requirements.txt -d wheels
python -m pip install --no-index --find-links wheels -r requirements.txt
```

Nothing else needs to be installed, and the generator never needs a network connection at runtime. The test suite passes on Python 3.11 and 3.13, and with pandas 2.2 as well as 3.0.

## Running it

Every command runs from the project root. The first four commands generate one configuration each into their own workbook; the last one generates all four, writes one workbook per configuration, and, with `--combined`, a combined workbook as well:

```
python -m simgen generate --config AMBIENT_CYCLE_COUNT --rows 20000 --seed 42 --output out/amb_cc.xlsx
python -m simgen generate --config COOLER_CYCLE_COUNT --rows 20000 --seed 42 --output out/clr_cc.xlsx
python -m simgen generate --config AMBIENT_BIN_MAINTENANCE --rows 20000 --seed 42 --output out/amb_bm.xlsx
python -m simgen generate --config COOLER_BIN_MAINTENANCE --rows 20000 --seed 42 --output out/clr_bm.xlsx

python -m simgen generate --all --rows 20000 --seed 42 --output-dir out/ --combined
```

Short names work in place of the full names (`--config AMB_CC`). Each run also writes a Markdown validation report next to its output, and an existing file will never be replaced unless `--overwrite` is passed.

There is one difference between the two forms worth knowing. With `--all`, the two workflows of an environment are scheduled together because they share physical ports and cross-trained associates, so neither can be double booked across workbooks. A single `--config` run schedules that workflow on its own. Thus, the AMB_CC workbook from a `--config` run will not be identical to the AMB_CC workbook from an `--all` run with the same seed, although both are valid.

On the development machine (a two-core container), 100,000 rows of one configuration take about 30 seconds end to end, including validation and export, and the four 20,000-row samples plus the combined workbook take about 40 seconds.

## Changing rows, dates, seed, and configuration

`--rows N` will produce exactly N rows per configuration without truncating a cluster, and `--clusters N` will produce exactly N clusters instead. The date range defaults to 2027-01-04 through 2027-01-31 so no generated event can be mistaken for a real one; `--start-date` and `--end-date` will change it. `--seed` fixes the randomness: the same seed and configuration will always produce identical data, while a different seed will produce different data.

Every other number lives in `config/default.yaml`, and no parameter is hardcoded in the generation logic. To change one, copy the file, edit the copy, and pass it with `--config-file`. The loader will validate the file before anything is generated: probability tables must sum to 1, ranges must be ordered, and port numbers must exist in their environment. The most common adjustments also have command-line options:

| Option | Effect |
|---|---|
| `--employees N` | Employee pool size for the selected configuration(s) |
| `--bin-ratio R`, `--product-ratio R` | Unique bins or products per cluster |
| `--repeat-bin-rate R` | Chance of a second same-day cluster per bin-day |
| `--adjust-mult M`, `--exception-mult M` | Scale the adjustment or exception templates (M-M absorbs the difference) |
| `--timing-mult M`, `--pause-mult M` | Scale every gap, or the long-pause component, after calibration |
| `--denylist FILE` | Local file of values (one per line) that must not appear anywhere |
| `--schema-file FILE` | YAML or JSON list of 89 replacement column names |
| `--include-cluster-id` | Populate the Cluster ID column |
| `--no-report` | Skip the Markdown report |

Volume is limited by the ports, and this is the one setting most likely to surprise. The Cooler grid has seven ports and nearly half of all starts fall in the 18:00 hour, so a very high volume over four weeks will saturate them. When that happens, starts are pushed later, and the hour mix, port shares, and durations drift from their targets. The generator estimates the busiest-hour port utilization during every run and warns when it passes 85 percent; the fix is simply a longer date range. For example, 100,000 Cooler Cycle Count rows over four weeks will run at about 157 percent of peak capacity, while the same rows over ten weeks (`--end-date 2027-03-14`) pass every statistical check.

## What is in a workbook

Each workbook will contain six sheets, none of them hidden. Transactions holds exactly 89 columns with a frozen header, an autofilter, millisecond timestamps, date and integer formats, and no formulas. Synthetic Data Notice, Validation Summary, Employee Profiles, Schema Dictionary, and Calibration follow, and each of those starts with the line `SYNTHETIC TEST DATA - NOT FOR PRODUCTION USE`. The combined workbook holds one Transactions sheet per configuration followed by the same supporting sheets.

The workbook's creator and last-modified-by are both "Synthetic Data Generator", and it carries no company, title, or other personal properties. It will be written to a temporary file in the destination folder, verified, and only then renamed into place, so a workbook that fails verification never appears.

## Schema compatibility

The 89-column schema is a plausible stand-in for an inventory-control transaction export. It is not guaranteed to match any real export. All column names live in one schema definition (`simgen/schema.py`), and `--schema-file` will rename them without touching the generation logic. Columns 41 through 89 are generic warehouse fields (pallets, containers, carrier, attributes, UDFs) that stay blank in these workflows, and the Schema Dictionary sheet documents the type, nullability by transaction type, and generation rule of every column.

## Validation

Every run validates its own output before export, in three groups. The logical checks cover cluster integrity, location alternation, quantity reconciliation and chaining across clusters, employee and port overlaps, null rules, and the bin-day rule; they must report zero errors. The privacy checks enforce an allowlist on every string cell, scan every sheet and the metadata for email addresses, phone numbers, IP addresses, URLs, file paths, and long tokens, and run the deny-list when one is given; they must also report zero failures. Either kind of failure blocks export. The statistical checks compare the output against the specification's targets and report PASS, WARN, or INFO, and a WARN does not block export.

An exported workbook can be re-validated from the file alone, which rebuilds the clusters from the rows and runs the logical, privacy, and package checks again:

```
python -m simgen validate out/amb_cc.xlsx
```

The test suite (78 tests) runs with:

```
python -m pytest
```

## Results for the seed 42 samples

The four 20,000-row samples in `out/samples` were produced with `--all --rows 20000 --seed 42 --combined`:

| Configuration | Rows | Clusters | Logical errors | Privacy failures | Statistical PASS / WARN / INFO |
|---|---|---|---|---|---|
| AMB_CC | 20,000 | 8,419 | 0 | 0 | 67 / 0 / 13 |
| CLR_CC | 20,000 | 7,778 | 0 | 0 | 61 / 0 / 10 |
| AMB_BM | 20,000 | 7,274 | 0 | 0 | 70 / 0 / 18 |
| CLR_BM | 20,000 | 7,821 | 0 | 0 | 61 / 1 / 16 |

Median durations land within 1 percent of target for all four configurations and P90 durations within 4 percent. The single WARN is the speed persistence check for CLR_BM: the ICC (intraclass correlation coefficient) of template-normalized duration across employees came out at 0.270 against a threshold of 0.3, while the other three configurations scored between 0.354 and 0.440.

This WARN is structural rather than bad luck. The Bin Maintenance P90 targets sit at six to seven times the median, and the only way to reach them with the specified speed tiers and timing variability is for roughly 15 percent of clusters to carry a long pause. Because a pause is random from cluster to cluster, it adds variance within each employee faster than the speed tiers add it between employees. A simulated population of 400 employees using the specification's own parameters lands at about 0.26 to 0.28 for Bin Maintenance and 0.35 to 0.38 for Cycle Count, so individual seeds will fall on either side of 0.3 for Bin Maintenance. Meeting it reliably needs a lower P90 target, narrower timing_sigma ranges, or wider speed tiers.

## Known limitations

The full list is in `docs/ASSUMPTIONS.md`, along with every value that the specification did not give. Two of them matter for anyone attributing durations to employees. First, the specified updater probabilities (opening Move by system 60 percent, closing Move by system 85 percent) mean that about a third of AMB_CC clusters have no human row at all, because a cluster without middle actions can have both of its Moves recorded by system. The employee still exists internally, but the rows will not show who it was; setting `updaters.require_employee_row: true` will attribute the opening Move to the employee in those clusters. Second, the long-pause probabilities in the specification (1 to 3 percent for Cycle Count, 2 to 5 percent for Bin Maintenance) cannot produce the P90 targets on their own, so calibration raises them to about 15 percent of clusters and reports exactly how far in the Calibration sheet.

Overall, the generator meets every logical and privacy requirement on all four samples and every statistical target except one that the specification's own timing parameters put out of reach for Bin Maintenance.

## Project layout

```
config/default.yaml        every tunable value, validated on load
simgen/cli.py              command-line interface (generate, validate)
simgen/pipeline.py         generate -> expand -> validate -> export -> report
simgen/cluster_generator.py per-environment orchestration
simgen/employees.py        persistent employee profiles and template mixes
simgen/timing.py           gap model and duration calibration
simgen/scheduling.py       dates, start times, ports, employee assignment
simgen/rowcount.py         exact row selection and remainder solver
simgen/populations.py      TU and product populations
simgen/quantity_state.py   chronological bin-state pass
simgen/row_expander.py     clusters to 89-column rows
simgen/validators/         logical, privacy, statistical validation
simgen/exporter.py         workbook writer, verification, atomic rename
simgen/report.py           supporting sheets and the Markdown report
docs/ARCHITECTURE.md       how the pieces fit together
docs/ASSUMPTIONS.md        assumptions and limitations
tests/                     pytest suite
```
