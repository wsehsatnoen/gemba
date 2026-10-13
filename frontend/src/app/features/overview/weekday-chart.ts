import { Component, computed, inject } from '@angular/core';
import { AnalyticsApi } from '../../core/api/analytics-api';
import { FilterState } from '../../core/filter-state';
import { formatCount, formatHours } from '../../core/format';
import { WEEKDAY_SHORT_LABELS } from '../../core/labels';
import { toProblem } from '../../core/problem';
import { BarChart } from '../../shared/charts/bar-chart';
import type { BarDatum } from '../../shared/charts/chart-types';
import { State } from '../../shared/ui/state';
import { EmptyRange } from './empty-range';
import { regionStatus } from './region-status';
import { stableApiParams } from './stable-filters';

export type WeekdayMetric = 'tasks' | 'hours';

/**
 * "By day of week": average tasks or task hours per operating day, from
 * GET /api/analytics/weekday. The Tasks / Hours choice lives in the URL as `weekday=hours`.
 */
@Component({
  selector: 'g-weekday-chart',
  imports: [BarChart, State, EmptyRange],
  template: `
    <section class="card" aria-labelledby="weekday-heading">
      <div class="head">
        <h2 id="weekday-heading">By day of week</h2>
        <div class="segmented" role="group" aria-label="Show">
          <button
            type="button"
            [attr.aria-pressed]="metric() === 'tasks'"
            (click)="setMetric('tasks')"
          >
            Tasks
          </button>
          <button
            type="button"
            [attr.aria-pressed]="metric() === 'hours'"
            (click)="setMetric('hours')"
          >
            Hours
          </button>
        </div>
      </div>

      @switch (status()) {
        @case ('loading') {
          <div class="skeleton-chart" aria-busy="true">
            <span class="visually-hidden">Loading the weekday chart</span>
            <span class="skeleton" aria-hidden="true"></span>
          </div>
        }
        @case ('error') {
          <g-state status="error" [problem]="problem()" (retry)="weekday.reload()" />
        }
        @default {
          @if (bars(); as bars) {
            <g-bar-chart [bars]="bars" [format]="format()" [label]="chartLabel()" />
            <p class="caption muted">Average per operating day</p>
          } @else {
            <g-empty-range />
          }
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    section {
      height: 100%;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-3);
    }
    .segmented {
      display: inline-flex;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-control);
      overflow: hidden;
    }
    .segmented button {
      min-height: 32px;
      min-width: 64px;
      padding: var(--space-1) var(--space-3);
      background: var(--surface);
      border: 0;
      font-size: var(--text-sm);
    }
    .segmented button + button {
      border-left: 1px solid var(--border-strong);
    }
    .segmented button[aria-pressed='true'] {
      background: var(--accent-soft);
      color: var(--accent-on-soft);
      font-weight: var(--weight-medium);
    }
    .segmented button:focus-visible {
      outline-offset: -2px;
    }
    .caption {
      margin-top: var(--space-2);
      font-size: var(--text-sm);
    }
    .skeleton-chart .skeleton {
      height: 220px;
    }
  `,
})
export class WeekdayChart {
  private readonly filterState = inject(FilterState);
  protected readonly weekday = inject(AnalyticsApi).weekday(stableApiParams(this.filterState));

  protected readonly status = computed(() => regionStatus(this.weekday));
  protected readonly problem = computed(() => toProblem(this.weekday.error()));

  /** Tasks unless the URL says `weekday=hours`. */
  protected readonly metric = computed<WeekdayMetric>(() =>
    this.filterState.params()['weekday'] === 'hours' ? 'hours' : 'tasks',
  );

  protected readonly format = computed(() =>
    this.metric() === 'hours' ? formatHours : formatCount,
  );

  protected readonly chartLabel = computed(() =>
    this.metric() === 'hours'
      ? 'Average task hours per operating day by day of week'
      : 'Average tasks per operating day by day of week',
  );

  /** One bar per weekday the API returned, or null when the range has no tasks. */
  protected readonly bars = computed<BarDatum[] | null>(() => {
    const stats = this.weekday.hasValue() ? this.weekday.value() : [];
    if (stats.length === 0) return null;
    const hours = this.metric() === 'hours';
    return stats.map((stat) => ({
      label: WEEKDAY_SHORT_LABELS[stat.weekday],
      value: hours ? stat.avgTaskHours : stat.avgTasks,
    }));
  });

  protected setMetric(metric: WeekdayMetric): void {
    this.filterState.setParams(
      { weekday: metric === 'hours' ? 'hours' : null },
      { replaceUrl: true },
    );
  }
}
