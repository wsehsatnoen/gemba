import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SUMMARY, EMPTY_SUMMARY } from '../../../mocks/fixtures/summary';
import { WEEKDAY_STATS } from '../../../mocks/fixtures/weekday';
import { ZONE_TASK_TYPE_STATS } from '../../../mocks/fixtures/zone-task-type';
import type { Meta, Problem } from '../../core/api/types';
import { FilterState } from '../../core/filter-state';
import { formatCount, formatHours } from '../../core/format';
import { MetaService } from '../../core/meta.service';
import { BarChart } from '../../shared/charts/bar-chart';
import { Sparkline } from '../../shared/charts/sparkline';
import { StatCard } from '../../shared/ui/stat-card';
import { State } from '../../shared/ui/state';
import { EmptyRange } from './empty-range';
import { MedianGrid } from './median-grid';
import { OverviewPage } from './overview-page';
import { OverviewSummary } from './overview-summary';
import { regionStatus } from './region-status';
import { sameParams } from './stable-filters';
import { WeekdayChart } from './weekday-chart';

const META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

const PROBLEM: Problem = {
  type: 'about:blank',
  title: 'Internal Server Error',
  status: 500,
  detail: 'The mock was asked to fail.',
};

@Component({ template: '' })
class Blank {}

interface Rendered<T> {
  fixture: ComponentFixture<T>;
  http: HttpTestingController;
  harness: RouterTestingHarness;
  el: HTMLElement;
}

/** Navigates to `url` (so FilterState sees its query string), then creates `component`. */
async function render<T>(component: Type<T>, url = '/'): Promise<Rendered<T>> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', component: Blank }]),
      provideLocationMocks(),
      {
        provide: MetaService,
        useValue: { meta: signal(META), timeZone: signal('UTC'), require: () => META },
      },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  TestBed.tick();
  return {
    fixture,
    http: TestBed.inject(HttpTestingController),
    harness,
    el: fixture.nativeElement as HTMLElement,
  };
}

async function flush<T>(r: Rendered<T>, path: string, body: object): Promise<void> {
  r.http.expectOne((req) => req.url === path).flush(body);
  await r.fixture.whenStable();
}

async function fail<T>(r: Rendered<T>, path: string): Promise<void> {
  r.http
    .expectOne((req) => req.url === path)
    .flush(PROBLEM, { status: 500, statusText: 'Internal Server Error' });
  await r.fixture.whenStable();
}

function instances<C>(fixture: ComponentFixture<unknown>, type: Type<C>): C[] {
  return fixture.debugElement.queryAll(By.directive(type)).map((d) => d.componentInstance as C);
}

describe('regionStatus', () => {
  const resource = (isLoading: boolean, error: unknown) =>
    ({ isLoading: () => isLoading, error: () => error }) as never;

  it('is loading first, then error, then ready', () => {
    expect(regionStatus(resource(true, undefined))).toBe('loading');
    expect(regionStatus(resource(false, new Error('x')))).toBe('error');
    expect(regionStatus(resource(false, undefined))).toBe('ready');
  });
});

describe('sameParams', () => {
  it('compares filter values, not object identity', () => {
    expect(sameParams({ from: 'a', to: 'b' }, { from: 'a', to: 'b' })).toBe(true);
    expect(sameParams({ from: 'a', to: 'b' }, { from: 'a', to: 'c' })).toBe(false);
    expect(sameParams({ from: 'a', to: 'b' }, { from: 'a', to: 'b', zone: 'CHILLED' })).toBe(false);
  });
});

describe('EmptyRange', () => {
  it('says the range is empty and clears the filters', async () => {
    const r = await render(EmptyRange, '/?zone=CHILLED');
    const clear = vi.spyOn(TestBed.inject(FilterState), 'clearFilters');
    expect(r.el.textContent).toContain('No tasks in this range.');
    r.el.querySelector('button')!.click();
    expect(clear).toHaveBeenCalled();
  });
});

describe('OverviewSummary', () => {
  it('shows skeletons until the summary arrives', async () => {
    const r = await render(OverviewSummary);
    expect(r.el.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(r.el.querySelectorAll('.skeleton-card')).toHaveLength(4);
    await flush(r, '/api/analytics/summary', SUMMARY);
    expect(r.el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('sends the filters and shows the four cards from the API fields', async () => {
    const r = await render(OverviewSummary, '/?zone=AMBIENT');
    const req = r.http.expectOne((q) => q.url === '/api/analytics/summary');
    expect(req.request.params.get('from')).toBe('2027-01-04');
    expect(req.request.params.get('to')).toBe('2027-01-31');
    expect(req.request.params.get('zone')).toBe('AMBIENT');
    req.flush(SUMMARY);
    await r.fixture.whenStable();

    const cards = instances(r.fixture, StatCard).map((c) => [c.label(), c.value(), c.sub()]);
    expect(cards).toEqual([
      ['Tasks paired', '31,292', 'from 80,000 rows'],
      ['Tasks per day', '1,118', '28 operating days'],
      ['Task hours per day', '58.4', 'time on task'],
      ['Duplicate starts discarded', '214', 'later start kept'],
    ]);
    expect(r.el.querySelector('.note')).toBeNull();
  });

  it('notes unattributed tasks when there are any', async () => {
    const r = await render(OverviewSummary);
    await flush(r, '/api/analytics/summary', { ...SUMMARY, unattributedTasks: 1204 });
    expect(r.el.querySelector('.note')!.textContent).toBe('1,204 tasks have no partner ID.');
  });

  it('shows the empty state when the range has no tasks', async () => {
    const r = await render(OverviewSummary);
    await flush(r, '/api/analytics/summary', EMPTY_SUMMARY);
    expect(instances(r.fixture, StatCard)).toHaveLength(0);
    expect(instances(r.fixture, EmptyRange)).toHaveLength(1);
  });

  it('shows the problem and retries', async () => {
    const r = await render(OverviewSummary);
    await fail(r, '/api/analytics/summary');
    const [state] = instances(r.fixture, State);
    expect(state.status()).toBe('error');
    expect(state.problem()?.title).toBe('Internal Server Error');

    state.retry.emit();
    TestBed.tick();
    await flush(r, '/api/analytics/summary', SUMMARY);
    expect(instances(r.fixture, StatCard)).toHaveLength(4);
  });
});

describe('MedianGrid', () => {
  it('shows a skeleton cell per grid cell while loading', async () => {
    const r = await render(MedianGrid);
    expect(r.el.querySelectorAll('.skeleton-cell')).toHaveLength(4);
    await flush(r, '/api/analytics/zone-task-type', ZONE_TASK_TYPE_STATS);
    expect(r.el.querySelector('.skeleton-cell')).toBeNull();
  });

  it('puts each stat in its zone column and task type row', async () => {
    const r = await render(MedianGrid);
    // Reverse the API order to prove cells are found by zone and task type, not position.
    await flush(r, '/api/analytics/zone-task-type', [...ZONE_TASK_TYPE_STATS].reverse());

    const headers = [...r.el.querySelectorAll('thead th')].map((th) => th.textContent!.trim());
    expect(headers).toEqual(['Ambient', 'Chilled']);
    const rows = [...r.el.querySelectorAll('tbody tr')].map((tr) => ({
      head: tr.querySelector('th')!.textContent!.trim(),
      medians: [...tr.querySelectorAll('.median')].map((m) => m.textContent!.trim()),
      p90s: [...tr.querySelectorAll('.p90')].map((m) => m.textContent!.trim()),
      counts: [...tr.querySelectorAll('.count')].map((m) => m.textContent!.trim()),
    }));
    expect(rows).toEqual([
      {
        head: 'Cycle count',
        medians: ['0:48', '0:55'],
        p90s: ['P90 1:52', 'P90 2:08'],
        counts: ['8,419 tasks', '7,778 tasks'],
      },
      {
        head: 'Bin maintenance',
        medians: ['2:35', '2:50'],
        p90s: ['P90 16:30', 'P90 18:10'],
        counts: ['7,274 tasks', '7,821 tasks'],
      },
    ]);
  });

  it('draws a sparkline of each cell’s daily medians', async () => {
    const r = await render(MedianGrid);
    await flush(r, '/api/analytics/zone-task-type', ZONE_TASK_TYPE_STATS);
    const sparks = instances(r.fixture, Sparkline);
    expect(sparks.map((s) => s.label())).toEqual([
      'Daily median, Ambient cycle count',
      'Daily median, Chilled cycle count',
      'Daily median, Ambient bin maintenance',
      'Daily median, Chilled bin maintenance',
    ]);
    const ambientCycle = ZONE_TASK_TYPE_STATS.find(
      (s) => s.zone === 'AMBIENT' && s.taskType === 'CYCLE_COUNT',
    )!;
    expect(sparks[0].points()).toEqual(ambientCycle.daily.map((d) => d.medianMs));
  });

  it('links each cell to its tasks with the current dates', async () => {
    const r = await render(MedianGrid, '/?from=2027-01-10&to=2027-01-20&weekday=hours');
    await flush(r, '/api/analytics/zone-task-type', ZONE_TASK_TYPE_STATS);
    const hrefs = [...r.el.querySelectorAll('a.cell-link')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/tasks?from=2027-01-10&to=2027-01-20&zone=AMBIENT&taskType=CYCLE_COUNT',
      '/tasks?from=2027-01-10&to=2027-01-20&zone=CHILLED&taskType=CYCLE_COUNT',
      '/tasks?from=2027-01-10&to=2027-01-20&zone=AMBIENT&taskType=BIN_MAINTENANCE',
      '/tasks?from=2027-01-10&to=2027-01-20&zone=CHILLED&taskType=BIN_MAINTENANCE',
    ]);
    expect(r.el.querySelector('a.cell-link')!.textContent).toContain('Ambient cycle count');
  });

  it('marks cells the filters exclude instead of linking them', async () => {
    const r = await render(MedianGrid, '/?zone=CHILLED');
    await flush(
      r,
      '/api/analytics/zone-task-type',
      ZONE_TASK_TYPE_STATS.filter((s) => s.zone === 'CHILLED'),
    );
    expect(r.el.querySelectorAll('a.cell-link')).toHaveLength(2);
    const excluded = r.el.querySelectorAll('.excluded');
    expect(excluded).toHaveLength(2);
    expect(excluded[0].textContent).toContain('Ambient cycle count');
    expect(excluded[0].textContent).toContain('Not in these filters');
  });

  it('shows the empty state for an empty list', async () => {
    const r = await render(MedianGrid);
    await flush(r, '/api/analytics/zone-task-type', []);
    expect(r.el.querySelector('table')).toBeNull();
    expect(instances(r.fixture, EmptyRange)).toHaveLength(1);
  });

  it('shows the problem and retries', async () => {
    const r = await render(MedianGrid);
    await fail(r, '/api/analytics/zone-task-type');
    const [state] = instances(r.fixture, State);
    expect(state.problem()?.status).toBe(500);
    state.retry.emit();
    TestBed.tick();
    await flush(r, '/api/analytics/zone-task-type', ZONE_TASK_TYPE_STATS);
    expect(r.el.querySelectorAll('a.cell-link')).toHaveLength(4);
  });
});

describe('WeekdayChart', () => {
  const pressed = (el: HTMLElement) =>
    [...el.querySelectorAll('.segmented button')].map((b) => [
      b.textContent!.trim(),
      b.getAttribute('aria-pressed'),
    ]);

  it('shows a skeleton while loading', async () => {
    const r = await render(WeekdayChart);
    expect(r.el.querySelector('.skeleton-chart')).not.toBeNull();
    await flush(r, '/api/analytics/weekday', WEEKDAY_STATS);
    expect(r.el.querySelector('.skeleton-chart')).toBeNull();
  });

  it('shows average tasks by default', async () => {
    const r = await render(WeekdayChart);
    await flush(r, '/api/analytics/weekday', WEEKDAY_STATS);
    const [chart] = instances(r.fixture, BarChart);
    expect(chart.bars().map((b) => b.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(chart.bars()[0].value).toBe(1243);
    expect(chart.format()).toBe(formatCount);
    expect(chart.label()).toBe('Average tasks per operating day by day of week');
    expect(pressed(r.el)).toEqual([
      ['Tasks', 'true'],
      ['Hours', 'false'],
    ]);
    expect(r.el.textContent).toContain('Average per operating day');
  });

  it('switches to hours through the URL and back', async () => {
    const r = await render(WeekdayChart, '/?zone=AMBIENT');
    await flush(r, '/api/analytics/weekday', WEEKDAY_STATS);
    const location = TestBed.inject(Location);

    (r.el.querySelectorAll('.segmented button')[1] as HTMLButtonElement).click();
    await r.fixture.whenStable();
    expect(location.path()).toBe('/?zone=AMBIENT&weekday=hours');
    const [chart] = instances(r.fixture, BarChart);
    expect(chart.bars()[0].value).toBe(65.0);
    expect(chart.format()).toBe(formatHours);
    expect(pressed(r.el)).toEqual([
      ['Tasks', 'false'],
      ['Hours', 'true'],
    ]);

    (r.el.querySelectorAll('.segmented button')[0] as HTMLButtonElement).click();
    await r.fixture.whenStable();
    expect(location.path()).toBe('/?zone=AMBIENT');
    // The toggle doesn't refetch: the response has both figures.
    r.http.expectNone((req) => req.url === '/api/analytics/weekday');
  });

  it('reads hours from the URL', async () => {
    const r = await render(WeekdayChart, '/?weekday=hours');
    await flush(r, '/api/analytics/weekday', WEEKDAY_STATS);
    expect(instances(r.fixture, BarChart)[0].format()).toBe(formatHours);
  });

  it('shows the empty state for an empty list', async () => {
    const r = await render(WeekdayChart);
    await flush(r, '/api/analytics/weekday', []);
    expect(instances(r.fixture, BarChart)).toHaveLength(0);
    expect(instances(r.fixture, EmptyRange)).toHaveLength(1);
  });

  it('shows the problem and retries', async () => {
    const r = await render(WeekdayChart);
    await fail(r, '/api/analytics/weekday');
    const [state] = instances(r.fixture, State);
    expect(state.status()).toBe('error');
    state.retry.emit();
    TestBed.tick();
    await flush(r, '/api/analytics/weekday', WEEKDAY_STATS);
    expect(instances(r.fixture, BarChart)).toHaveLength(1);
  });
});

describe('OverviewPage', () => {
  it('has the title, the description, and all three regions', async () => {
    const r = await render(OverviewPage);
    expect(r.el.querySelector('h1')!.textContent).toBe('Overview');
    expect(r.el.textContent).toContain("Each task pairs a bin's start move with its end move.");
    expect(r.el.querySelector('g-overview-summary')).not.toBeNull();
    expect(r.el.querySelector('g-median-grid')).not.toBeNull();
    expect(r.el.querySelector('g-weekday-chart')).not.toBeNull();
    // Each region loads on its own, so one failing doesn't hide the others.
    r.http
      .expectOne('/api/analytics/summary?from=2027-01-04&to=2027-01-31')
      .flush(PROBLEM, { status: 500, statusText: 'Internal Server Error' });
    r.http
      .expectOne((req) => req.url === '/api/analytics/zone-task-type')
      .flush(ZONE_TASK_TYPE_STATS);
    r.http.expectOne((req) => req.url === '/api/analytics/weekday').flush(WEEKDAY_STATS);
    await r.fixture.whenStable();
    expect(instances(r.fixture, State)).toHaveLength(1);
    expect(instances(r.fixture, BarChart)).toHaveLength(1);
  });
});
