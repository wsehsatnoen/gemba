import { Component, input } from '@angular/core';
import type { BarDatum, ValueFormat } from './chart-types';

/**
 * Vertical bars with the value on each bar (the overview's weekday chart).
 * STUB (Phase 1): final inputs, placeholder rendering. Agent A builds the SVG.
 */
@Component({
  selector: 'g-bar-chart',
  template: `<div class="stub" role="img" [attr.aria-label]="label()">
    g-bar-chart:
    @for (bar of bars(); track bar.label) {
      {{ bar.label }} {{ format()(bar.value) }}
    }
  </div>`,
})
export class BarChart {
  readonly bars = input.required<readonly BarDatum[]>();
  /** Formats bar values and the hidden table, for example `formatCount`. */
  readonly format = input<ValueFormat>(String);
  /** Accessible name, for example "Average tasks per operating day by day of week". */
  readonly label = input.required<string>();
}
