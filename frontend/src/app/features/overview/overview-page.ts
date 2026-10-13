import { Component } from '@angular/core';
import { PageHeader } from '../../shell/page-header';
import { MedianGrid } from './median-grid';
import { OverviewSummary } from './overview-summary';
import { WeekdayChart } from './weekday-chart';

/**
 * /: summary cards across the top, then the median task time grid (about 60%) beside
 * the weekday chart. Everything stacks below 1024 px. Each region loads on its own.
 */
@Component({
  selector: 'g-overview-page',
  imports: [PageHeader, OverviewSummary, MedianGrid, WeekdayChart],
  template: `
    <g-page-header heading="Overview">
      <p>
        Each task pairs a bin's start move with its end move. Select any number to see the tasks
        behind it.
      </p>
    </g-page-header>
    <g-overview-summary />
    <div class="lower">
      <g-median-grid />
      <g-weekday-chart />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .lower {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
      margin-top: var(--space-4);
    }
    @media (min-width: 1024px) {
      .lower {
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      }
    }
  `,
})
export class OverviewPage {}
