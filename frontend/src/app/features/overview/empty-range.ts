import { Component, inject } from '@angular/core';
import { FilterState } from '../../core/filter-state';
import { State } from '../../shared/ui/state';

/** The empty state every overview region shows when the filters match no tasks. */
@Component({
  selector: 'g-empty-range',
  imports: [State],
  template: `
    <g-state status="empty">
      <p>No tasks in this range.</p>
      <button type="button" class="control" (click)="filterState.clearFilters()">
        Clear filters
      </button>
    </g-state>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class EmptyRange {
  protected readonly filterState = inject(FilterState);
}
