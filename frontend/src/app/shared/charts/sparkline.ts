import { Component, input } from '@angular/core';

/**
 * A small trend line (the overview grid's daily medians).
 * STUB (Phase 1): final inputs, placeholder rendering. Agent A builds the SVG.
 */
@Component({
  selector: 'g-sparkline',
  template: `<div class="stub" role="img" [attr.aria-label]="label()">
    g-sparkline: {{ points().length }} points
  </div>`,
})
export class Sparkline {
  /** The values in order, oldest first. */
  readonly points = input.required<readonly number[]>();
  /** Accessible name, for example "Daily median, Ambient cycle count". */
  readonly label = input.required<string>();
}
