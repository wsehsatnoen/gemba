import { Component } from '@angular/core';
import { PageHeader } from '../../shell/page-header';

/**
 * /tasks: the task table with the filter bar, an "Above P90 only" toggle, and an
 * optional partner filter.
 * STUB (Phase 1). Agent B builds it.
 */
@Component({
  selector: 'g-tasks-page',
  imports: [PageHeader],
  template: `<g-page-header heading="Tasks" />
    <div class="stub">Tasks page (stub)</div>`,
})
export class TasksPage {}
