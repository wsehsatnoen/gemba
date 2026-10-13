import {
  HttpErrorResponse,
  HttpHeaders,
  HttpInterceptorFn,
  HttpParams,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { delay, Observable, of, throwError } from 'rxjs';
import type { Problem } from '../app/core/api/types';
import { TASK_TYPES, ZONES } from '../app/core/api/types';
import {
  PARTNER_COMPARISONS,
  PARTNER_DAILY,
  PARTNER_SUMMARIES,
  PARTNERS,
} from './fixtures/partners';
import { META } from './fixtures/meta';
import { EMPTY_SUMMARY, SUMMARY } from './fixtures/summary';
import { TASK_DETAILS, TASKS } from './fixtures/tasks';
import { WEEKDAY_STATS } from './fixtures/weekday';
import { ZONE_TASK_TYPE_STATS } from './fixtures/zone-task-type';
import { MOCK_MARKER } from './marker';

/**
 * Answers `/api/*` from the fixtures in `src/mocks/fixtures/` (mock build configuration only).
 *
 * It may pick fixtures by ID and filter, sort, and page lists by the values already in
 * them. It never computes a median, P90, pace, count, or flag: those are fixed values in
 * the fixtures, exactly as the backend will send them.
 *
 * Add `?mock=slow` (1.5 s delay), `?mock=empty` (empty lists), or `?mock=error`
 * (500 Problem Details) to the page URL to see each state. `/api/meta` ignores them so
 * the app shell always loads.
 */
export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  const url = new URL(req.urlWithParams, 'http://mock.local');
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    return next(req);
  }
  if (path === '/api/meta') {
    return respond(META);
  }

  const mode = mockMode();
  const result =
    mode === 'error'
      ? serverError(req)
      : route(path, new HttpParams({ fromString: url.search.slice(1) }), mode === 'empty');
  return mode === 'slow' ? result.pipe(delay(1500)) : result;
};

type FieldError = NonNullable<Problem['errors']>[number];

type MockMode = 'slow' | 'empty' | 'error' | null;

function mockMode(): MockMode {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get('mock');
  return value === 'slow' || value === 'empty' || value === 'error' ? value : null;
}

function route(
  path: string,
  params: HttpParams,
  empty: boolean,
): Observable<HttpResponse<unknown>> {
  const invalid = validate(params);
  if (invalid.length > 0) {
    return problem(400, 'Invalid filter', 'One or more query parameters are invalid.', invalid);
  }

  const zone = params.get('zone');
  const taskType = params.get('taskType');
  const matchesFilters = (row: { zone: string; taskType: string }) =>
    (!zone || row.zone === zone) && (!taskType || row.taskType === taskType);

  if (path === '/api/analytics/summary') {
    return respond(empty ? EMPTY_SUMMARY : SUMMARY);
  }
  if (path === '/api/analytics/zone-task-type') {
    return respond(empty ? [] : ZONE_TASK_TYPE_STATS.filter(matchesFilters));
  }
  if (path === '/api/analytics/weekday') {
    return respond(empty ? [] : WEEKDAY_STATS);
  }
  if (path === '/api/partners') {
    const q = (params.get('q') ?? '').toLowerCase();
    const matches = empty ? [] : PARTNERS.filter((p) => p.partnerId.toLowerCase().includes(q));
    return respond(paged(sortBy(matches, params.get('sort') ?? 'taskCount,desc'), params));
  }

  const partner = /^\/api\/partners\/([^/]+)(\/comparison|\/daily)?$/.exec(path);
  if (partner) {
    const partnerId = decodeURIComponent(partner[1]);
    const summary = PARTNER_SUMMARIES[partnerId];
    if (!summary) {
      return problem(404, 'Partner not found', `We couldn't find partner ${partnerId}.`);
    }
    if (partner[2] === '/comparison') {
      return respond(empty ? [] : PARTNER_COMPARISONS[partnerId].filter(matchesFilters));
    }
    if (partner[2] === '/daily') {
      const days = PARTNER_DAILY[partnerId].filter((d) => inRange(d.date, params));
      return respond(empty ? [] : days);
    }
    return respond(summary);
  }

  if (path === '/api/tasks') {
    const partnerId = params.get('partnerId');
    const date = params.get('date');
    const aboveP90 = params.get('aboveP90') === 'true';
    const matches = empty
      ? []
      : TASKS.filter(
          (t) =>
            matchesFilters(t) &&
            inRange(facilityDate(t.startedAt), params) &&
            (!partnerId || t.partnerId === partnerId) &&
            (!date || facilityDate(t.startedAt) === date) &&
            (!aboveP90 || t.aboveP90),
        );
    return respond(paged(sortBy(matches, params.get('sort') ?? 'startedAt,desc'), params));
  }

  const task = /^\/api\/tasks\/(\d+)$/.exec(path);
  if (task) {
    const detail = TASK_DETAILS.find((t) => t.taskId === Number(task[1]));
    return detail
      ? respond(detail)
      : problem(404, 'Task not found', `We couldn't find task ${task[1]}.`);
  }

  return problem(404, 'Not found', `No mock for ${path}.`);
}

function validate(params: HttpParams): FieldError[] {
  const errors: FieldError[] = [];
  const zone = params.get('zone');
  const taskType = params.get('taskType');
  const size = params.get('size');
  if (zone && !(ZONES as readonly string[]).includes(zone)) {
    errors.push({ field: 'zone', message: 'Must be AMBIENT or CHILLED.' });
  }
  if (taskType && !(TASK_TYPES as readonly string[]).includes(taskType)) {
    errors.push({ field: 'taskType', message: 'Must be CYCLE_COUNT or BIN_MAINTENANCE.' });
  }
  if (size && !/^([1-9]\d?|100)$/.test(size)) {
    errors.push({ field: 'size', message: 'Must be between 1 and 100.' });
  }
  return errors;
}

/** Fixture timestamps carry the facility offset, so the first 10 characters are the facility date. */
function facilityDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function inRange(date: string, params: HttpParams): boolean {
  const from = params.get('from');
  const to = params.get('to');
  return (!from || date >= from) && (!to || date <= to);
}

/** Orders rows by a value already in the fixture (`field,asc` or `field,desc`). */
function sortBy<T extends object>(rows: T[], sort: string): T[] {
  const [field, direction] = sort.split(',') as [keyof T, string];
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
}

/** Pagination only: slices the list and describes the page. */
function paged<T>(rows: T[], params: HttpParams) {
  const size = Number(params.get('size') ?? 25);
  const number = Number(params.get('page') ?? 0);
  return {
    items: rows.slice(number * size, number * size + size),
    page: {
      number,
      size,
      totalElements: rows.length,
      totalPages: Math.ceil(rows.length / size),
    },
  };
}

function respond<T>(body: T): Observable<HttpResponse<T>> {
  return of(
    new HttpResponse({
      status: 200,
      body,
      headers: new HttpHeaders({ 'Content-Type': 'application/json', 'X-Gemba-Mock': MOCK_MARKER }),
    }),
  );
}

function serverError(req: HttpRequest<unknown>): Observable<never> {
  return problem(
    500,
    'Something went wrong',
    `The mock server failed on purpose for ${new URL(req.url, 'http://mock.local').pathname}.`,
  );
}

function problem(
  status: number,
  title: string,
  detail: string,
  errors?: FieldError[],
): Observable<never> {
  const body: Problem = { type: 'about:blank', title, status, detail, ...(errors && { errors }) };
  return throwError(
    () =>
      new HttpErrorResponse({
        status,
        statusText: title,
        error: body,
        headers: new HttpHeaders({ 'Content-Type': 'application/problem+json' }),
      }),
  );
}
