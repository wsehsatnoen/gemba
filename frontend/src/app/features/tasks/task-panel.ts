import { Component, input, output } from '@angular/core';

/**
 * The task panel: how one task was paired from the moves on its bin.
 * A side panel on desktop and a full-screen view on mobile. Esc or × emits `closed`;
 * the page then removes `task` from the URL.
 * STUB (Phase 1): final input and output, placeholder rendering. Agent B builds it.
 */
@Component({
  selector: 'g-task-panel',
  template: `<div class="stub">
    g-task-panel: task {{ taskId() }}
    <button type="button" (click)="closed.emit()">Close</button>
  </div>`,
})
export class TaskPanel {
  readonly taskId = input.required<number>();
  readonly closed = output<void>();
}
