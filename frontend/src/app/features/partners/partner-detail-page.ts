import { Component, input } from '@angular/core';
import { PageHeader } from '../../shell/page-header';

/**
 * /partners/:partnerId: header, comparison tiles, daily pace, and the partner's tasks.
 * STUB (Phase 1). Agent D builds it.
 */
@Component({
  selector: 'g-partner-detail-page',
  imports: [PageHeader],
  template: `<g-page-header />
    <div class="stub">Partner detail page (stub): {{ partnerId() }}</div>`,
})
export class PartnerDetailPage {
  /** Bound from the route parameter by `withComponentInputBinding()`. */
  readonly partnerId = input.required<string>();
}
