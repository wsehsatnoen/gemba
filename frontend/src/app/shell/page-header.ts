import { Component, input } from '@angular/core';
import { FilterBar } from './filter-bar';

/**
 * The top of every page: the page title (or projected `[headerStart]` content, such as a
 * search box) on the left, the filter bar on the right, and a projected description below.
 * Every page uses it, so the filter bar is on every page.
 */
@Component({
  selector: 'g-page-header',
  imports: [FilterBar],
  template: `
    <div class="row">
      <div class="start">
        @if (heading()) {
          <h1>{{ heading() }}</h1>
        }
        <ng-content select="[headerStart]" />
      </div>
      <g-filter-bar />
    </div>
    <div class="description muted"><ng-content /></div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--space-5);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3) var(--space-4);
    }
    .start {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }
    .description:not(:empty) {
      margin-top: var(--space-2);
    }
  `,
})
export class PageHeader {
  readonly heading = input<string | null>(null);
}
