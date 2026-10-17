# gemba front end

The gemba front end is the Angular 22 app that displays the warehouse task analytics: the facility baseline on the overview, each partner's pace against that baseline, and every paired task down to the raw moves it was built from. It is read-only, and all of the data is synthetic.

There are four pages. The overview (`/`) shows the summary cards, a grid of median and P90 durations by zone and task type, and average tasks or task hours by weekday. The partner list (`/partners`) is a searchable, paged list of partners with their pace. The partner detail page (`/partners/:partnerId`) shows one partner's comparison tiles, daily pace chart, and tasks. The tasks page (`/tasks`) lists every task, with an Above P90 toggle. Opening any task brings up the task panel, which shows how the task was paired from its moves.

## Running it

The backend endpoints do not all exist yet, so the quickest way to see the app is mock mode. Mock mode answers every `/api/*` request from typed fixtures in `src/mocks/`:

```bash
npm ci
npm run start:mock
```

Then open `http://localhost:4200/`. Mock mode also accepts a `mock` query parameter for checking each state of a page: `?mock=slow` adds a 1.5 second delay, `?mock=empty` returns empty lists, and `?mock=error` returns a 500 Problem Details response.

To run against the local Spring backend instead, start the backend on port 8080 and run:

```bash
npm start
```

`proxy.conf.json` sends `/api` and `/actuator` to `http://localhost:8080`, so the browser only ever talks to one origin. Both dev servers listen on `0.0.0.0`, so they can be reached from outside a VM or WSL.

To run it in Docker, build the image from this folder:

```bash
docker build -t gemba-frontend .
docker run --rm -p 8080:8080 gemba-frontend
```

The image is a two-stage build. The first stage runs the Angular build on the build machine's own architecture, and the second copies the static files into `nginxinc/nginx-unprivileged`, which is the only part that needs to be ARM64 for the Pi. nginx serves the app with an `index.html` fallback, caches hashed assets for a year, never caches `index.html`, and proxies `/api/` and `/actuator/health` to a Compose service named `backend` on port 8080. Without that service running, the app will load and every API call will return a 502. On the Pi, `deploy/compose.yaml` pulls the image from GHCR (GitHub Container Registry), and the Cloudflare Tunnel points at the frontend container.

## Checks

These are the scripts a contributor will run, and CI runs all of them on pull requests that touch `frontend/` or `api/`:

| Script               | What it does                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `npm run lint`       | angular-eslint, then a Prettier check                                                         |
| `npm test`           | Vitest unit tests through `ng test`                                                           |
| `npm run build`      | The production build, with a budget that warns at 300 kB and fails at 500 kB                  |
| `npm run check:prod` | Builds for production and fails if the mock marker string shows up in `dist/`                 |
| `npm run e2e`        | Playwright against the mock build at 1280×800 and 380×800, including axe accessibility checks |
| `npm run api:lint`   | Redocly lint of `../api/openapi.yaml`                                                         |

Playwright starts its own mock dev server, so nothing needs to be running first.

## Regenerating the API types

The contract lives in `../api/openapi.yaml`, and it is the one thing the backend has to match. The TypeScript types in `src/app/api/schema.d.ts` are generated from it and never edited by hand. After changing the contract, run:

```bash
npm run api:types
```

The fixtures are typed with the generated types, so a contract change that the fixtures no longer satisfy will break the build instead of drifting silently.

## Layout

```
src/app/
  api/schema.d.ts        generated from the contract
  core/                  meta, filter state, API services, Problem Details handling, labels
  core/format/           pipes for durations, pace, counts, hours, and facility dates and times
  shared/ui/             stat card, pace pill, and the loading, empty, and error state view
  shared/charts/         hand-built SVG sparkline, bar chart, and line chart
  shell/                 top bar, navigation, and filter bar
  features/overview/
  features/partners/     list and detail
  features/tasks/        task table, task panel, and the tasks page
  app.routes.ts          lazy routes
src/mocks/               mock interceptor and fixtures (mock configuration only)
src/styles/              design tokens and base styles
e2e/                     Playwright tests
```

The URL is the state. Filters, search text, the selected day, the page, and the open task all live in query parameters, and `FilterState` (in `core/`) reads them as signals and writes them back by navigating. Thus reload, back, forward, and shared links will all restore the exact view, and nothing is kept in local storage. Every date and time is shown in the facility time zone from `GET /api/meta`, not the viewer's.

## The backend owns every number

Pairing, durations, medians, P90s, pace, gaps, counts, flags, comparison bands, and the minimum sample size all come from the Spring backend, and the front end only displays and formats them. Arithmetic on business values is allowed in exactly two places: the pipes in `core/format/` (milliseconds to `m:ss`, rounding, separators) and the scale functions in `shared/charts/` (values to SVG coordinates). In other words, a sum, average, percentage, ranking, or threshold check on API data anywhere else is a bug, and if a screen needs a number the API does not send, the fix is a new field in the contract. The one constant is the 100% pace reference line in `core/pace.ts`, which follows from the contract's definition of pace instead of from the data. This keeps the numbers in one place, at the cost of a contract change for every new figure a screen wants.
