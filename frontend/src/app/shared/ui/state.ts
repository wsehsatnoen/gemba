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
 * STUB (Phase 1): final inputs and output, placeholder rendering. Agent A builds the views.
 */
@Component({
  selector: 'g-state',
  template: `<div class="stub">
    g-state: {{ status() }}
    @if (status() === 'empty') {
      <ng-content />
    }
    @if (status() === 'error') {
      {{ problem()?.title }} {{ problem()?.detail }}
      <button type="button" (click)="retry.emit()">Try again</button>
    }
  </div>`,
})
export class State {
  readonly status = input.required<StateStatus>();
  readonly problem = input<Problem | null>(null);
  readonly retry = output<void>();
}
