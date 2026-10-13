import { Component, input } from '@angular/core';
import type { Comparison } from '../../core/api/types';
import { formatPace } from '../../core/format/format';

/**
 * Pace as a pill colored by the backend's comparison: green FASTER, amber SLOWER,
 * gray SIMILAR, and a gray "Too few" for INSUFFICIENT_SAMPLE.
 * STUB (Phase 1): final inputs, placeholder rendering. Agent A builds the pill.
 */
@Component({
  selector: 'g-pace-pill',
  template: `<span class="stub">{{ comparison() }} {{ text() }}</span>`,
})
export class PacePill {
  readonly pacePct = input.required<number | null>();
  readonly comparison = input.required<Comparison>();

  protected text() {
    return this.comparison() === 'INSUFFICIENT_SAMPLE' ? 'Too few' : formatPace(this.pacePct());
  }
}
