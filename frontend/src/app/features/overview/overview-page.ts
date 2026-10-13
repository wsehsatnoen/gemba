import { Component } from '@angular/core';
import { PageHeader } from '../../shell/page-header';

/**
 * /: summary cards, the median task time grid, and the weekday chart.
 * STUB (Phase 1). Agent C builds it.
 */
@Component({
  selector: 'g-overview-page',
  imports: [PageHeader],
  template: `<g-page-header heading="Overview">
      <p>
        Each task pairs a bin's start move with its end move. Select any number to see the tasks
        behind it.
      </p>
    </g-page-header>
    <div class="stub">Overview page (stub)</div>`,
})
export class OverviewPage {}
