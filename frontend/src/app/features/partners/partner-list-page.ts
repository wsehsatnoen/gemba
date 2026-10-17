import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartnersApi } from '../../core/api/partners-api';
import { FilterState } from '../../core/filter-state';
import { CountPipe } from '../../core/format';
import { toProblem } from '../../core/problem';
import { Viewport } from '../../core/viewport';
import { PageHeader } from '../../shell/page-header';
import { PacePill } from '../../shared/ui/pace-pill';
import { State } from '../../shared/ui/state';
import { PartnerSearch } from './partner-search';

/** Skeleton rows shown while a page of partners loads. */
const SKELETON_ROWS = 8;

/**
 * /partners: search and a paged partner list. The default sort is task count, not pace,
 * because this is a coaching tool, not a leaderboard. A table on desktop, stacked rows
 * under 1024 px; each row opens the partner with the filters kept.
 */
@Component({
  selector: 'g-partner-list-page',
  imports: [CountPipe, PacePill, PageHeader, PartnerSearch, RouterLink, State],
  templateUrl: './partner-list-page.html',
  styleUrl: './partner-list-page.css',
})
export class PartnerListPage {
  protected readonly filterState = inject(FilterState);
  protected readonly isDesktop = inject(Viewport).isDesktop;

  protected readonly partners = inject(PartnersApi).list(() => ({
    ...this.filterState.apiParams(),
    q: this.filterState.q(),
    page: this.filterState.page(),
    sort: 'taskCount,desc',
  }));

  protected readonly problem = computed(() => toProblem(this.partners.error()));
  protected readonly page = computed(() =>
    this.partners.hasValue() ? this.partners.value() : undefined,
  );
  protected readonly skeletonRows = Array.from({ length: SKELETON_ROWS }, (_, i) => i);

  protected search(q: string): void {
    // Each keystroke's search replaces the last one in history, so Back leaves the page.
    this.filterState.setParams({ q, page: null }, { replaceUrl: true });
  }

  protected goToPage(page: number): void {
    this.filterState.setParams({ page: page === 0 ? null : page });
  }
}
