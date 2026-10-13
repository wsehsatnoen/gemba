import type { HttpResourceRequest } from '@angular/common/http';

type QueryValue = string | number | boolean | null | undefined;

/**
 * Builds an `httpResource` request for a relative `/api/...` URL, dropping empty query
 * values. Returns `undefined` when `query` is `undefined`, which tells `httpResource`
 * not to fetch yet.
 */
export function apiRequest(
  url: string,
  query: Record<string, QueryValue> | undefined,
): HttpResourceRequest | undefined {
  if (query === undefined) return undefined;
  const params: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') params[name] = value;
  }
  return { url, params };
}
