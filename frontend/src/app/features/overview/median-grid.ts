import { Component, computed, inject } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { AnalyticsApi } from '../../core/api/analytics-api';
import type { TaskType, Zone, ZoneTaskTypeStat } from '../../core/api/types';
import { TASK_TYPES, ZONES } from '../../core/api/types';
import { FilterState } from '../../core/filter-state';
import { CountPipe, DurationPipe } from '../../core/format';
import { TASK_TYPE_LABELS, ZONE_LABELS } from '../../core/labels';
import { toProblem } from '../../core/problem';
import { Sparkline } from '../../shared/charts/sparkline';
import { State } from '../../shared/ui/state';
import { EmptyRange } from './empty-range';
import { regionStatus } from './region-status';

export interface GridCell {
  zone: Zone;
  taskType: TaskType;
  /** "Ambient cycle count" */
  label: string;
  /** The API's entry for this zone and task type, or null when the filters exclude it. */
  stat: ZoneTaskTypeStat | null;
  /** The daily medians for the sparkline, oldest first. */
  points: number[];
  /** Query parameters for the link to /tasks. */
  queryParams: Params;
}

export interface GridRow {
  taskType: TaskType;
  label: string;
  cells: GridCell[];
}

/**
 * The "Median task time" grid: zones across, task types down. Each cell is looked up in
 * the API's list by zone and task type, and links to the tasks behind it.
 */
@Component({
  selector: 'g-median-grid',
  imports: [RouterLink, Sparkline, State, EmptyRange, DurationPipe, CountPipe],
  templateUrl: './median-grid.html',
  styleUrl: './median-grid.css',
})
export class MedianGrid {
  private readonly filterState = inject(FilterState);
  protected readonly stats = inject(AnalyticsApi).zoneTaskType(() => this.filterState.apiParams());

  protected readonly zones = ZONES;
  protected readonly zoneLabels = ZONE_LABELS;
  protected readonly status = computed(() => regionStatus(this.stats));
  protected readonly problem = computed(() => toProblem(this.stats.error()));

  /** The grid rows, or null when the range has no tasks (the empty state). */
  protected readonly rows = computed<GridRow[] | null>(() => {
    const stats = this.stats.hasValue() ? this.stats.value() : [];
    if (stats.length === 0) return null;
    const linkParams = this.filterState.linkParams();
    return TASK_TYPES.map((taskType) => ({
      taskType,
      label: TASK_TYPE_LABELS[taskType],
      cells: ZONES.map((zone) => {
        const stat = stats.find((s) => s.zone === zone && s.taskType === taskType) ?? null;
        return {
          zone,
          taskType,
          label: `${ZONE_LABELS[zone]} ${TASK_TYPE_LABELS[taskType].toLowerCase()}`,
          stat,
          points: stat?.daily.map((day) => day.medianMs) ?? [],
          queryParams: { ...linkParams, zone, taskType },
        };
      }),
    }));
  });
}
