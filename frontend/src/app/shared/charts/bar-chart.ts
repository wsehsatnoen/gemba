import { Component, computed, input } from '@angular/core';
import type { BarDatum, ValueFormat } from './chart-types';
import { hostWidth } from './host-width';
import { bandCenter, barPath, extent, linearScale } from './scale';

/** Room above the tallest bar for its value, and below the baseline for the bar labels. */
const TOP = 22;
const BOTTOM = 26;
const MAX_BAR_WIDTH = 56;

/**
 * Vertical bars with the value on each bar (the overview's weekday chart). Bars start at
 * zero, fill the host's width, and use the accent color. The SVG is an image with the
 * label as its name; a visually hidden table lists the formatted values.
 */
@Component({
  selector: 'g-bar-chart',
  template: `
    <svg
      role="img"
      [attr.aria-label]="label()"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      [attr.height]="height()"
      width="100%"
    >
      @for (bar of layout(); track bar.label) {
        <path class="bar" [attr.d]="bar.path" />
        <text class="value" [attr.x]="bar.cx" [attr.y]="bar.top - 6" text-anchor="middle">
          {{ bar.value }}
        </text>
        <text class="category" [attr.x]="bar.cx" [attr.y]="baseline() + 18" text-anchor="middle">
          {{ bar.label }}
        </text>
      }
      <line
        class="baseline"
        x1="0"
        [attr.x2]="width()"
        [attr.y1]="baseline()"
        [attr.y2]="baseline()"
      />
    </svg>
    <!-- A table ignores width: 1px, so the wrapper clips it and keeps it out of the page width. -->
    <div class="visually-hidden">
      <table>
        <caption>
          {{
            label()
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ headers()[0] }}</th>
            <th scope="col">{{ headers()[1] }}</th>
          </tr>
        </thead>
        <tbody>
          @for (bar of layout(); track bar.label) {
            <tr>
              <th scope="row">{{ bar.label }}</th>
              <td>{{ bar.value }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    svg {
      display: block;
      overflow: visible;
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }
    .bar {
      fill: var(--chart-bar);
    }
    .value {
      fill: var(--text);
      font-weight: var(--weight-medium);
    }
    .category {
      fill: var(--text-muted);
    }
    .baseline {
      stroke: var(--border-strong);
      stroke-width: 1;
      shape-rendering: crispEdges;
    }
    @media (prefers-reduced-motion: no-preference) {
      .bar {
        transition: d 200ms ease-out;
      }
    }
  `,
})
export class BarChart {
  readonly bars = input.required<readonly BarDatum[]>();
  /** Formats bar values and the hidden table, for example `formatCount`. */
  readonly format = input<ValueFormat>(String);
  /** Accessible name, for example "Average tasks per operating day by day of week". */
  readonly label = input.required<string>();
  /** Column headers for the hidden data table. */
  readonly headers = input<readonly [string, string]>(['Label', 'Value']);
  /** Height in CSS pixels; the width follows the host. */
  readonly height = input(220);

  protected readonly width = hostWidth();
  protected readonly baseline = computed(() => this.height() - BOTTOM);

  protected readonly layout = computed(() => {
    const bars = this.bars();
    const width = this.width();
    const baseline = this.baseline();
    const max = Math.max(extent(bars.map((b) => b.value))?.max ?? 0, 0);
    // Bars always start at zero; an all-zero chart keeps every bar flat on the baseline.
    const y = max > 0 ? linearScale(0, max, baseline, TOP) : () => baseline;
    const barWidth = Math.min(MAX_BAR_WIDTH, (width / Math.max(bars.length, 1)) * 0.62);
    const format = this.format();
    return bars.map((bar, i) => {
      const cx = bandCenter(i, bars.length, 0, width);
      const top = y(bar.value);
      return {
        label: bar.label,
        value: format(bar.value),
        cx,
        top,
        path: barPath(cx - barWidth / 2, barWidth, top, baseline),
      };
    });
  });
}
