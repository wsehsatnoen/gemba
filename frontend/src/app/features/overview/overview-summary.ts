import { Component, computed, inject } from '@angular/core';
import { AnalyticsApi } from '../../core/api/analytics-api';
import { FilterState } from '../../core/filter-state';
import { formatCount, formatHours } from '../../core/format';
import { toProblem } from '../../core/problem';
import { StatCard } from '../../shared/ui/stat-card';
import { State } from '../../shared/ui/state';
import { EmptyRange } from './empty-range';
import { regionStatus } from './region-status';

interface CardView {
  label: string;
  value: string;
  sub: string;
}

/** The four summary cards. Every figure is a field from GET /api/analytics/summary. */
@Component({
  selector: 'g-overview-summary',
  imports: [StatCard, State, EmptyRange],
  template: `
    <h2 class="visually-hidden">Summary</h2>
    @switch (status()) {
      @case ('loading') {
        <div class="cards" aria-busy="true">
          <span class="visually-hidden">Loading the summary</span>
          @for (i of placeholders; track i) {
            <div class="card skeleton-card" aria-hidden="true">
              <span class="skeleton line-label"></span>
              <span class="skeleton line-value"></span>
              <span class="skeleton line-sub"></span>
            </div>
          }
        </div>
      }
      @case ('error') {
        <div class="card">
          <g-state status="error" [problem]="problem()" (retry)="summary.reload()" />
        </div>
      }
      @default {
        @if (view(); as view) {
          <div class="cards">
            @for (card of view.cards; track card.label) {
              <g-stat-card [label]="card.label" [value]="card.value" [sub]="card.sub" />
            }
          </div>
          @if (view.unattributedNote) {
            <p class="note muted">{{ view.unattributedNote }}</p>
          }
        } @else {
          <div class="card"><g-empty-range /></div>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }
    @media (min-width: 720px) {
      .cards {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--space-4);
      }
    }
    .skeleton-card {
      display: grid;
      gap: var(--space-2);
      min-height: 112px;
    }
    .line-label {
      width: 70%;
      height: 14px;
    }
    .line-value {
      width: 50%;
      height: 32px;
    }
    .line-sub {
      width: 60%;
      height: 14px;
    }
    .note {
      margin-top: var(--space-2);
      font-size: var(--text-sm);
    }
  `,
})
export class OverviewSummary {
  private readonly filterState = inject(FilterState);
  protected readonly summary = inject(AnalyticsApi).summary(this.filterState.apiParams);

  protected readonly placeholders = [0, 1, 2, 3];
  protected readonly status = computed(() => regionStatus(this.summary));
  protected readonly problem = computed(() => toProblem(this.summary.error()));

  /** The cards, or null when the range has no tasks (the empty state). */
  protected readonly view = computed(() => {
    const s = this.summary.hasValue() ? this.summary.value() : undefined;
    if (!s || s.tasksPaired === 0) return null;
    const cards: CardView[] = [
      {
        label: 'Tasks paired',
        value: formatCount(s.tasksPaired),
        sub: `from ${formatCount(s.rowsImported)} rows`,
      },
      {
        label: 'Tasks per day',
        value: formatCount(s.tasksPerDay),
        sub: `${formatCount(s.operatingDays)} operating days`,
      },
      { label: 'Task hours per day', value: formatHours(s.taskHoursPerDay), sub: 'time on task' },
      {
        label: 'Duplicate starts discarded',
        value: formatCount(s.duplicateStartsDiscarded),
        sub: 'later start kept',
      },
    ];
    const unattributedNote =
      s.unattributedTasks > 0
        ? `${formatCount(s.unattributedTasks)} tasks have no partner ID.`
        : null;
    return { cards, unattributedNote };
  });
}
