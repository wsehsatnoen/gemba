import { Component, computed, input } from '@angular/core';
import type { ValueFormat } from './chart-types';
import { hostWidth } from './host-width';
import { extent, linePath, linearScale } from './scale';

const HEIGHT = 32;
/** Room for the stroke and the end dot at the top and bottom edges. */
const PAD = 4;

/**
 * A small trend line (the overview grid's daily medians). It fills the host's width and is
 * 32 px tall. The SVG is an image with the label as its name; a visually hidden table
 * lists the values for screen readers.
 */
@Component({
  selector: 'g-sparkline',
  template: `
    <svg
      role="img"
      [attr.aria-label]="label()"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height"
      [attr.height]="height"
      width="100%"
    >
      <path class="line" [attr.d]="path()" />
      @if (last(); as end) {
        <circle class="end" [attr.cx]="end.x" [attr.cy]="end.y" r="2.5" />
      }
    </svg>
    <table class="visually-hidden">
      <caption>
        {{
          label()
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Point</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track $index) {
          <tr>
            <th scope="row">{{ row.label }}</th>
            <td>{{ row.value }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      min-width: 48px;
    }
    svg {
      display: block;
      overflow: visible;
    }
    .line {
      fill: none;
      stroke: var(--chart-bar);
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .end {
      fill: var(--chart-bar);
    }
  `,
})
export class Sparkline {
  /** The values in order, oldest first. */
  readonly points = input.required<readonly number[]>();
  /** Accessible name, for example "Daily median, Ambient cycle count". */
  readonly label = input.required<string>();
  /** Formats values in the hidden table, for example `formatDuration`. */
  readonly format = input<ValueFormat>(String);
  /** Row labels for the hidden table, for example the dates. Defaults to 1, 2, 3, … */
  readonly pointLabels = input<readonly string[] | null>(null);

  protected readonly height = HEIGHT;
  protected readonly width = hostWidth();

  private readonly coords = computed(() => {
    const values = this.points();
    const range = extent(values);
    if (!range) return [];
    const x = linearScale(0, Math.max(values.length - 1, 1), PAD, this.width() - PAD);
    const y = linearScale(range.min, range.max, HEIGHT - PAD, PAD);
    return values.map((value, i) => ({ x: x(i), y: y(value) }));
  });

  protected readonly path = computed(() => linePath(this.coords()));
  protected readonly last = computed(() => this.coords().at(-1) ?? null);

  protected readonly rows = computed(() => {
    const labels = this.pointLabels();
    const format = this.format();
    return this.points().map((value, i) => ({
      label: labels?.[i] ?? String(i + 1),
      value: format(value),
    }));
  });
}
