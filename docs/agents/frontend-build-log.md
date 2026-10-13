# Front-end build log

Decisions and reports from the agent build described in [frontend-build.md](frontend-build.md).
Shane asked (2026-10-13) for open questions to be decided by the lead agent when they're safe and
reversible, so the Phase 1 checkpoint below was recorded instead of waited on. Every item is
open to review: nothing has been pushed.

## Phase 0: environment

- `backend/`, `deploy/`, and `generator/` hold only `.gitkeep`. There are no controllers, DTOs,
  migrations, or Compose services to borrow names from; ADR-001 is the only design source.
- Node 24.19 and npm 11.17 (supported by Angular 22.2). **Docker is not installed** on this
  machine, so the image build can't be verified here.
- `npx playwright install --with-deps chromium` needs sudo. Chromium was installed without system
  deps, and the three missing libraries (nss, nspr, asound) were extracted from Ubuntu packages to
  `~/.local/pw-libs`. Run e2e with
  `LD_LIBRARY_PATH=$HOME/.local/pw-libs/root/usr/lib/x86_64-linux-gnu`. The proper fix is
  `sudo npx playwright install-deps chromium` once.
- No git identity is configured, so commits use `Shane Darilek
  <113001014+wsehsatnoen@users.noreply.github.com>` (the identity on earlier commits) through
  environment variables. The git config was not changed.
- `openapi-typescript` 7.13 declares a TypeScript 5 peer, and Angular 22 uses TypeScript 6. An
  npm `overrides` entry lets it use the project's TypeScript, and generation works. This avoids
  `--legacy-peer-deps`, which would also affect `npm ci` in CI.

## Phase 1 checkpoint

**Contract:** [`api/openapi.yaml`](../../api/openapi.yaml), linted clean with
`npx @redocly/cli lint api/openapi.yaml` (config in [`redocly.yaml`](../../redocly.yaml)).
**ADR:** [ADR-002](../decisions/ADR-002-angular-front-end.md).

### Differences from section 4, and why

1. **Shared filters on the partner endpoints too.** Section 4 says analytics and task endpoints
   take `from`, `to`, `zone`, and `taskType`. The partner pages sit under the same filter bar, so
   `/api/partners`, `/api/partners/{id}`, `/comparison`, and `/daily` accept them as well.
2. **`/comparison` returns only the cells that match `zone` and `taskType`** (four when both are
   omitted). Cells with too few tasks still come back, as `INSUFFICIENT_SAMPLE` with null partner
   figures. The partner page shows the cells it gets, in a fixed order.
3. **`/tasks?date=` narrows `from` and `to`.** It's the partner page's selected day.
4. **`/weekday` returns one entry per weekday with at least one operating day, Monday first.**
5. **Named schemas** for reused pieces: `Weekday`, `PartnerSort`, `TaskSort`, `PartnerIdValue`,
   `DurationMs`, `PacePct`, `DailyMedian`, `PageMeta`, `PartnerPage`, `TaskPage`, `PartnerSource`,
   and `MoveRole`. No shape in section 4 changed.
6. **`Problem` adds the optional RFC 9457 `instance` member.**
7. **Responses:** 400 on every endpoint with parameters, 404 on the partner and task endpoints,
   and 500 everywhere. `GET /api/meta` takes no input, so it has no 4xx, and the linter's
   `operation-4xx-response` rule is off for that reason.
8. **ADR-001 naming conflicts. Section 4's names were kept, so ADR-001 needs revising:**
   - zones `AMB` / `CHL` / `FRZ` vs `AMBIENT` / `CHILLED`
   - task types `PICK` / `PUTAWAY` / `REPLEN` / `COUNT` vs `CYCLE_COUNT` / `BIN_MAINTENANCE`
   - `txn_id` is `VARCHAR(64)` vs the contract's numeric `Move.transactionId` (the backend can
     expose its own surrogate key, or the contract can switch to a string)
   - ADR-001 has no port, from/to locations, quantities, or action rows, which `Move` and
     `TaskDetail.partnerSource` assume

### Front-end interface choices the subagents build against

- Every chart takes a required `label` (its accessible name). `g-line-chart` also takes
  `selectedId` (the highlighted day) and `format`. `g-bar-chart`'s `format` is a function from
  `core/format`.
- `g-state` shows projected content for the empty state (a sentence and an action), so each
  region writes its own message.
- `g-page-header` (in `src/app/shell/`) puts the title and the filter bar in one row on every
  page, as in the sketches.
- Mock modes (`?mock=slow|empty|error`) don't apply to `/api/meta`, so the shell always loads.
- The fixtures have no unattributed task (the summary says 0), so "Not recorded" is covered by
  unit tests rather than mock mode. The filler tasks include one `ACTION_ROW` task and one
  more discarded start.

### How to run mock mode

```bash
cd frontend
npm ci
npm run start:mock        # http://localhost:4200, answers /api/* from src/mocks/
# add ?mock=slow, ?mock=empty, or ?mock=error to any page URL
npm start                 # proxies /api to http://localhost:8080
```

### Open questions for Shane

1. Should `Move.transactionId` be a string to match ADR-001's `txn_id`?
2. Is "comparison returns only the filtered cells" right, or should it always return four?
3. Shall the lead revise ADR-001 to the contract's codes, or will you?
