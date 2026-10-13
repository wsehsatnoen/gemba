import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { TasksApi } from '../../core/api/tasks-api';
import type { PageMeta, TaskQuery } from '../../core/api/types';
import { FilterState } from '../../core/filter-state';
import { CountPipe, DurationPipe, FacilityDatePipe, FacilityTimePipe } from '../../core/format';
import { TASK_TYPE_LABELS, ZONE_LABELS } from '../../core/labels';
import { toProblem } from '../../core/problem';
import { Viewport } from '../../core/viewport';
import { State } from '../../shared/ui/state';

/** Skeleton rows shown while a page loads. Each is the height of a real row. */
const SKELETON_ROWS = Array.from({ length: 10 }, (_, i) => i);

/**
 * The shared task table: Start, Zone, Task type, Duration, and an "Above P90" pill.
 * It fetches its own page of tasks for `query`, writes `page` to the URL when paging,
 * highlights `selectedTaskId`, and emits `taskSelect` when a row is chosen.
 * A table on desktop and stacked rows under 1024 px.
 */
@Component({
  selector: 'g-task-table',
  imports: [State, CountPipe, DurationPipe, FacilityDatePipe, FacilityTimePipe],
  templateUrl: './task-table.html',
  styleUrl: './task-table.css',
})
export class TaskTable {
  /** The full API query, including the shared filters and `page`. */
  readonly query = input.required<TaskQuery>();
  readonly selectedTaskId = input<number | null>(null);
  readonly taskSelect = output<number>();

  private readonly filterState = inject(FilterState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly isDesktop = inject(Viewport).isDesktop;

  protected readonly tasks = inject(TasksApi).list(() => this.query());

  protected readonly rows = computed(() => (this.tasks.hasValue() ? this.tasks.value().items : []));
  protected readonly problem = computed(() => toProblem(this.tasks.error()));

  /** The last page description received, kept while the next page loads so the pager stays put. */
  protected readonly pageMeta = linkedSignal<PageMeta | undefined, PageMeta | undefined>({
    source: () => (this.tasks.hasValue() ? this.tasks.value().page : undefined),
    computation: (next, previous) => next ?? previous?.value,
  });

  protected readonly currentPage = computed(() => this.query().page ?? 0);

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly zoneLabels = ZONE_LABELS;
  protected readonly taskTypeLabels = TASK_TYPE_LABELS;

  private previousSelection: number | null = null;
  /** A row that should take focus once it is on screen (the page may still be loading). */
  private pendingFocus: number | null = null;

  constructor() {
    // When the panel closes (an ID becomes null), return focus to that task's row.
    afterRenderEffect(() => {
      const selected = this.selectedTaskId();
      this.rows();
      if (this.previousSelection !== null && selected === null) {
        this.pendingFocus = this.previousSelection;
      }
      this.previousSelection = selected;
      if (selected !== null) this.pendingFocus = null;
      if (this.pendingFocus === null) return;
      const row = this.host.nativeElement.querySelector<HTMLElement>(
        `[data-task-id="${this.pendingFocus}"]`,
      );
      if (row) {
        row.focus();
        this.pendingFocus = null;
      } else if (this.tasks.hasValue()) {
        // The row isn't on this page, so there is nothing to return to.
        this.pendingFocus = null;
      }
    });
  }

  protected select(taskId: number): void {
    this.taskSelect.emit(taskId);
  }

  protected goToPage(page: number): void {
    // Page 0 is the default, so it's left out of the URL.
    this.filterState.setParams({ page: page === 0 ? null : page });
  }

  protected clearFilters(): void {
    this.filterState.clearFilters();
  }

  protected retry(): void {
    this.tasks.reload();
  }
}
