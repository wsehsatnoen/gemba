import { Component, input } from '@angular/core';

/**
 * One summary figure: a label, a large value, and a muted line under it.
 * A flat card with a hairline border and a 12 px radius.
 */
@Component({
  selector: 'g-stat-card',
  template: `
    <p class="label">{{ label() }}</p>
    <p class="value num">{{ value() }}</p>
    @if (sub()) {
      <p class="sub muted">{{ sub() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      padding: var(--space-4);
      background: var(--surface);
      border: var(--hairline);
      border-radius: var(--radius-card);
    }
    .label {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .value {
      margin-top: var(--space-1);
      font-size: var(--text-2xl);
      font-weight: var(--weight-medium);
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .sub {
      margin-top: var(--space-1);
      font-size: var(--text-sm);
    }
    @media (max-width: 1023.98px) {
      .value {
        font-size: var(--text-xl);
      }
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  /** Already formatted, for example "31,292". */
  readonly value = input.required<string>();
  /** The line under the value, for example "from 80,000 rows". */
  readonly sub = input<string | null>(null);
}
