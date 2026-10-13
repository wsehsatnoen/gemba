import { Component, input } from '@angular/core';

/**
 * One summary figure with a label and a line under it.
 * STUB (Phase 1): final inputs, placeholder rendering. Agent A builds the card.
 */
@Component({
  selector: 'g-stat-card',
  template: `<div class="stub">{{ label() }}: {{ value() }} ({{ sub() }})</div>`,
})
export class StatCard {
  readonly label = input.required<string>();
  /** Already formatted, for example "31,292". */
  readonly value = input.required<string>();
  /** The line under the value, for example "from 80,000 rows". */
  readonly sub = input<string | null>(null);
}
