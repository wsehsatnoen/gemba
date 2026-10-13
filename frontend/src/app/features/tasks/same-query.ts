import type { TaskQuery } from '../../core/api/types';

/**
 * True when two task queries ask for the same thing. Pages rebuild their query object on
 * every URL change (opening a task changes `task`, for example), and a new object would
 * make `httpResource` refetch the same page. Comparing values avoids that.
 */
export function sameQuery(a: TaskQuery, b: TaskQuery): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TaskQuery>;
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}
