import { Component, computed, input } from '@angular/core';
import type { Comparison } from '../../core/api/types';
import { formatPace } from '../../core/format/format';
import { COMPARISON_LABELS } from '../../core/labels';

/**
 * Pace as a pill colored by the backend's comparison: green FASTER, amber SLOWER,
 * gray SIMILAR, and a gray "Too few" for INSUFFICIENT_SAMPLE. The pill always shows text,
 * and screen readers also hear the comparison ("106%, faster"), so color is never the
 * only signal. Never red: this is about a person.
 */
@Component({
  selector: 'g-pace-pill',
  template: `
    {{ text() }}
    @if (spoken(); as extra) {
      <span class="visually-hidden">, {{ extra }}</span>
    }
  `,
  host: {
    '[class.faster]': "tone() === 'faster'",
    '[class.slower]': "tone() === 'slower'",
    '[class.neutral]': "tone() === 'neutral'",
  },
  styles: `
    :host {
      position: relative;
      display: inline-block;
      padding: 1px var(--space-2);
      border-radius: var(--radius-pill);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
      font-variant-numeric: tabular-nums;
      line-height: 1.5;
      white-space: nowrap;
    }
    :host(.faster) {
      background: var(--faster-soft);
      color: var(--faster);
    }
    :host(.slower) {
      background: var(--slower-soft);
      color: var(--slower);
    }
    :host(.neutral) {
      background: var(--neutral-soft);
      color: var(--neutral);
    }
  `,
})
export class PacePill {
  readonly pacePct = input.required<number | null>();
  readonly comparison = input.required<Comparison>();

  protected readonly text = computed(() =>
    this.comparison() === 'INSUFFICIENT_SAMPLE'
      ? COMPARISON_LABELS.INSUFFICIENT_SAMPLE
      : formatPace(this.pacePct()),
  );

  /** The comparison in words for screen readers; "Too few" already says it. */
  protected readonly spoken = computed(() =>
    this.comparison() === 'INSUFFICIENT_SAMPLE'
      ? null
      : COMPARISON_LABELS[this.comparison()].toLowerCase(),
  );

  protected readonly tone = computed(() => {
    switch (this.comparison()) {
      case 'FASTER':
        return 'faster';
      case 'SLOWER':
        return 'slower';
      default:
        return 'neutral';
    }
  });
}
