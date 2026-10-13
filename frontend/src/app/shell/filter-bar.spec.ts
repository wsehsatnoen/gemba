import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Meta } from '../core/api/types';
import { MetaService } from '../core/meta.service';
import { Viewport } from '../core/viewport';
import { FilterBar } from './filter-bar';

const META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

@Component({ imports: [FilterBar], template: '<g-filter-bar />' })
class Host {}

describe('FilterBar', () => {
  const isDesktop = signal(true);

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    return {
      harness,
      el: harness.routeNativeElement as HTMLElement,
      router: TestBed.inject(Router),
    };
  }

  beforeEach(() => {
    isDesktop.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'tasks', component: Host }]),
        { provide: MetaService, useValue: { meta: signal(META), require: () => META } },
        { provide: Viewport, useValue: { isDesktop } },
      ],
    });
  });

  it('shows the current range and writes the zone to the URL', async () => {
    const { harness, el, router } = await open('/tasks?page=2');
    expect(el.textContent).toContain('Jan 4–31, 2027');
    const zone = el.querySelector<HTMLSelectElement>('#filter-zone')!;
    zone.value = 'CHILLED';
    zone.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks?zone=CHILLED');
  });

  it('removes the task type from the URL for "All task types"', async () => {
    const { harness, el, router } = await open('/tasks?taskType=CYCLE_COUNT');
    const select = el.querySelector<HTMLSelectElement>('#filter-task-type')!;
    expect(select.value).toBe('CYCLE_COUNT');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks');
  });

  it('opens the date dialog and sets a valid start date', async () => {
    const { harness, el, router } = await open('/tasks');
    el.querySelector<HTMLButtonElement>('.trigger')!.click();
    await harness.fixture.whenStable();
    const from = document.querySelector<HTMLInputElement>('#filter-from')!;
    expect(from.min).toBe('2027-01-04');
    from.value = '2027-01-10';
    from.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks?from=2027-01-10');
  });

  it('rejects a start date after the end date', async () => {
    const { harness, el, router } = await open('/tasks?to=2027-01-10');
    el.querySelector<HTMLButtonElement>('.trigger')!.click();
    await harness.fixture.whenStable();
    const from = document.querySelector<HTMLInputElement>('#filter-from')!;
    from.value = '2027-01-20';
    from.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks?to=2027-01-10');
    expect(from.value).toBe('2027-01-04');
  });

  it('shows a notice for invalid parameters', async () => {
    const { el } = await open('/tasks?zone=FROZEN&from=nope');
    expect(el.querySelector('.notice')?.textContent).toContain('start date, zone');
  });

  it('collapses to chips under 1024 px that open a panel', async () => {
    isDesktop.set(false);
    const { harness, el } = await open('/tasks?zone=AMBIENT');
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('.chip'));
    expect(chips.map((c) => c.textContent?.trim())).toEqual([
      'Dates: Jan 4–31, 2027',
      'Zone: Ambient',
      'Task type: All task types',
    ]);
    chips[1].click();
    await harness.fixture.whenStable();
    expect(el.querySelector('#filter-panel')).not.toBeNull();
    expect(chips[1].getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('filter-zone');

    el.querySelector<HTMLButtonElement>('#filter-panel .button-primary')!.click();
    await harness.fixture.whenStable();
    expect(el.querySelector('#filter-panel')).toBeNull();
    expect(document.activeElement).toBe(chips[1]);
  });
});
