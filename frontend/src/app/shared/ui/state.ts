import { Component, input, output } from '@angular/core';
import type { Problem } from '../../core/api/types';

export type StateStatus = 'loading' | 'empty' | 'error';

/**
 * The loading, empty, and error view for a data region.
 * - loading: a skeleton that fills the host. Give the host the content's size
 *   (for example `min-height`) so nothing jumps when data arrives.
 * - empty: shows the projected content, a sentence and an action, for example
 *   `<g-state status="empty"><p>No tasks match these filters.</p><button>Clear filters</button></g-state>`.
 * - error: the Problem Details `title` and `detail` with a "Try again" button that emits `retry`.
 *
 * Loading and empty sit in a polite live region; the error view is an alert.
 */
@Component({
  selector: 'g-state',
  template: `
    @switch (status()) {
      @case ('loading') {
        <div class="loading" role="status">
          <span class="visually-hidden">Loading…</span>
          <span class="skeleton fill" aria-hidden="true"></span>
        </div>
      }
      @case ('empty') {
        <div class="message" role="status">
          <ng-content />
        </div>
      }
      @case ('error') {
        <div class="message" role="alert">
          <p class="title">{{ problem()?.title ?? 'Something went wrong' }}</p>
          @if (problem()?.detail; as detail) {
            <p class="muted">{{ detail }}</p>
          }
          <button type="button" class="control" (click)="retry.emit()">Try again</button>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .loading {
      display: flex;
      height: 100%;
      min-height: inherit;
    }
    .fill {
      flex: 1;
      min-height: 48px;
    }
    .message {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
      padding: var(--space-4) 0;
    }
    .title {
      font-weight: var(--weight-medium);
    }
    button {
      margin-top: var(--space-1);
    }
  `,
})
export class State {
  readonly status = input.required<StateStatus>();
  readonly problem = input<Problem | null>(null);
  readonly retry = output<void>();
}
