import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PartnersApi, PartnerRequest } from '../../core/api/partners-api';
import type { TaskQuery } from '../../core/api/types';
import { FilterState } from '../../core/filter-state';
import { CountPipe, formatFacilityDate, formatPace } from '../../core/format';
import { MetaService } from '../../core/meta.service';
import { FACILITY_PACE_PCT } from '../../core/pace';
import { isNotFound, toProblem } from '../../core/problem';
import { PageHeader } from '../../shell/page-header';
import type { LinePoint } from '../../shared/charts/chart-types';
import { LineChart } from '../../shared/charts/line-chart';
import { State } from '../../shared/ui/state';
import { TaskPanel } from '../tasks/task-panel';
import { TaskTable } from '../tasks/task-table';
import { ComparisonTiles } from './comparison-tiles';
import { PartnerHeader } from './partner-header';
import { PartnerSearch } from './partner-search';

/**
 * /partners/:partnerId: the partner's header, pace by zone and task type, daily pace, and
 * tasks. The selected day (`day`) and the open task (`task`) live in the URL. On desktop an
 * open task adds a right-hand column for the task panel beside the page content.
 */
@Component({
  selector: 'g-partner-detail-page',
  imports: [
    ComparisonTiles,
    CountPipe,
    LineChart,
    PageHeader,
    PartnerHeader,
    PartnerSearch,
    RouterLink,
    State,
    TaskPanel,
    TaskTable,
  ],
  templateUrl: './partner-detail-page.html',
  styleUrl: './partner-detail-page.css',
  host: { '[class.with-panel]': 'filterState.task() !== null' },
})
export class PartnerDetailPage {
  /** Bound from the route parameter by `withComponentInputBinding()`. */
  readonly partnerId = input.required<string>();

  protected readonly filterState = inject(FilterState);
  private readonly metaService = inject(MetaService);
  private readonly router = inject(Router);
  private readonly api = inject(PartnersApi);

  private readonly request = computed<PartnerRequest>(() => ({
    partnerId: this.partnerId(),
    filters: this.filterState.apiParams(),
  }));

  protected readonly summary = this.api.partner(this.request);
  protected readonly comparison = this.api.comparison(this.request);
  protected readonly daily = this.api.daily(this.request);

  protected readonly minSampleSize = computed(() => this.metaService.require().minSampleSize);
  protected readonly reference = FACILITY_PACE_PCT;
  protected readonly formatPace = formatPace;

  /** An unknown partner: the summary request answered 404. */
  protected readonly notFound = computed(() => isNotFound(this.summary.error()));

  protected readonly summaryProblem = computed(() => toProblem(this.summary.error()));
  protected readonly comparisonProblem = computed(() => toProblem(this.comparison.error()));
  protected readonly dailyProblem = computed(() => toProblem(this.daily.error()));

  protected readonly days = computed(() =>
    this.daily.hasValue() ? this.daily.value() : undefined,
  );

  protected readonly points = computed<LinePoint[]>(() =>
    (this.days() ?? []).map((day) => ({
      id: day.date,
      label: this.shortDate(day.date),
      value: day.pacePct,
      comparison: day.comparison,
    })),
  );

  protected readonly chartLabel = computed(() => `Daily pace for ${this.partnerId()}`);

  /** "Jan 19" for the selected day's chip. */
  protected readonly dayLabel = computed(() => {
    const day = this.filterState.day();
    return day ? this.shortDate(day) : null;
  });

  /** The selected day's `tasksAboveP90`, looked up in the daily response. */
  protected readonly aboveP90 = computed(() => {
    const day = this.filterState.day();
    return this.days()?.find((d) => d.date === day)?.tasksAboveP90 ?? null;
  });

  protected readonly taskQuery = computed<TaskQuery>(() => ({
    ...this.filterState.apiParams(),
    partnerId: this.partnerId(),
    date: this.filterState.day() ?? undefined,
    page: this.filterState.page(),
    sort: 'startedAt,desc',
  }));

  protected selectDay(day: string): void {
    this.filterState.setParams({ day, page: null });
  }

  protected clearDay(): void {
    this.filterState.setParams({ day: null, page: null });
  }

  protected selectTask(taskId: number): void {
    this.filterState.setParams({ task: taskId });
  }

  protected closeTask(): void {
    this.filterState.setParams({ task: null });
  }

  /** Searching from a partner goes back to the list with the search applied. */
  protected search(q: string): void {
    void this.router.navigate(['/partners'], {
      queryParams: { ...this.filterState.linkParams(), q: q || null },
    });
  }

  private shortDate(date: string): string {
    return formatFacilityDate(date, this.metaService.timeZone(), 'short');
  }
}
