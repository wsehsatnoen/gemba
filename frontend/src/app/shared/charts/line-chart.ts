import { Component, input, output } from '@angular/core';
import type { LinePoint, ValueFormat } from './chart-types';

/**
 * A line with selectable points and an optional dashed reference line (daily pace).
 * STUB (Phase 1): final inputs and output, placeholder rendering. Agent A builds the SVG.
 */
@Component({
  selector: 'g-line-chart',
  template: `<div class="stub" role="group" [attr.aria-label]="label()">
    g-line-chart: {{ points().length }} points, reference {{ reference() }}
    @for (point of points(); track point.id) {
      <button type="button" (click)="pointSelect.emit(point.id)">{{ point.label }}</button>
    }
  </div>`,
})
export class LineChart {
  readonly points = input.required<readonly LinePoint[]>();
  /** Y value of the dashed reference line, or null for none. Pace charts pass FACILITY_PACE_PCT. */
  readonly reference = input<number | null>(null);
  /** The `id` of the highlighted point. */
  readonly selectedId = input<string | null>(null);
  /** Formats values for point labels and the hidden table, for example `formatPace`. */
  readonly format = input<ValueFormat>(String);
  /** Accessible name, for example "Daily pace for SIMUSR0142". */
  readonly label = input.required<string>();
  /** Emits a point's `id` when it's clicked or chosen with Enter. */
  readonly pointSelect = output<string>();
}
