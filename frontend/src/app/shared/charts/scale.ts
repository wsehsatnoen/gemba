// Chart scales: turn API values into SVG coordinates. Rule 1 allows arithmetic on API
// values here and in core/format only, and only to place marks on screen. Nothing here
// produces a number that's shown to the user except the tick values, which are axis
// positions, not business figures.

/** The smallest and largest of the non-null values, or null when there are none. */
export interface Extent {
  min: number;
  max: number;
}

export function extent(values: readonly (number | null)[]): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value == null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? { min, max } : null;
}

/**
 * A linear scale from `[d0, d1]` to `[r0, r1]`. A zero-width domain maps every value to
 * the middle of the range, so a flat series draws a flat line instead of dividing by zero.
 */
export function linearScale(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (value: number) => number {
  if (d0 === d1) {
    const middle = (r0 + r1) / 2;
    return () => middle;
  }
  const ratio = (r1 - r0) / (d1 - d0);
  return (value) => r0 + (value - d0) * ratio;
}

/** The center of band `index` when `count` equal bands fill `[r0, r1]`. */
export function bandCenter(index: number, count: number, r0: number, r1: number): number {
  const band = (r1 - r0) / count;
  return r0 + band * (index + 0.5);
}

/**
 * Round tick values covering `[min, max]`, stepping by 1, 2, or 5 times a power of ten, with
 * about `target` intervals. The first tick is at or below `min`, the last at or above `max`.
 */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (min === max) {
    return [min];
  }
  const rough = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Round each tick to the step's precision so 0.1 + 0.2 style drift never shows.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let tick = first; tick <= last + step / 2; tick += step) {
    ticks.push(Number(tick.toFixed(decimals)));
  }
  return ticks;
}

/** A point in SVG coordinates, or null for a gap. */
export type XY = { x: number; y: number } | null;

/**
 * An SVG path `d` through the points, broken at each null so missing values leave a gap.
 * A lone point between gaps gets no segment (its marker still shows it).
 */
export function linePath(points: readonly XY[]): string {
  const parts: string[] = [];
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) {
      parts.push(run.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' '));
    }
    run = [];
  };
  for (const point of points) {
    if (point) {
      run.push(point);
    } else {
      flush();
    }
  }
  flush();
  return parts.join(' ');
}

/**
 * A bar from the baseline up to `top`, with 4 px rounded top corners and a square base.
 * The radius shrinks for bars shorter or narrower than two radii.
 */
export function barPath(x: number, width: number, top: number, baseline: number): string {
  const height = baseline - top;
  if (height <= 0 || width <= 0) {
    return '';
  }
  const r = Math.min(4, width / 2, height);
  const right = x + width;
  return [
    `M${round(x)} ${round(baseline)}`,
    `V${round(top + r)}`,
    `Q${round(x)} ${round(top)} ${round(x + r)} ${round(top)}`,
    `H${round(right - r)}`,
    `Q${round(right)} ${round(top)} ${round(right)} ${round(top + r)}`,
    `V${round(baseline)}`,
    'Z',
  ].join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
