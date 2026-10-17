import { computed, inject, Service } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Params, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import type { FilterParams, Meta, TaskType, Zone } from './api/types';
import { TASK_TYPES, ZONES } from './api/types';
import { isDateOnly } from './format/format';
import { MetaService } from './meta.service';

/** The filter bar's values, after invalid URL values fell back to their defaults. */
export interface Filters {
  from: string;
  to: string;
  zone: Zone | null;
  taskType: TaskType | null;
}

export type FilterName = keyof Filters;

export interface ParsedFilters {
  filters: Filters;
  /** Query parameters that were present but invalid, so their default is used instead. */
  invalid: FilterName[];
}

export type ParamValue = string | number | boolean | null | undefined;

/** Query parameters cleared by "Clear filters": the filter bar plus each page's own filters. */
const CLEARABLE = ['from', 'to', 'zone', 'taskType', 'q', 'day', 'aboveP90', 'partnerId', 'page'];

/**
 * The URL is the state (rule 4). Every filter, the search text, the selected day, the page,
 * and the open task live in query parameters. This service reads them as signals and
 * writes them back by navigating, so reload, back, forward, and shared links all work.
 * Nothing is kept anywhere else.
 */
@Service()
export class FilterState {
  private readonly router = inject(Router);
  private readonly metaService = inject(MetaService);

  /** The current query parameters, updated after every navigation. */
  readonly params = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.currentParams()),
    ),
    { initialValue: this.currentParams() },
  );

  private readonly parsed = computed(() => parseFilters(this.params(), this.metaService.meta()));

  // `equal: sameValues` keeps the previous object when the values didn't change. Every
  // navigation creates new objects, and `httpResource` refetches when its request changes,
  // so without this, opening a task or any other page-level URL change would reload every
  // data region on the page.

  /** The filter bar's values. */
  readonly filters = computed(() => this.parsed().filters, { equal: sameValues });

  /** Invalid filter parameters in the URL, for the "using defaults" notice. */
  readonly invalid = computed(() => this.parsed().invalid, { equal: sameValues });

  /** The shared filters as API query parameters (`zone` and `taskType` omitted for "all"). */
  readonly apiParams = computed<FilterParams>(
    () => {
      const { from, to, zone, taskType } = this.filters();
      return { from, to, ...(zone && { zone }), ...(taskType && { taskType }) };
    },
    { equal: sameValues },
  );

  /** True when no filter, search, or page-level filter is set in the URL. */
  readonly isClear = computed(() => CLEARABLE.every((name) => this.params()[name] == null));

  // Page-level parameters. Each page uses the ones it needs.
  readonly q = computed(() => this.text('q') ?? '');
  readonly page = computed(() => this.nonNegativeInt('page') ?? 0);
  readonly task = computed(() => this.positiveInt('task'));
  readonly day = computed(() => {
    const day = this.text('day');
    return day && isDateOnly(day) ? day : null;
  });
  readonly aboveP90 = computed(() => this.params()['aboveP90'] === 'true');
  readonly partnerId = computed(() => this.text('partnerId'));

  /**
   * Query parameters to carry on links to other pages: the filter bar's values (only
   * those that differ from the defaults) and the mock-mode switch, if present.
   */
  readonly linkParams = computed<Params>(() => {
    const params = this.params();
    const kept: Params = {};
    for (const name of ['from', 'to', 'zone', 'taskType', 'mock']) {
      if (params[name] != null) kept[name] = params[name];
    }
    return kept;
  });

  /** Changes filter bar values. Defaults are removed from the URL, and paging restarts. */
  setFilters(patch: Partial<Filters>): void {
    const meta = this.metaService.meta();
    const params: Record<string, ParamValue> = { page: null };
    if ('from' in patch) params['from'] = patch.from === meta?.dataFrom ? null : patch.from;
    if ('to' in patch) params['to'] = patch.to === meta?.dataTo ? null : patch.to;
    if ('zone' in patch) params['zone'] = patch.zone;
    if ('taskType' in patch) params['taskType'] = patch.taskType;
    this.setParams(params);
  }

  /** Removes every filter, the search text, the selected day, and the page number. */
  clearFilters(): void {
    this.setParams(Object.fromEntries(CLEARABLE.map((name) => [name, null])));
  }

  /**
   * Merges `patch` into the current query parameters. `null`, `undefined`, `false`,
   * and `''` remove a parameter.
   */
  setParams(patch: Record<string, ParamValue>, options: { replaceUrl?: boolean } = {}): void {
    const queryParams: Params = {};
    for (const [name, value] of Object.entries(patch)) {
      queryParams[name] = value === false || value === '' || value == null ? null : String(value);
    }
    // An empty command list keeps the current path and only changes the query string.
    void this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: options.replaceUrl ?? false,
    });
  }

  private currentParams(): Params {
    return this.router.routerState.snapshot.root.queryParams;
  }

  private text(name: string): string | null {
    const value = this.params()[name];
    return typeof value === 'string' && value !== '' ? value : null;
  }

  private nonNegativeInt(name: string): number | null {
    const value = this.text(name);
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  }

  private positiveInt(name: string): number | null {
    const value = this.nonNegativeInt(name);
    return value !== null && value > 0 ? value : null;
  }
}

/** True when two flat objects or arrays hold the same keys and values. */
export function sameValues<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Reads the filter bar's values from query parameters. A missing value takes its default;
 * an invalid one takes its default and is reported in `invalid`. Dates must be
 * `YYYY-MM-DD` within the dataset's range, and `from` can't be after `to`.
 */
export function parseFilters(params: Params, meta: Meta | null): ParsedFilters {
  const dataFrom = meta?.dataFrom ?? '';
  const dataTo = meta?.dataTo ?? '';
  const invalid: FilterName[] = [];

  // Dates in YYYY-MM-DD form compare correctly as strings.
  const inRange = (value: string) =>
    isDateOnly(value) && (!meta || (value >= dataFrom && value <= dataTo));

  const readDate = (name: 'from' | 'to', fallback: string): string => {
    const value = params[name];
    if (value == null) return fallback;
    if (typeof value === 'string' && inRange(value)) return value;
    invalid.push(name);
    return fallback;
  };

  let from = readDate('from', dataFrom);
  let to = readDate('to', dataTo);
  if (from > to && to !== '') {
    invalid.push(...(['from', 'to'] as const).filter((name) => !invalid.includes(name)));
    from = dataFrom;
    to = dataTo;
  }

  const readEnum = <T extends string>(name: 'zone' | 'taskType', allowed: readonly T[]) => {
    const value = params[name];
    if (value == null) return null;
    if (allowed.includes(value)) return value as T;
    invalid.push(name);
    return null;
  };

  return {
    filters: {
      from,
      to,
      zone: readEnum('zone', ZONES),
      taskType: readEnum('taskType', TASK_TYPES),
    },
    invalid,
  };
}
