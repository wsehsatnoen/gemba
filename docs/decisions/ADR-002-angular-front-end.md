# ADR-002: Angular front end, contract-first API, backend owns every number

- **Status:** Accepted
- **Date:** 2026-10-13
- **Story:** 4.1 (front-end foundation)

## Context

gemba needs a read-only web front end that shows the facility baseline, compares a partner with the facility, and shows how one task was paired from raw moves. The original plan used React. The Spring backend is still in progress and doesn't serve the analytics endpoints yet, so the front end has to be built before the API exists.

The project's owner is a Java and Spring Boot developer who will maintain the front end and explain it in interviews.

## Decision

### 1. Angular instead of React (changed on 2026-10-13)

The front end is Angular 22, using what the CLI generates: standalone components, zoneless change detection, OnPush, signals, `input()` and `output()`, and built-in control flow. Data loads through `httpResource()` driven by signals, so changing a filter refetches.

Angular is opinionated in the same places Spring is: dependency injection, one project layout, a first-party router, HTTP client, test runner, and build. That leaves fewer choices to defend and less glue code to own. No component, chart, or state-management library is used. The three charts are hand-built SVG.

### 2. The API is contract-first

`api/openapi.yaml` (OpenAPI 3.1) is the agreement between the two halves of the app. It is written before the endpoints exist.

- The front end's types are generated from it with `openapi-typescript` (`npm run api:types`). No response type is written by hand.
- In development, the front end runs against typed fixtures (`npm run start:mock`). Because the fixtures are typed with the generated types, a contract change that the fixtures don't match fails the build.
- The backend implements the contract. A change to an endpoint's shape is a change to `api/openapi.yaml` first, reviewed by both halves.
- The contract defines its own page shape (`{ items, page: { number, size, totalElements, totalPages } }`) instead of relying on Spring Data's default `Page` JSON, and its errors are RFC 9457 Problem Details.

### 3. The backend owns every number

Pairing, durations, medians, P90s, pace, gaps, counts, flags, comparison bands, and the minimum sample size all come from the API. The front end displays and formats them.

Arithmetic on business values is allowed in exactly two places in the front end:

- the formatting pipes in `frontend/src/app/core/format/` (milliseconds to `m:ss`, rounding, separators), and
- the scale functions in `frontend/src/app/shared/charts/` (values to SVG coordinates).

Anywhere else, a sum, average, count, percentage, ranking, or threshold check on API data is a bug. If a screen needs a number the API doesn't provide, a field is added to the contract.

## Alternatives considered

- **React (the original plan).** Rejected: it needs a router, a data-fetching library, and a form approach chosen and wired by hand, which means more surface to maintain for a backend developer.
- **Server-rendered pages from Spring (Thymeleaf).** Rejected: the interactive pieces (URL-driven filters, the task panel, keyboard handling) would need client-side JavaScript anyway, and a separate static front end deploys independently on the Pi.
- **Computing figures in the browser from raw tasks.** Rejected: it would duplicate the pairing and statistics logic in two languages, and the two would drift.
- **Waiting for the backend before starting the front end.** Rejected: the contract and fixtures let both halves move in parallel.

## Consequences

- The backend must implement every endpoint in `api/openapi.yaml`, including `GET /api/meta`, and should serve Swagger UI at `/api/docs`.
- The front end can't show a figure the API doesn't send. That's intentional, and it costs a contract change each time a screen needs something new.
- Fixture values are hand-written to match the approved mockups. They don't come from the generator, so they can disagree with real backend output until the backend exists.
- The fixture zone and task type codes (`AMBIENT`, `CHILLED`, `CYCLE_COUNT`, `BIN_MAINTENANCE`) and the move fields (port, locations, quantities, action rows) go beyond ADR-001's placeholder CSV. ADR-001 needs revising to match before the generator and ingest are built.
