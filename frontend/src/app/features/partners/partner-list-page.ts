import { Component } from '@angular/core';
import { PageHeader } from '../../shell/page-header';

/**
 * /partners: search and a paged partner list, sorted by task count.
 * STUB (Phase 1). Agent D builds it.
 */
@Component({
  selector: 'g-partner-list-page',
  imports: [PageHeader],
  template: `<g-page-header heading="Partners" />
    <div class="stub">Partner list page (stub)</div>`,
})
export class PartnerListPage {}
