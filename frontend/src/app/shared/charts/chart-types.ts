import type { Comparison } from '../../core/api/types';

/** One bar in `g-bar-chart`. `value` is an API figure; `label` is shown under the bar. */
export interface BarDatum {
  label: string;
  value: number;
}

/**
 * One point in `g-line-chart`. `id` identifies the point in `pointSelect` (a date for the
 * daily pace chart); `value` null means no point is drawn; `comparison` picks its color.
 */
export interface LinePoint {
  id: string;
  label: string;
  value: number | null;
  comparison: Comparison;
}

/** Formats a value for labels and the hidden data table. Pass a function from core/format. */
export type ValueFormat = (value: number) => string;
