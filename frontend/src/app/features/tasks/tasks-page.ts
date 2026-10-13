import { Component, computed, inject } from '@angular/core';
import type { TaskQuery } from '../../core/api/types';
import { FilterState } from '../../core/filter-state';
import { Viewport } from '../../core/viewport';
import { PageHeader } from '../../shell/page-header';
import { TaskPanel } from './task-panel';
import { TaskTable } from './task-table';

/**
 * /tasks: the task table with the filter bar, an "Above P90 only" toggle, and an
 * optional partner filter. `?task=` opens the task panel: a column beside the list on
 * desktop, a full-screen view on mobile.
 */
@Component({
  selector: 'g-tasks-page',
  imports: [PageHeader, TaskTable, TaskPanel],
  templateUrl: './tasks-page.html',
  styleUrl: './tasks-page.css',
})
export class TasksPage {
  private readonly filterState = inject(FilterState);
  protected readonly isDesktop = inject(Viewport).isDesktop;

  protected readonly aboveP90 = this.filterState.aboveP90;
  protected readonly partnerId = this.filterState.partnerId;
  protected readonly task = this.filterState.task;

  protected readonly query = computed<TaskQuery>(() => ({
    ...this.filterState.apiParams(),
    partnerId: this.partnerId() ?? undefined,
    aboveP90: this.aboveP90() || undefined,
    page: this.filterState.page(),
    sort: 'startedAt,desc',
  }));

  /** On mobile the panel covers the screen, so the list behind it is made inert. */
  protected readonly listInert = computed(() => !this.isDesktop() && this.task() !== null);

  protected setAboveP90(on: boolean): void {
    this.filterState.setParams({ aboveP90: on, page: null });
  }

  protected setPartner(value: string): void {
    this.filterState.setParams({ partnerId: value.trim().toUpperCase(), page: null });
  }

  protected openTask(taskId: number): void {
    this.filterState.setParams({ task: taskId });
  }

  protected closeTask(): void {
    this.filterState.setParams({ task: null });
  }
}
