import { computed, type Signal } from '@angular/core';
import type { FilterParams } from '../../core/api/types';
import type { FilterState } from '../../core/filter-state';

/**
 * `FilterState.apiParams()` returns a new object after every navigation, and
 * `httpResource` refetches whenever its request object changes. This keeps the same
 * object until a filter value actually changes, so the weekday toggle (which only
 * changes `weekday` in the URL) doesn't reload every region.
 */
export function stableApiParams(filterState: FilterState): Signal<FilterParams> {
  return computed(() => filterState.apiParams(), { equal: sameParams });
}

export function sameParams(a: FilterParams, b: FilterParams): boolean {
  const keys = Object.keys(a) as (keyof FilterParams)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
