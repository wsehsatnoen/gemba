import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TASKS } from '../../../mocks/fixtures/tasks';
import type { Meta, TaskPage, TaskQuery } from '../../core/api/types';
import { MetaService } from '../../core/meta.service';
import { Viewport } from '../../core/viewport';
import { TaskTable } from './task-table';

const META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

const PAGE_0: TaskPage = {
  items: TASKS.slice(0, 25),
  page: { number: 0, size: 25, totalElements: 61, totalPages: 3 },
};

@Component({
  imports: [TaskTable],
  template: `<g-task-table
    [query]="query()"
    [selectedTaskId]="selected()"
    (taskSelect)="picked.push($event)"
  />`,
})
class Host {
  readonly query = signal<TaskQuery>({ page: 0, sort: 'startedAt,desc' });
  readonly selected = signal<number | null>(null);
  readonly picked: number[] = [];
}

describe('TaskTable', () => {
  const isDesktop = signal(true);
  let http: HttpTestingController;

  async function render(page: TaskPage | null = PAGE_0) {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    if (page) {
      http.expectOne((r) => r.url === '/api/tasks').flush(page);
      await fixture.whenStable();
    }
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    isDesktop.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: MetaService,
          useValue: { meta: signal(META), timeZone: signal(META.facilityTimeZone) },
        },
        { provide: Viewport, useValue: { isDesktop } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows one row per task with times, labels, durations, and the Above P90 pill', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(25);
    const first = rows[0].textContent!;
    expect(first).toMatch(/\d\d:\d\d/);
    expect(el.textContent).toContain('61 tasks · Page 1 of 3');
    const aboveCount = TASKS.slice(0, 25).filter((t) => t.aboveP90).length;
    expect(el.querySelectorAll('.pill.slower').length).toBe(aboveCount);
  });

  it('sends the query it is given', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.query.set({ partnerId: 'SIMUSR0142', aboveP90: true, page: 1 });
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/tasks');
    expect(req.request.params.get('partnerId')).toBe('SIMUSR0142');
    expect(req.request.params.get('aboveP90')).toBe('true');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(PAGE_0);
  });

  it('emits taskSelect for a row and marks the selected row without relying on color', async () => {
    const { fixture, host, el } = await render();
    const button = el.querySelector<HTMLButtonElement>('[data-task-id="48213"]')!;
    button.click();
    expect(host.picked).toEqual([48213]);

    host.selected.set(48213);
    await fixture.whenStable();
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(button.closest('tr')!.querySelector('.marker')!.textContent).toBe('›');
  });

  it('returns focus to the row when the selection is cleared', async () => {
    const { fixture, host, el } = await render();
    host.selected.set(48213);
    await fixture.whenStable();
    (document.activeElement as HTMLElement | null)?.blur();

    host.selected.set(null);
    await fixture.whenStable();
    expect(document.activeElement).toBe(el.querySelector('[data-task-id="48213"]'));
  });

  it('writes the page to the URL', async () => {
    const { fixture, el } = await render();
    const next = [...el.querySelectorAll('nav button')].find((b) =>
      b.textContent!.includes('Next'),
    );
    (next as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/?page=1');
  });

  it('shows the empty state with a Clear filters action', async () => {
    const { el } = await render({
      items: [],
      page: { number: 0, size: 25, totalElements: 0, totalPages: 0 },
    });
    expect(el.textContent).toContain('No tasks match these filters.');
    expect(el.querySelector('nav')).toBeNull();
    const clear = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Clear filters');
    expect(clear).toBeTruthy();
  });

  it('shows the error state and retries', async () => {
    const { fixture, el } = await render(null);
    http
      .expectOne((r) => r.url === '/api/tasks')
      .flush(
        { type: 'about:blank', title: 'Server error', status: 500, detail: 'Try later.' },
        { status: 500, statusText: 'Server Error' },
      );
    await fixture.whenStable();
    expect(el.textContent).toContain('Server error');

    el.querySelector<HTMLButtonElement>('g-state button')!.click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/tasks').flush(PAGE_0);
    await fixture.whenStable();
    expect(el.querySelectorAll('tbody tr').length).toBe(25);
  });

  it('shows skeleton rows while loading', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('tr.skeleton-row').length).toBe(10);
    http.expectOne((r) => r.url === '/api/tasks').flush(PAGE_0);
  });

  it('uses stacked rows under 1024 px', async () => {
    isDesktop.set(false);
    const { host, el } = await render();
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelectorAll('ul.stack li').length).toBe(25);
    el.querySelector<HTMLButtonElement>('ul.stack button')!.click();
    expect(host.picked.length).toBe(1);
  });
});
