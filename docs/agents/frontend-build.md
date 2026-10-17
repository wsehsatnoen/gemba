# gemba front end: agent build prompt

You are the lead agent building the Angular front end for gemba. You'll orient yourself in the repo, build the shared foundation alone, stop for one review, spawn subagents to build the features in parallel, and finish with an independent review. Read the whole prompt before you start.

## 1. Context

**What gemba is.** Warehouse task analytics that pairs bin moves into timed tasks and compares partner performance. It began as an Excel tool built during an end-of-day kaizen at a fulfillment center, and this is the portfolio rebuild. All data is synthetic.

**Who uses it**
- A shift leader or scheduler who wants the facility baseline and wants to coach a partner from facts.
- A recruiter or engineer reviewing Shane's portfolio, usually on a desktop and often for about five minutes. They should understand what the app does from the first screen and be able to see how one task was built from raw data.

**Who maintains it.** Shane is a backend developer (Java, Spring Boot) who will own this code and explain it in interviews. Write conventional, readable Angular. Choose the obvious solution over a clever one, keep files small, and comment only where Angular behavior isn't obvious.

**The repo** (a monorepo)
- `backend/`: Spring Boot 4 on Java 25 with PostgreSQL, Flyway, and JdbcClient. In progress. Read it; never edit it.
- `generator/`: the Python synthetic data generator. Never edit it.
- `deploy/`: Docker Compose for a Raspberry Pi (8 GB, ARM64) behind a Cloudflare Tunnel. CI builds the images and pushes them to GitHub Container Registry; the Pi only pulls them.
- `docs/decisions/`: architecture decision records (ADRs).
- `frontend/`: yours. It doesn't exist yet.

**The machine.** You may be running in a cloud sandbox or on Shane's Ubuntu VM. Neither has a desktop, so browsers run headless. Serve the dev server on `0.0.0.0`. If something can't be installed or reached here (for example, if Playwright's browser download is blocked), say so in your Phase 0 report and keep going with what works.

**Domain terms**

| Term | Meaning |
|---|---|
| Bin | A storage tote in the automated grid. IDs look like `SIMTU004417`. |
| Port | A workstation where the grid presents a bin to a partner. |
| Task | One bin at a port: a start move to the port, zero or more actions, and an end move back to the grid. |
| Partner | A warehouse associate. IDs look like `SIMUSR0142`. |
| Zone | `AMBIENT` or `CHILLED`. |
| Task type | `CYCLE_COUNT` or `BIN_MAINTENANCE`. |
| Duration | The end move's time minus the latest start move's time on the same bin. The end move carries no partner ID, so the partner comes from the start move. If a second start arrives before the end, the later start wins and the earlier one is discarded. |
| P90 | The 90th-percentile duration for a zone and task type. |
| Pace | The facility median duration divided by the partner's median duration, as a percent. 100% equals the facility median; 112% is faster. |
| Gap | The time between a partner's consecutive tasks. |

## 2. Rules

1. **The Spring backend owns every number.** Pairing, durations, medians, P90s, pace, gaps, counts, flags, comparison bands, and the minimum sample size all come from the API. The front end displays and formats them. Arithmetic on business values is allowed in exactly two places: the formatting pipes in `src/app/core/format/` (milliseconds to `m:ss`, rounding, separators) and the scale functions in `src/app/shared/charts/` (values to SVG coordinates). Code anywhere else that derives a business number from API data (a sum, average, count, percentage, ranking, or threshold check) is a bug. Pagination and layout math are fine, and so is choosing what to show from a flag, an enum, or a null the API sends. If a screen needs a number the API doesn't provide, add a field to the contract instead of computing it.
2. **Synthetic data only.** Never use real names, employee IDs, facility numbers, or company or vendor system names. Every page shows a "Synthetic data" badge.
3. **Read-only.** No upload, login, admin, or settings screens in this build.
4. **The URL is the state.** Filters, search text, the selected day, the page number, and the open task all live in query parameters, so reload, back, forward, and shared links restore the exact view. Don't keep data or filters in localStorage.
5. **Facility time, not browser time.** Show every date and time in the time zone from `GET /api/meta`, whatever time zone the viewer is in.
6. **Git.** Work on the branch `feat/angular-frontend`; subagents use their own branches (section 8). Commit in small steps with messages like `feat(frontend): overview grid (story 4.2)`. Don't push or open pull requests unless Shane tells you to, and never touch `main`. Shane opens the pull requests.
7. **Dependencies.** Allowed without asking: Angular 22 packages (including `@angular/cdk` and `@angular/aria`), `openapi-typescript`, `@redocly/cli`, `@playwright/test`, `@axe-core/playwright`, `angular-eslint`, and `prettier`. Anything else needs a reason in your report and Shane's approval. No component library (Angular Material, PrimeNG, Bootstrap), chart library, state-management library, or web fonts.
8. **Done means tested.** Every component, service, and pipe has tests, and `npm run lint`, `npm test`, and `npm run build` pass before any agent reports done.

## 3. Stack

- **Angular 22** (the latest 22.x) with the defaults the CLI generates: standalone components, zoneless change detection, OnPush, signals, `input()` and `output()`, and built-in control flow (`@if`, `@for`). Use whatever the v22 CLI generates for services. No NgModules, zone.js, `*ngIf`, or `@Input()` decorators.
- **Node:** an LTS version that Angular 22's compatibility table supports.
- **Data loading:** `httpResource()` driven by signals, so changing a filter refetches. `HttpClient` with `withFetch()`. All requests go to relative `/api/...` URLs.
- **API types:** generated from `api/openapi.yaml` by `openapi-typescript` into `src/app/api/schema.d.ts` (`npm run api:types`). Hand-written services use these types. Never hand-write a response type.
- **Styling:** plain CSS with custom properties in `src/styles/tokens.css`, light and dark mode from `prefers-color-scheme`, the system font stack, and `font-variant-numeric: tabular-nums` for figures. Use `@angular/cdk` or Angular Aria for focus trapping, keyboard behavior, and breakpoints instead of hand-rolling them.
- **Charts:** hand-built SVG components in `src/app/shared/charts/`. There are only three (sparkline, bar chart, line chart), and they have to match the design exactly.
- **Tests:** Vitest through `ng test` (the CLI default), Playwright for end-to-end tests, and `@axe-core/playwright` for accessibility.
- **Lint and format:** angular-eslint and Prettier.
- **Current Angular guidance:** if the Angular CLI's MCP server is available (`npx -y @angular/cli mcp`), register it, so agents check v22 practice instead of older patterns they remember.

## 4. API contract

The backend doesn't serve these endpoints yet, so the front end is built against a contract. In Phase 1, write `api/openapi.yaml` (OpenAPI 3.1) from this section. The Spring backend will implement it, so it's the agreement between the two halves of the app.

Before writing it, read `backend/`: controllers, DTOs, entities, Flyway migrations, and `docs/decisions/`. Where the backend already has a name for something (a path, an enum value, a field), use the backend's name and note the difference in your report.

**Conventions**
- Base path `/api`, JSON, camelCase fields.
- Durations are integer milliseconds, named `...Ms`. Pace is a number where 100 is the facility median (`pacePct`). Counts are integers.
- Dates are `YYYY-MM-DD`. Timestamps are ISO 8601 with an offset (`2027-01-19T18:41:55.918-06:00`).
- Every analytics and task endpoint accepts the shared filters: `from` and `to` (inclusive dates), `zone` (`AMBIENT` | `CHILLED`; omitted means both), and `taskType` (`CYCLE_COUNT` | `BIN_MAINTENANCE`; omitted means both).
- Errors are `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, and an optional `errors: [{ field, message }]`. An invalid filter returns 400.
- Lists are paged as `{ items: T[], page: { number, size, totalElements, totalPages } }`. `page` is zero-based; `size` defaults to 25, with a max of 100. Define this shape in the contract instead of relying on Spring Data's default `Page` JSON.
- `Comparison` is `FASTER` | `SIMILAR` | `SLOWER` | `INSUFFICIENT_SAMPLE`. The backend decides the bands and the minimum sample. The front end only maps the value to a color.
- A task's `partnerId` can be null. The attribution rule may still change, so never assume every task has a partner.
- Backend follow-up: serve Swagger UI at `/api/docs`, so it sits behind the same proxy as the API.

**Endpoints**

| Endpoint | Returns | Used by | Plan story |
|---|---|---|---|
| `GET /api/meta` | `Meta` | App start: default dates, time zone, labels | new |
| `GET /api/analytics/summary` | `Summary` | Overview cards | 1.5 |
| `GET /api/analytics/zone-task-type` | `ZoneTaskTypeStat[]` | Overview grid | 1.5, 3.1 |
| `GET /api/analytics/weekday` | `WeekdayStat[]` | Weekday chart | 3.4 |
| `GET /api/partners?q=&sort=&page=&size=` | `Page<PartnerListItem>` | Partner search and list | 3.6 |
| `GET /api/partners/{partnerId}` | `PartnerSummary` | Partner header | 3.2 |
| `GET /api/partners/{partnerId}/comparison` | `ComparisonCell[]` | Partner tiles | 3.2 |
| `GET /api/partners/{partnerId}/daily` | `PartnerDay[]` | Daily pace chart | 3.3 |
| `GET /api/tasks?partnerId=&date=&aboveP90=&sort=&page=&size=` | `Page<TaskListItem>` | Task lists | 3.9 |
| `GET /api/tasks/{taskId}` | `TaskDetail` | Task panel | 3.9 |

Partner sorts: `taskCount,desc` (default), `partnerId,asc`, and `daysWorked,desc`. Task sorts: `startedAt,desc` (default) and `durationMs,desc`.

**Schemas** (TypeScript notation; `Zone`, `TaskType`, and `Comparison` are the enums above)

```ts
Meta { datasetLabel: string; dataFrom: string; dataTo: string; facilityTimeZone: string; minSampleSize: number }

Summary { tasksPaired: number; rowsImported: number; operatingDays: number; tasksPerDay: number;
  taskHoursPerDay: number; duplicateStartsDiscarded: number; unattributedTasks: number }

ZoneTaskTypeStat { zone: Zone; taskType: TaskType; taskCount: number; medianMs: number; p90Ms: number;
  daily: { date: string; medianMs: number }[] }

WeekdayStat { weekday: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
  avgTasks: number; avgTaskHours: number }

PartnerListItem { partnerId: string; taskCount: number; daysWorked: number; pacePct: number | null;
  comparison: Comparison }

PartnerSummary extends PartnerListItem { medianGapMs: number | null; facilityMedianGapMs: number }

ComparisonCell { zone: Zone; taskType: TaskType; taskCount: number; partnerMedianMs: number | null;
  facilityMedianMs: number; pacePct: number | null; comparison: Comparison }

PartnerDay { date: string; taskCount: number; pacePct: number | null; comparison: Comparison;
  medianGapMs: number | null; tasksAboveP90: number }

TaskListItem { taskId: number; startedAt: string; endedAt: string; zone: Zone; taskType: TaskType; port: number;
  binId: string; partnerId: string | null; durationMs: number; p90Ms: number; aboveP90: boolean }

TaskDetail extends TaskListItem { partnerSource: 'START_MOVE' | 'ACTION_ROW' | null; moves: Move[] }

Move { transactionId: number; occurredAt: string; transactionType: string; fromLocation: string | null;
  toLocation: string | null; partnerId: string | null; quantityBefore: number | null; quantityAfter: number | null;
  quantityChange: number | null; role: 'DISCARDED_START' | 'START' | 'ACTION' | 'END'; note: string | null }
```

## 5. What to build

Most people will see this on a desktop, so design for desktop first (1024 px and wider) and make sure it holds up at 380 px. Center the content with a maximum width of 1200 px.

### App shell (every page)
- A top bar with the "gemba" wordmark (links to `/`); nav links Overview, Partners, and Tasks; and on the right, the "Synthetic data" badge (amber), an "API docs" link, and a "GitHub" link. Both URLs come from the environment file: `apiDocsUrl` (default `/api/docs`) and `repoUrl` (default `https://github.com/wsehsatnoen/gemba`).
- A filter bar on every page: a date range (two date inputs limited to `meta.dataFrom` through `meta.dataTo`, defaulting to the whole range), a zone menu (All zones, Ambient, Chilled), and a task type menu (All task types, Cycle count, Bin maintenance). Query parameters: `from`, `to`, `zone`, and `taskType`. If a parameter is invalid, fall back to its default and show a small notice.
- Under 1024 px, the nav becomes a compact row, and the filters become chips that open a panel.

### Overview (`/`)
- The title "Overview" and one line under it: "Each task pairs a bin's start move with its end move. Select any number to see the tasks behind it."
- Four summary cards, four across on desktop and 2×2 on mobile:
  - Tasks paired, with "from {rowsImported} rows" under it
  - Tasks per day, with "{operatingDays} operating days"
  - Task hours per day, with "time on task"
  - Duplicate starts discarded, with "later start kept"

  If `unattributedTasks` is above zero, add a quiet note: "{n} tasks have no partner ID."
- A "Median task time" grid, with columns for Ambient and Chilled and rows for Cycle count and Bin maintenance. Each cell shows the median (large), the task count, the P90, and a sparkline of the `daily` medians, and links to `/tasks` with that zone, that task type, and the current dates.
- A "By day of week" bar chart with a Tasks / Hours toggle (`avgTasks` / `avgTaskHours`), values on the bars, and the caption "Average per operating day".
- On desktop, the cards run across the top, with the grid (about 60% of the width) beside the chart. On mobile, everything stacks.

### Partners (`/partners`)
- A search box (debounced 300 ms; `q` in the URL) and a paged list showing partner ID, tasks, days worked, and a pace pill. The default sort is task count, not pace, because this is a coaching tool, not a leaderboard. Use a table on desktop and stacked rows on mobile. A row opens `/partners/:partnerId` with the filters kept.

### Partner detail (`/partners/:partnerId`)
- A header with the partner ID; "{taskCount} tasks · {daysWorked} days worked · median gap between tasks {gap} (facility {facilityGap})"; and on the right, the pace as a large percent colored by `comparison`, with "pace vs facility" under it.
- Four comparison tiles (one row on desktop, 2×2 on mobile): "Ambient cycle count", "Chilled cycle count", "Ambient bin maintenance", and "Chilled bin maintenance". Each shows a pace pill, "{partner median} vs {facility median}", and "{taskCount} tasks". For `INSUFFICIENT_SAMPLE`, show a gray "Too few" pill and "Needs {minSampleSize} tasks".
- A legend: "Pace = facility median ÷ partner median. Green is faster, amber slower, gray under {minSampleSize} tasks."
- A "Daily pace" line chart with one point per day worked, a dashed 100% reference line, and points colored by `comparison` (`SLOWER` in amber). Selecting a point (click or Enter) sets `day` in the URL and filters the task list below to that day, shown as a removable "Jan 19 ×" chip.
- The shared task table for this partner, newest first, with "{n} above P90" for the selected day.
- On desktop, the task panel opens in a right-hand column about 390 px wide, and the page content stays visible beside it.

### Tasks (`/tasks`)
- The shared task table with the filter bar, an "Above P90 only" toggle (`aboveP90`), and an optional partner filter (`partnerId`). The overview grid cells link here.

### Task table (shared)
- Columns: Start (time), Zone, Task type, Duration, and an amber "Above P90" pill when `aboveP90` is true. Paged, with `page` in the URL. The selected row is highlighted, and selecting a row sets `task={taskId}` in the URL.

### Task panel (shared)
This is the screen that shows the backend's work, so build it carefully.
- It opens from `?task={taskId}`. On desktop (1024 px and wider), it's a side panel beside the list. On mobile, it's a full-screen view with a back arrow. Esc or × closes it by removing `task`. Focus moves into the panel when it opens and back to the row when it closes.
- The header is "Task {taskId}", with "{Zone} · {Task type} · Port {port} · {Tue, Jan 19}" under it.
- The duration is shown large, with an amber "Above P90 ({p90})" pill when `aboveP90` is true.
- Two cards follow. The Partner card shows `partnerId`, or "Not recorded" when it's null, with a sub-label from `partnerSource`: "From the start move", "From an action at the port", or "No partner on any row". The Bin card shows `binId` with "Paired by bin".
- "Moves on this bin" lists one row per move, oldest first. Each row shows:
  - the time as `HH:mm:ss.SSS` in a monospace font
  - the transaction type with `fromLocation → toLocation` as sent, or the single location when only one is present
  - the quantity change when present, such as "−1 (24 → 23)"
  - the partner ID, or "No partner ID"
  - a role pill: Start and End in the accent color, Discarded in gray, and none for actions

  A `DISCARDED_START` row is muted, with its time struck through and its `note` shown.
- A footer note: "Duration = end − latest start on the same bin." When `partnerSource` is `START_MOVE`, add "The end move has no partner ID, so the partner comes from the start."

### States (every data region)
- **Loading:** skeletons the size of the content, so nothing jumps.
- **Empty:** a sentence and an action, such as "No tasks match these filters." with a "Clear filters" button.
- **Error:** the Problem Details `title` and `detail` with a "Try again" button. For an unknown partner or task, show "We couldn't find partner SIMUSR9999." with a link back.

### Formatting (only in `core/format/`)
- Durations: `m:ss` under an hour and `h:mm:ss` from an hour up, rounded to the second.
- Pace as a whole percent ("106%"); counts and tasks per day as whole numbers with thousands separators ("31,292", "1,118"); hours with one decimal ("58.4").
- Dates as "Tue, Jan 19", ranges as "Jan 4–31, 2027", list times as "18:41", and move times as "18:41:55.918".
- Everything in `meta.facilityTimeZone`, and sentence case everywhere.

### Visual design
- Flat surfaces, hairline borders, a 12 px radius on cards and 8 px on controls, and two font weights (400 and 500). No shadows or gradients.
- One accent color (blue) for links, chart bars, and the Start and End pills. Teal for the partner's pace line. Green for `FASTER`, amber for `SLOWER`, and neutral gray for `SIMILAR` and `INSUFFICIENT_SAMPLE`. Never use red for anything about a person.
- WCAG 2.2 AA contrast in light and dark mode. Color is never the only signal: pills show the percent or "Too few". Each chart has an accessible name and a visually hidden data table. Everything works by keyboard with a visible focus ring, and motion respects `prefers-reduced-motion`.

### Desktop layout sketches

Overview:
```
+-------------------------------------------------------------------------------------+
| gemba  Overview  Partners  Tasks                [Synthetic data]  API docs  GitHub  |
+-------------------------------------------------------------------------------------+
| Overview                         [Jan 4-31, 2027 v] [All zones v] [All task types v] |
| Each task pairs a bin's start move with its end move. ...                           |
| [Tasks paired  ] [Tasks per day ] [Task hours per day] [Duplicate starts discarded]  |
| [31,292        ] [1,118         ] [58.4              ] [214                       ]  |
| +- Median task time ---------------------+ +- By day of week ------ [Tasks|Hours] -+ |
| |             Ambient        Chilled     | |  #    #    #    #    #    #    #       | |
| | Cycle count 0:48  8,419    0:55  7,778 | |  #    #    #    #    #    #    #       | |
| |             P90 1:52  ~~   P90 2:08 ~~ | | Mon  Tue  Wed  Thu  Fri  Sat  Sun     | |
| | Bin maint.  2:35  7,274    2:50  7,821 | | Average per operating day             | |
| |             P90 16:30 ~~   P90 18:10 ~ | |                                       | |
| +----------------------------------------+ +---------------------------------------+ |
+-------------------------------------------------------------------------------------+
```

Partner detail with a task open:
```
+-------------------------------------------------------------------------------------+
| gemba  Overview  Partners  Tasks                [Synthetic data]  API docs  GitHub  |
+------------------------------------------------------+------------------------------+
| [Search: SIMUSR0142]       [dates v] [zone v] [type v] | Task 48213                 x |
| SIMUSR0142                                     106%    | Chilled . Cycle count .      |
| 612 tasks . 18 days worked . gap 0:21 (0:19)   pace    | Port 3 . Tue, Jan 19         |
| [Amb CC 112%] [Chl CC 95%] [Amb BM 111%] [Chl BM --]   | 3:41   [Above P90 (2:08)]    |
| Pace = facility median / partner median. ...           | [Partner]      [Bin]         |
| +- Daily pace -------------------------------------+  | Moves on this bin            |
| |  ~~~~~~~~~~ 100% - - - - - - - - - - - ~~~~~~~~   |  | 18:41:07.302 ...  Discarded  |
| |                    o Jan 19 81%                  |  | 18:41:55.918 ...  Start      |
| +--------------------------------------------------+  | 18:42:31.004 ...             |
| Tasks  [Jan 19 x]                        2 above P90  | 18:45:36.771 ...  End        |
| > 18:41  Chilled  Cycle count  3:41  [Above P90]      | Duration = end - latest ...  |
|   18:37  Chilled  Cycle count  0:52                   |                              |
+------------------------------------------------------+------------------------------+
```

On mobile, everything is one column, and the task panel is a full screen.

## 6. Mock mode

The real endpoints won't exist for a while, so in development the app runs against fixtures.

- `npm run start:mock` serves the `mock` build configuration, which registers `mockApiInterceptor` to answer `/api/*` from fixtures in `src/mocks/`. `npm start` uses `proxy.conf.json` to send `/api` to the Spring backend at `http://localhost:8080`. Both serve on `0.0.0.0`.
- The production configuration must not contain the interceptor or the fixtures. Put a unique marker string in the fixtures, and make `npm run check:prod` build for production and fail if the marker appears in `dist/`.
- Fixtures are TypeScript files typed with the generated schema types, so they can't drift from the contract without breaking the build.
- The mock may pick fixtures, and filter and page lists, by ID, day, partner, zone, and task type. It must never compute medians, P90s, pace, counts, or flags. Those are fixed values in the fixtures, exactly as the backend will send them.
- A mock-only `mock` query parameter: `slow` (1.5 s delay), `empty` (empty lists), and `error` (500 Problem Details). Unknown partner or task IDs return 404 Problem Details. The Playwright tests use these to check every state.

**Fixture values.** These match the approved mockups, so keep them. Use 95 to 105 as `SIMILAR` when assigning comparison values.
- **Meta:** `datasetLabel` "Synthetic data", `dataFrom` 2027-01-04, `dataTo` 2027-01-31, `facilityTimeZone` "America/Chicago", and `minSampleSize` 20.
- **Summary:** 31,292 tasks paired, 80,000 rows imported, 28 operating days, 1,117.6 tasks per day, 58.4 task hours per day, 214 duplicate starts discarded, and 0 unattributed tasks.
- **Zone and task type** (task count, median, P90):
  - Ambient cycle count: 8,419, 48 s, 112 s
  - Chilled cycle count: 7,778, 55 s, 128 s
  - Ambient bin maintenance: 7,274, 155 s, 990 s
  - Chilled bin maintenance: 7,821, 170 s, 1,090 s

  For each, 28 daily medians within 10% of the median.
- **Weekday** (average tasks, average task hours): Mon 1,243, 65.0; Tue 1,183, 61.8; Wed 1,152, 60.2; Thu 1,122, 58.6; Fri 1,092, 57.1; Sat 981, 51.2; Sun 1,050, 54.9. The range is exactly four weeks, so these average out to the summary's 1,117.6 tasks and 58.4 hours per day. Keep it that way if you change any of them.
- **Partner SIMUSR0142:** 612 tasks, 18 days worked, pace 105.9 (`FASTER`), median gap 21 s, facility median gap 19 s.
  - Comparison: Ambient cycle count 318 tasks, 43 s vs 48 s, 111.6 (`FASTER`); Chilled cycle count 201 tasks, 58 s vs 55 s, 94.8 (`SLOWER`); Ambient bin maintenance 84 tasks, 140 s vs 155 s, 110.7 (`FASTER`); Chilled bin maintenance 9 tasks, no partner median vs 170 s, no pace (`INSUFFICIENT_SAMPLE`).
  - Daily pace: Jan 4 104, Jan 5 108, Jan 6 99, Jan 7 112, Jan 10 106, Jan 11 110, Jan 12 103, Jan 13 115, Jan 14 109, Jan 18 102, Jan 19 81 (2 tasks above P90), Jan 20 97, Jan 21 105, Jan 25 111, Jan 26 107, Jan 27 113, Jan 28 104, Jan 31 109.
- **Eleven more partners** with IDs in the same format, including SIMUSR0207 (Task 48213 references it) and one partner with 14 tasks and `INSUFFICIENT_SAMPLE`.
- **SIMUSR0142's tasks on Jan 19:**
  - 48213: 18:41:55.918 to 18:45:36.771, Chilled cycle count, port 3, bin SIMTU004417, 220,853 ms, P90 128,000 ms, above P90, `partnerSource` `START_MOVE`
  - 48209: 18:37, Chilled cycle count, 52 s
  - 48196: 18:29, Chilled cycle count, 164 s, above P90
  - 48152: 17:58, Ambient cycle count, 41 s
  - 48147: 17:55, Ambient cycle count, 39 s
  - at least 40 more tasks across other days and partners, so paging has something to page
- **Task 48213's moves** (offset -06:00):
  1. 18:41:07.302, `MOVE`, `GRID` → `PORT-03`, SIMUSR0207, `DISCARDED_START`, note "A later start on this bin arrived before the end."
  2. 18:41:55.918, `MOVE`, `GRID` → `PORT-03`, SIMUSR0142, `START`
  3. 18:42:31.004, `ADJUST` at `PORT-03`, SIMUSR0142, 24 → 23, change −1, `ACTION`
  4. 18:45:36.771, `MOVE`, `PORT-03` → `GRID`, no partner, `END`

## 7. Project layout

```
api/openapi.yaml                    the contract, shared with the backend
docs/agents/frontend-build.md       this prompt (saved in Phase 0)
docs/decisions/ADR-00N-angular-front-end.md
frontend/
  src/app/
    api/schema.d.ts                 generated; never edited by hand
    core/                           meta, filter state, API services, Problem Details handling
    core/format/                    pipes: duration, pace, count, hours, facility date and time
    shared/ui/                      stat card, pace pill, state views (loading, empty, error)
    shared/charts/                  sparkline, bar chart, line chart
    features/overview/
    features/partners/              list and detail
    features/tasks/                 task table, task panel, tasks page
    app.routes.ts                   lazy routes with loadComponent
  src/mocks/                        interceptor and typed fixtures (mock configuration only)
  src/styles/                       tokens.css, base.css
  e2e/                              Playwright tests
  Dockerfile, nginx.conf
.github/workflows/frontend.yml
```

The component selector prefix is `g` (for example, `g-task-panel`).

## 8. How to run the build

### Phase 0: orient (you, alone)
1. Read `README.md`, `docs/decisions/`, and `backend/` (controllers, DTOs, entities, migrations), and note any names the contract should borrow. Also read `deploy/` for the backend's Compose service name.
2. Check `node -v`, `npm -v`, and `docker version`, and install Playwright's Chromium with `npx playwright install --with-deps chromium`.
3. Create the branch `feat/angular-frontend`.
4. Save this prompt, word for word, as `docs/agents/frontend-build.md`, and commit it on the branch, so subagents and later sessions can read it.
5. Report in five lines or fewer: what exists, any naming conflicts, and anything blocking you.

### Phase 1: foundation (you, alone; no subagents yet)
1. Write `api/openapi.yaml` from section 4 and lint it with `npx @redocly/cli lint api/openapi.yaml`. Write the ADR, using the next free number: the front end switched from React to Angular on Oct 13, 2026; the API is contract-first; and the backend owns every number (rule 1).
2. Scaffold with the v22 CLI into `frontend/`: project name `gemba-web`, CSS, routing, no SSR, and skip git. Check `ng new --help` for the current flag names.
3. Add angular-eslint, Prettier, `openapi-typescript`, Playwright, and axe. Add the npm scripts `start`, `start:mock`, `build`, `test`, `lint`, `e2e`, `api:types`, and `check:prod`.
4. Build:
   - the design tokens and base styles
   - the format pipes
   - `MetaService`, loaded at startup with `provideAppInitializer`
   - `FilterState`, with signals synced both ways with the router's query parameters
   - the typed API services and Problem Details handling
   - the app shell and the lazy routes
   - the mock interceptor and all the fixtures

   Write tests for the pipes, `FilterState`, and the services.
5. Create the shared components as stubs with their final inputs and outputs, so the subagents can build in parallel against fixed interfaces. Each stub renders a labeled placeholder.
   - In `shared/charts/`: `g-sparkline [points]`, `g-bar-chart [bars] [format]`, `g-line-chart [points] [reference] (pointSelect)`
   - In `shared/ui/`: `g-stat-card [label] [value] [sub]`, `g-pace-pill [pacePct] [comparison]`, `g-state [status] [problem] (retry)`
   - In `features/tasks/`: `g-task-table [query] [selectedTaskId] (taskSelect)`, `g-task-panel [taskId] (closed)`
   - A stub page for each route in its feature folder

   The 100% reference line comes from one named constant in `core/`, commented with the contract's definition of pace.
6. Run lint, the tests, the production build, and the mock build, then commit.

**Checkpoint: stop and report to Shane.** Tell him where the contract is, every difference from section 4 and why, how to run mock mode, and any open questions. Then wait for him to say continue. The contract is the one thing the backend has to match, so it gets reviewed before anything is built on top of it.

### Phase 2: features (subagents, in parallel)
Spawn one subagent per row below with your agent tool (the Task or Agent tool in Claude Code). If the tool supports git worktree isolation, give each agent its own worktree and branch off `feat/angular-frontend`; otherwise, run the agents one at a time in the order listed. Give every subagent sections 1 through 7 word for word (or tell it to read them in `docs/agents/frontend-build.md` first), plus its brief. Don't summarize them.

| Agent | Branch | Owns | Builds |
|---|---|---|---|
| A, charts and UI | `fe/charts-ui` | `src/app/shared/**` | The real chart and UI components: SVG with a `viewBox`, responsive, with accessible names, hidden data tables, and light and dark mode |
| B, tasks | `fe/tasks` | `src/app/features/tasks/**` | The task table; the task panel (side panel on desktop, full screen on mobile, focus handling, Esc); and the `/tasks` page with the Above P90 toggle |
| C, overview | `fe/overview` | `src/app/features/overview/**` | The overview page from section 5 |
| D, partners | `fe/partners` | `src/app/features/partners/**` | The partner list and detail pages, using the task table and panel through their stub interfaces |
| E, delivery | `fe/delivery` | `frontend/Dockerfile`, `frontend/nginx.conf`, `.github/workflows/frontend.yml`, and the frontend service in `deploy/` | The container, nginx, CI, and Compose pieces described below |

Story IDs for commit messages: Phase 1 is 4.1; agent B covers 5.4 (Tasks page) and 5.5 (task panel); C covers 4.2; D covers 5.1; E finishes 4.1; and the phone layout and the loading, empty, and error states are 5.2.

Agent E's brief:
- **Dockerfile:** a multi-stage build. Run the Node stage with `FROM --platform=$BUILDPLATFORM`, because the build output is static files and only the nginx stage (`nginxinc/nginx-unprivileged`) needs to be ARM64. That keeps CI from building Angular under emulation.
- **nginx:**
  - Serve the app with an `index.html` fallback.
  - Cache hashed assets for a long time, and don't cache `index.html`.
  - Turn on gzip.
  - Add security headers, including a CSP that allows only the site itself. If the CSP breaks the app because of Angular's critical-CSS inlining, turn off `inlineCritical` instead of loosening the CSP.
  - Proxy `/api/` and `/actuator/health` to the backend's Compose service on port 8080, so the browser only ever talks to one origin.
- **Compose:** add the frontend service in `deploy/` without changing the other services. Note in your report that the Cloudflare Tunnel should now point at the frontend container.
- **CI (`frontend.yml`):**
  - On pull requests that touch `frontend/**` or `api/**`: install, lint, test, build, `check:prod`, the OpenAPI lint, and Playwright against the mock build.
  - On pushes to `main`: build a `linux/arm64` image the same way the backend workflow does, and push it to `ghcr.io/wsehsatnoen/gemba-frontend`.
  - Never build on the Pi.

Every subagent follows these rules. Include them in each brief.
- Change files only in the paths you own. If a shared interface, the contract, or a foundation file needs to change, stop and report the change you need. The lead makes it.
- Follow rule 1 strictly: no arithmetic on business values outside the format pipes and the chart scales.
- Write tests, and run `npm run lint`, `npm test`, and `npm run build` before you report.
- Take Playwright screenshots of your pages at 1280×800 and 380×800 in mock mode, and look at them before you report.
- Report in 20 lines or fewer: files changed, decisions made, anything not done, and questions.

**Merging (you).** Merge A, B, C, D, and E into `feat/angular-frontend` in that order. After each merge, run lint, the tests, the build, and the end-to-end suite, and fix integration problems yourself.

### Phase 3: review (a fresh subagent)
Spawn a reviewer that hasn't seen any of the build conversation, and give it this whole prompt and the branch. It checks:
- **Rule 1:** every number on screen traces to an API field. There's no arithmetic on business values outside `core/format/` and `shared/charts/`, and no business thresholds (the minimum sample, band cutoffs) hard-coded in components.
- **Section 9:** every item, checked by running the commands, not by reading the code.
- **Screenshots:** every page, each state (`?mock=slow`, `?mock=empty`, `?mock=error`), and the open task panel, at 1280×800 and 380×800, compared against section 5 and the sketches.
- **Accessibility:** axe finds no serious or critical violations, and the keyboard path works: filter bar, overview cell, task list, open a task, then Esc returns focus to the row.
- **Production build:** no mock code, and within budget.

The reviewer reports findings ranked by severity and doesn't fix anything. You fix them, rerun the checks, and ask the reviewer to recheck only what changed.

### Phase 4: hand-off (you)
1. Write `frontend/README.md`: what the front end does; how to run it (mock, against the local backend, and in Docker); how to regenerate the types; the layout; and rule 1 in one paragraph.
2. Write a summary for Shane: what was built, how to run it, where the screenshots are, the endpoints the backend now needs to implement (mapped to plan stories), any differences from this prompt, and follow-ups.
3. Tell Shane the branch is ready. Push it only if he asks; he opens the pull request.

## 9. Done when
- In `frontend/`, `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm run check:prod`, and `npm run e2e` all pass.
- `npx @redocly/cli lint api/openapi.yaml` passes, and the fixtures type-check against the generated types.
- `npm run start:mock` shows every page with fixture data, and `npm start` proxies `/api` to `localhost:8080`.
- At 1280 px, the overview grid sits beside the weekday chart, the partner tiles fit in one row, and the task panel opens beside the list. At 380 px, there's one column, no horizontal scrolling, and a full-screen task panel.
- Filters, search, the selected day, the page, and the open task survive reload, back, and forward.
- Every data region has loading, empty, and error states.
- axe reports no serious or critical violations, and the keyboard path works.
- The production budget for the initial bundle warns at 300 kB and fails at 500 kB, and the bundle contains no mock code.
- The Docker image builds for the host architecture and serves the app, and `/api` reaches the backend through nginx.
- The README, the ADR, and the hand-off summary are written.

## 10. Out of scope
Upload or import pages, login, admin tools, the labor budget view, the staffing calculator, forecasting, server-side rendering, a service worker, translations, a dark-mode toggle (follow the system setting), and any change to `backend/` or `generator/`.
