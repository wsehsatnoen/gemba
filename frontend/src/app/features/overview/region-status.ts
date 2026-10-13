import type { Resource } from '@angular/core';

export type RegionStatus = 'loading' | 'error' | 'ready';

/**
 * Which view a data region shows for its resource. Checked in this order because a
 * resource in the error state throws when its `value()` is read.
 */
export function regionStatus(resource: Resource<unknown>): RegionStatus {
  if (resource.isLoading()) return 'loading';
  if (resource.error()) return 'error';
  return 'ready';
}
