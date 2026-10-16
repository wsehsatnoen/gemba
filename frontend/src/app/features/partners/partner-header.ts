import { Component, computed, input } from '@angular/core';
import type { Comparison, PartnerSummary } from '../../core/api/types';
import { CountPipe, DurationPipe, PacePipe } from '../../core/format';

/** Token classes for the large pace figure. Never red for anything about a person. */
export const PACE_TONE: Record<Comparison, 'faster' | 'slower' | 'neutral'> = {
  FASTER: 'faster',
  SLOWER: 'slower',
  SIMILAR: 'neutral',
  INSUFFICIENT_SAMPLE: 'neutral',
};

/**
 * The partner detail header: the partner ID, the task count, days worked, and the median
 * gap against the facility's, with the overall pace on the right. Without `summary`
 * (still loading) the figures are skeletons, so nothing jumps.
 */
@Component({
  selector: 'g-partner-header',
  imports: [CountPipe, DurationPipe, PacePipe],
  template: `
    <div class="identity">
      <h1>{{ partnerId() }}</h1>
      @if (summary(); as s) {
        <p class="muted num stats">
          <span>{{ s.taskCount | count }} tasks</span>
          <span aria-hidden="true"> · </span>
          <span>{{ s.daysWorked | count }} days worked</span>
          <span aria-hidden="true"> · </span>
          <span
            >median gap between tasks {{ s.medianGapMs | duration }} (facility
            {{ s.facilityMedianGapMs | duration }})</span
          >
        </p>
      } @else {
        <span class="skeleton stats-skeleton"></span>
      }
    </div>
    <div class="pace">
      @if (summary(); as s) {
        <span class="pace-value num" [class]="'tone-' + tone()">
          {{ s.comparison === 'INSUFFICIENT_SAMPLE' ? 'Too few' : (s.pacePct | pace) }}
        </span>
        <span class="muted pace-label">pace vs facility</span>
      } @else {
        <span class="skeleton pace-skeleton"></span>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3) var(--space-5);
    }
    .identity {
      min-width: 0;
    }
    .stats {
      margin-top: var(--space-1);
    }
    .stats-skeleton {
      width: min(28rem, 80vw);
      height: 1.5em;
      margin-top: var(--space-1);
    }
    .pace {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      text-align: right;
    }
    .pace-value {
      font-size: var(--text-2xl);
      font-weight: var(--weight-medium);
      line-height: 1.1;
    }
    .tone-faster {
      color: var(--faster);
    }
    .tone-slower {
      color: var(--slower);
    }
    .tone-neutral {
      color: var(--neutral);
    }
    .pace-label {
      font-size: var(--text-sm);
    }
    .pace-skeleton {
      width: 6rem;
      height: 3.75rem;
    }
    @media (max-width: 1023.98px) {
      .pace {
        align-items: flex-start;
        text-align: left;
      }
    }
  `,
})
export class PartnerHeader {
  readonly partnerId = input.required<string>();
  readonly summary = input<PartnerSummary | undefined>(undefined);

  protected readonly tone = computed(() => {
    const summary = this.summary();
    return summary ? PACE_TONE[summary.comparison] : 'neutral';
  });
}
