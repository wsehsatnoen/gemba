import {
  Component,
  ElementRef,
  computed,
  input,
  linkedSignal,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import type { Comparison } from '../../core/api/types';
import { COMPARISON_LABELS } from '../../core/labels';
import type { LinePoint, ValueFormat } from './chart-types';
import { hostWidth } from './host-width';
import { extent, linePath, linearScale, niceTicks } from './scale';

/** Plot margins: left for the tick labels, right for the reference label. */
const MARGIN = { top: 30, right: 44, bottom: 28, left: 44 };
/** Inset of the first and last point from the plot edges, so their markers aren't clipped. */
const INSET = 12;
/** Roughly the width of a "Jan 19" label, used to thin the x labels on narrow screens. */
const X_LABEL_WIDTH = 48;

const COMPARISON_CLASS: Record<Comparison, string> = {
  FASTER: 'faster',
  SLOWER: 'slower',
  SIMILAR: 'neutral',
  INSUFFICIENT_SAMPLE: 'neutral',
};

/**
 * A line with selectable points and an optional dashed reference line (the daily pace chart).
 *
 * Points are colored by the backend's `comparison`. A null value leaves a gap in the line
 * and draws no point. Each point is a button: click, Enter, or Space emits `pointSelect`
 * with its `id`. Only one point is in the tab order at a time (the selected one, or the
 * first); the arrow keys, Home, and End move between points. The selected point gets a
 * ring and a label, so selection is never shown by color alone.
 */
@Component({
  selector: 'g-line-chart',
  template: `
    <svg
      role="group"
      [attr.aria-label]="label()"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      [attr.height]="height()"
      width="100%"
    >
      @for (tick of yTicks(); track tick.value) {
        @if (!tick.isReference) {
          <line
            class="grid"
            [attr.x1]="plot().left"
            [attr.x2]="plot().right"
            [attr.y1]="tick.y"
            [attr.y2]="tick.y"
          />
        }
        <text
          class="tick"
          [attr.x]="plot().left - 8"
          [attr.y]="tick.y"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ tick.label }}
        </text>
      }

      @if (referenceLine(); as ref) {
        <line
          class="reference"
          [attr.x1]="plot().left"
          [attr.x2]="plot().right"
          [attr.y1]="ref.y"
          [attr.y2]="ref.y"
        />
        <text
          class="reference-label"
          [attr.x]="plot().right + 6"
          [attr.y]="ref.y"
          dominant-baseline="middle"
        >
          {{ ref.label }}
        </text>
      }

      @for (tick of xTicks(); track tick.id) {
        <text class="tick" [attr.x]="tick.x" [attr.y]="height() - 8" text-anchor="middle">
          {{ tick.label }}
        </text>
      }

      <path class="line" [attr.d]="path()" />

      @for (point of drawn(); track point.id) {
        <g
          #pointEl
          class="point"
          [class]="point.colorClass"
          [class.selected]="point.id === selectedId()"
          role="button"
          [attr.tabindex]="point.id === activeId() ? 0 : -1"
          [attr.aria-label]="point.name"
          [attr.aria-pressed]="point.id === selectedId()"
          (click)="choose(point.id)"
          (keydown)="onKeydown($event, $index)"
          (focus)="activeId.set(point.id); hoveredId.set(point.id)"
          (blur)="hoveredId.set(null)"
          (mouseenter)="hoveredId.set(point.id)"
          (mouseleave)="hoveredId.set(null)"
        >
          <circle class="hit" [attr.cx]="point.x" [attr.cy]="point.y" r="14" />
          <circle class="focus-ring" [attr.cx]="point.x" [attr.cy]="point.y" r="11" />
          @if (point.id === selectedId()) {
            <circle class="selected-ring" [attr.cx]="point.x" [attr.cy]="point.y" r="8.5" />
          }
          <circle class="dot" [attr.cx]="point.x" [attr.cy]="point.y" r="5" />
        </g>
      }

      @for (note of annotations(); track note.id) {
        <text
          class="annotation"
          [class.selected]="note.selected"
          [attr.x]="note.x"
          [attr.y]="note.y - 16"
          [attr.text-anchor]="note.anchor"
        >
          {{ note.text }}
        </text>
      }
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
            <th scope="col">Comparison</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.id) {
            <tr>
              <th scope="row">{{ row.label }}</th>
              <td>{{ row.value }}</td>
              <td>{{ row.comparison }}</td>
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
    .grid {
      stroke: var(--chart-grid);
      stroke-width: 1;
      shape-rendering: crispEdges;
    }
    .tick {
      fill: var(--text-muted);
    }
    .reference {
      stroke: var(--chart-reference);
      stroke-width: 1.5;
      stroke-dasharray: 5 4;
    }
    .reference-label {
      fill: var(--text-muted);
    }
    .line {
      fill: none;
      stroke: var(--chart-line);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .point {
      cursor: pointer;
      outline: none;
    }
    .hit {
      fill: transparent;
    }
    .dot {
      stroke: var(--surface);
      stroke-width: 2;
    }
    .faster .dot {
      fill: var(--chart-faster);
    }
    .slower .dot {
      fill: var(--chart-slower);
    }
    .neutral .dot {
      fill: var(--chart-neutral);
    }
    .selected-ring {
      fill: none;
      stroke: var(--text);
      stroke-width: 2;
    }
    .focus-ring {
      fill: none;
      stroke: transparent;
      stroke-width: 2;
    }
    .point:focus-visible .focus-ring {
      stroke: var(--accent);
    }
    .point:hover .dot {
      stroke: var(--text);
      stroke-width: 1.5;
    }
    .annotation {
      fill: var(--text-muted);
      paint-order: stroke;
      stroke: var(--surface);
      stroke-width: 4;
      stroke-linejoin: round;
    }
    .annotation.selected {
      fill: var(--text);
      font-weight: var(--weight-medium);
    }
  `,
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
  /** Column headers for the hidden data table (the third column is "Comparison"). */
  readonly headers = input<readonly [string, string]>(['Label', 'Value']);
  /** Height in CSS pixels; the width follows the host. */
  readonly height = input(220);
  /** Emits a point's `id` when it's clicked or chosen with Enter or Space. */
  readonly pointSelect = output<string>();

  protected readonly width = hostWidth();
  protected readonly hoveredId = signal<string | null>(null);
  private readonly pointEls = viewChildren<ElementRef<SVGGElement>>('pointEl');

  protected readonly plot = computed(() => ({
    left: MARGIN.left,
    right: Math.max(this.width() - MARGIN.right, MARGIN.left + 1),
    top: MARGIN.top,
    bottom: this.height() - MARGIN.bottom,
  }));

  /** Tick values spanning the data and the reference line; their ends are the y domain. */
  private readonly tickValues = computed(() => {
    const values: (number | null)[] = this.points().map((p) => p.value);
    values.push(this.reference());
    const range = extent(values) ?? { min: 0, max: 1 };
    return niceTicks(range.min, range.max, 4);
  });

  private readonly y = computed(() => {
    const ticks = this.tickValues();
    const { top, bottom } = this.plot();
    return linearScale(ticks[0], ticks[ticks.length - 1], bottom, top);
  });

  private readonly x = computed(() => {
    const { left, right } = this.plot();
    return linearScale(0, Math.max(this.points().length - 1, 1), left + INSET, right - INSET);
  });

  protected readonly yTicks = computed(() => {
    const y = this.y();
    const format = this.format();
    return this.tickValues().map((value) => ({
      value,
      y: y(value),
      label: format(value),
      isReference: value === this.reference(),
    }));
  });

  protected readonly referenceLine = computed(() => {
    const reference = this.reference();
    return reference == null ? null : { y: this.y()(reference), label: this.format()(reference) };
  });

  /** Every point with a value, in SVG coordinates. */
  protected readonly drawn = computed(() => {
    const x = this.x();
    const y = this.y();
    const format = this.format();
    return this.points().flatMap((point, i) =>
      point.value == null
        ? []
        : [
            {
              id: point.id,
              label: point.label,
              x: x(i),
              y: y(point.value),
              text: `${point.label} · ${format(point.value)}`,
              name: `${point.label}, ${format(point.value)}, ${COMPARISON_LABELS[point.comparison]}`,
              colorClass: COMPARISON_CLASS[point.comparison],
            },
          ],
    );
  });

  protected readonly path = computed(() => {
    const x = this.x();
    const y = this.y();
    return linePath(
      this.points().map((p, i) => (p.value == null ? null : { x: x(i), y: y(p.value) })),
    );
  });

  /** X labels, thinned so they don't overlap on narrow screens. */
  protected readonly xTicks = computed(() => {
    const points = this.points();
    const { left, right } = this.plot();
    const every = Math.max(1, Math.ceil((points.length * X_LABEL_WIDTH) / (right - left)));
    const x = this.x();
    return points.flatMap((point, i) =>
      i % every === 0 ? [{ id: point.id, label: point.label, x: x(i) }] : [],
    );
  });

  /** Labels above the selected point and the hovered or focused one. */
  protected readonly annotations = computed(() => {
    const { left, right } = this.plot();
    const ids = new Set([this.selectedId(), this.hoveredId()]);
    return this.drawn()
      .filter((point) => ids.has(point.id))
      .map((point) => ({
        id: point.id,
        text: point.text,
        x: point.x,
        y: point.y,
        selected: point.id === this.selectedId(),
        anchor: point.x < left + 40 ? 'start' : point.x > right - 40 ? 'end' : 'middle',
      }));
  });

  protected readonly rows = computed(() => {
    const format = this.format();
    return this.points().map((point) => ({
      id: point.id,
      label: point.label,
      value: point.value == null ? '—' : format(point.value),
      comparison: COMPARISON_LABELS[point.comparison],
    }));
  });

  /** The point in the tab order: the selected one when drawn, otherwise the first. */
  protected readonly activeId = linkedSignal(() => {
    const drawn = this.drawn();
    const selected = this.selectedId();
    return drawn.some((p) => p.id === selected) ? selected : (drawn[0]?.id ?? null);
  });

  protected choose(id: string): void {
    this.activeId.set(id);
    this.pointSelect.emit(id);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const drawn = this.drawn();
    const last = drawn.length - 1;
    let next: number;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.choose(drawn[index].id);
        return;
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(index + 1, last);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(index - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.activeId.set(drawn[next].id);
    this.pointEls()[next]?.nativeElement.focus();
  }
}
