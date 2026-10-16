import { Component, computed, input } from '@angular/core';
import type { ComparisonCell, TaskType, Zone } from '../../core/api/types';
import { CountPipe, DurationPipe } from '../../core/format';
import { TASK_TYPE_LABELS, ZONE_LABELS } from '../../core/labels';
import { PacePill } from '../../shared/ui/pace-pill';

/** The tiles' fixed order, from the design. */
const TILE_ORDER: readonly { zone: Zone; taskType: TaskType }[] = [
  { zone: 'AMBIENT', taskType: 'CYCLE_COUNT' },
  { zone: 'CHILLED', taskType: 'CYCLE_COUNT' },
  { zone: 'AMBIENT', taskType: 'BIN_MAINTENANCE' },
  { zone: 'CHILLED', taskType: 'BIN_MAINTENANCE' },
];

interface Tile {
  key: string;
  label: string;
  cell: ComparisonCell;
}

/**
 * The partner's pace in each zone and task type, against the facility. Tiles keep a fixed
 * order, and only the cells the API returned are shown (the filters can remove some).
 * One row on wide containers, 2 × 2 on narrow ones.
 */
@Component({
  selector: 'g-comparison-tiles',
  imports: [CountPipe, DurationPipe, PacePill],
  template: `
    <ul class="tiles">
      @for (tile of tiles(); track tile.key) {
        <li class="card tile">
          <h3 class="label">{{ tile.label }}</h3>
          <g-pace-pill [pacePct]="tile.cell.pacePct" [comparison]="tile.cell.comparison" />
          @if (tile.cell.comparison === 'INSUFFICIENT_SAMPLE') {
            <p class="needs muted">Needs {{ minSampleSize() | count }} tasks</p>
          } @else {
            <p class="medians num">
              {{ tile.cell.partnerMedianMs | duration }}
              <span class="muted">vs {{ tile.cell.facilityMedianMs | duration }}</span>
            </p>
          }
          <p class="count muted num">{{ tile.cell.taskCount | count }} tasks</p>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    @container (min-width: 640px) {
      .tiles {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
    }
    .label {
      font-size: var(--text-sm);
      font-weight: var(--weight-regular);
      color: var(--text-muted);
    }
    .medians {
      font-size: var(--text-lg);
    }
    .medians .muted,
    .needs,
    .count {
      font-size: var(--text-sm);
    }
  `,
})
export class ComparisonTiles {
  readonly cells = input.required<readonly ComparisonCell[]>();
  /** From `MetaService`: the backend's minimum sample, never hard-coded. */
  readonly minSampleSize = input.required<number>();

  protected readonly tiles = computed<Tile[]>(() =>
    TILE_ORDER.flatMap(({ zone, taskType }) => {
      const cell = this.cells().find((c) => c.zone === zone && c.taskType === taskType);
      return cell ? [{ key: `${zone}-${taskType}`, label: tileLabel(zone, taskType), cell }] : [];
    }),
  );
}

/** "Ambient cycle count" */
export function tileLabel(zone: Zone, taskType: TaskType): string {
  return `${ZONE_LABELS[zone]} ${TASK_TYPE_LABELS[taskType].toLowerCase()}`;
}
