import { Component, input, output } from '@angular/core';
import type { TaskQuery } from '../../core/api/types';

/**
 * The shared task table: Start, Zone, Task type, Duration, and an "Above P90" pill.
 * It fetches its own page of tasks for `query`, writes `page` to the URL when paging,
 * highlights `selectedTaskId`, and emits `taskSelect` when a row is chosen.
 * STUB (Phase 1): final inputs and output, placeholder rendering. Agent B builds it.
 */
@Component({
  selector: 'g-task-table',
  template: `<div class="stub">
    g-task-table: {{ query().partnerId ?? 'all partners' }}, {{ query().date ?? 'all days' }}, page
    {{ query().page ?? 0 }}, selected {{ selectedTaskId() ?? 'none' }}
    <button type="button" (click)="taskSelect.emit(48213)">Open task 48213</button>
  </div>`,
})
export class TaskTable {
  /** The full API query, including the shared filters and `page`. */
  readonly query = input.required<TaskQuery>();
  readonly selectedTaskId = input<number | null>(null);
  readonly taskSelect = output<number>();
}
