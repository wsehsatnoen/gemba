import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Meta } from './api/types';
import { FilterState, parseFilters } from './filter-state';
import { MetaService } from './meta.service';

const META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

describe('parseFilters', () => {
  it('defaults to the whole range and both zones and task types', () => {
    expect(parseFilters({}, META)).toEqual({
      filters: { from: '2027-01-04', to: '2027-01-31', zone: null, taskType: null },
      invalid: [],
    });
  });

  it('reads valid values', () => {
    const parsed = parseFilters(
      { from: '2027-01-10', to: '2027-01-12', zone: 'CHILLED', taskType: 'CYCLE_COUNT' },
      META,
    );
    expect(parsed.filters).toEqual({
      from: '2027-01-10',
      to: '2027-01-12',
      zone: 'CHILLED',
      taskType: 'CYCLE_COUNT',
    });
    expect(parsed.invalid).toEqual([]);
  });

  it('falls back to the default for each invalid value and reports it', () => {
    const parsed = parseFilters(
      { from: '2026-12-01', to: 'tomorrow', zone: 'FROZEN', taskType: 'cycle_count' },
      META,
    );
    expect(parsed.filters).toEqual({
      from: '2027-01-04',
      to: '2027-01-31',
      zone: null,
      taskType: null,
    });
    expect(parsed.invalid).toEqual(['from', 'to', 'zone', 'taskType']);
  });

  it('resets both dates when from is after to', () => {
    const parsed = parseFilters({ from: '2027-01-20', to: '2027-01-10' }, META);
    expect(parsed.filters.from).toBe('2027-01-04');
    expect(parsed.filters.to).toBe('2027-01-31');
    expect(parsed.invalid).toEqual(['from', 'to']);
  });
});

@Component({ template: '' })
class Blank {}

describe('FilterState', () => {
  let harness: RouterTestingHarness;
  let state: FilterState;
  let router: Router;

  async function open(url: string) {
    harness = await RouterTestingHarness.create(url);
    state = TestBed.inject(FilterState);
    router = TestBed.inject(Router);
  }

  async function settle() {
    await harness.fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'tasks', component: Blank },
          { path: 'partners/:id', component: Blank },
        ]),
        // A synchronous Location, so back() is testable.
        provideLocationMocks(),
        { provide: MetaService, useValue: { meta: signal(META) } },
      ],
    });
  });

  it('reads filters and page-level parameters from the URL', async () => {
    await open('/tasks?zone=CHILLED&page=2&task=48213&aboveP90=true&day=2027-01-19&q=0142');
    expect(state.filters().zone).toBe('CHILLED');
    expect(state.page()).toBe(2);
    expect(state.task()).toBe(48213);
    expect(state.aboveP90()).toBe(true);
    expect(state.day()).toBe('2027-01-19');
    expect(state.q()).toBe('0142');
    expect(state.apiParams()).toEqual({ from: '2027-01-04', to: '2027-01-31', zone: 'CHILLED' });
  });

  it('keeps the same filter objects when only page-level parameters change', async () => {
    await open('/tasks?zone=CHILLED');
    const filters = state.filters();
    const apiParams = state.apiParams();
    await router.navigateByUrl('/tasks?zone=CHILLED&task=48213');
    expect(state.task()).toBe(48213);
    expect(state.filters()).toBe(filters);
    expect(state.apiParams()).toBe(apiParams);
    await router.navigateByUrl('/tasks?zone=AMBIENT&task=48213');
    expect(state.apiParams()).not.toBe(apiParams);
  });

  it('ignores malformed page-level parameters', async () => {
    await open('/tasks?page=-1&task=abc&day=Jan19');
    expect(state.page()).toBe(0);
    expect(state.task()).toBeNull();
    expect(state.day()).toBeNull();
  });

  it('follows navigation, including back', async () => {
    await open('/tasks?zone=CHILLED');
    // In the app, bootstrapping starts the router's popstate listener; here we start it.
    router.setUpLocationChangeListener();
    await router.navigateByUrl('/tasks?zone=AMBIENT');
    expect(state.filters().zone).toBe('AMBIENT');
    TestBed.inject(Location).back();
    // The router reacts to popstate in a later task.
    await new Promise((resolve) => setTimeout(resolve));
    await settle();
    expect(state.filters().zone).toBe('CHILLED');
  });

  it('writes filters to the URL, drops defaults, and restarts paging', async () => {
    await open('/tasks?page=3&task=48213');
    state.setFilters({ zone: 'AMBIENT', from: '2027-01-04', to: '2027-01-20' });
    await settle();
    expect(router.parseUrl(router.url).queryParams).toEqual({
      task: '48213',
      zone: 'AMBIENT',
      to: '2027-01-20',
    });
    expect(state.filters()).toEqual({
      from: '2027-01-04',
      to: '2027-01-20',
      zone: 'AMBIENT',
      taskType: null,
    });
  });

  it('keeps the current path when setting parameters', async () => {
    await open('/partners/SIMUSR0142');
    state.setParams({ day: '2027-01-19', aboveP90: true });
    await settle();
    expect(router.url).toBe('/partners/SIMUSR0142?day=2027-01-19&aboveP90=true');
    state.setParams({ day: null, aboveP90: false });
    await settle();
    expect(router.url).toBe('/partners/SIMUSR0142');
  });

  it('clears filters but keeps the open task and mock mode', async () => {
    await open('/tasks?zone=CHILLED&q=01&page=2&aboveP90=true&task=7&mock=slow');
    expect(state.isClear()).toBe(false);
    state.clearFilters();
    await settle();
    expect(router.url).toBe('/tasks?task=7&mock=slow');
    expect(state.isClear()).toBe(true);
  });

  it('builds link parameters from the filter bar and mock mode only', async () => {
    await open('/tasks?zone=CHILLED&page=2&task=7&mock=empty');
    expect(state.linkParams()).toEqual({ zone: 'CHILLED', mock: 'empty' });
  });
});
