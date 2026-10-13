import { HttpErrorResponse } from '@angular/common/http';
import type { Problem } from './api/types';

/**
 * Turns any HTTP or resource error into RFC 9457 Problem Details for the error state.
 * The backend sends `application/problem+json`; anything else (a network failure,
 * a proxy's HTML error page) gets a generic problem with the same shape.
 */
export function toProblem(error: unknown): Problem {
  if (error instanceof HttpErrorResponse) {
    if (isProblem(error.error)) {
      return error.error;
    }
    if (error.status === 0) {
      return {
        type: 'about:blank',
        title: "Can't reach the server",
        status: 0,
        detail: 'Check your connection and try again.',
      };
    }
    return {
      type: 'about:blank',
      title: error.statusText || 'Something went wrong',
      status: error.status,
      detail: `The server answered with status ${error.status}.`,
    };
  }
  return {
    type: 'about:blank',
    title: 'Something went wrong',
    status: 0,
    detail: error instanceof Error ? error.message : undefined,
  };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 404;
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Problem).title === 'string' &&
    typeof (value as Problem).status === 'number'
  );
}
