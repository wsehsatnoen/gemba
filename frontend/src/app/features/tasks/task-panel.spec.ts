import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TASK_48213 } from '../../../mocks/fixtures/tasks';
import type { Meta, TaskDetail } from '../../core/api/types';
import { MetaService } from '../../core/meta.service';
import { Viewport } from '../../core/viewport';
import { TaskPanel } from './task-panel';

const META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

@Component({
  imports: [TaskPanel],
  template: `<g-task-panel [taskId]="taskId()" (closed)="closedCount = closedCount + 1" />`,
})
class Host {
  readonly taskId = signal(48213);
  closedCount = 0;
}

describe('TaskPanel', () => {
  const isDesktop = signal(true);
  let http: HttpTestingController;
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  async function render(body: TaskDetail | null = TASK_48213, id = 48213) {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.taskId.set(id);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    if (body) {
      http.expectOne(`/api/tasks/${id}`).flush(body);
      await fixture.whenStable();
    }
  }

  const text = () => el.textContent!.replace(/\s+/g, ' ');

  beforeEach(() => {
    isDesktop.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
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

  it('shows the header, meta line, duration, and Above P90 pill', async () => {
    await render();
    expect(el.querySelector('h2')!.textContent).toBe('Task 48213');
    expect(text()).toContain('Chilled · Cycle count · Port 3 · Tue, Jan 19');
    expect(el.querySelector('.duration')!.textContent).toContain('3:41');
    expect(el.querySelector('.pill.slower')!.textContent).toBe('Above P90 (2:08)');
  });

  it('shows the partner and bin cards', async () => {
    await render();
    const cards = [...el.querySelectorAll('.info-card')].map((c) =>
      [...c.children].map((child) => child.textContent!.trim()).join(' '),
    );
    expect(cards).toEqual([
      'Partner SIMUSR0142 From the start move',
      'Bin SIMTU004417 Paired by bin',
    ]);
  });

  it('lists every move oldest first with times, locations, quantities, partners, and roles', async () => {
    await render();
    const moves = [...el.querySelectorAll('.moves li')];
    expect(moves.length).toBe(4);
    const rows = moves.map((m) => m.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('18:41:07.302');
    expect(rows[0]).toContain('MOVE GRID → PORT-03');
    expect(rows[0]).toContain('SIMUSR0207');
    expect(rows[0]).toContain('Discarded');
    expect(rows[0]).toContain('A later start on this bin arrived before the end.');
    expect(rows[1]).toContain('18:41:55.918');
    expect(rows[1]).toContain('Start');
    expect(rows[2]).toContain('ADJUST PORT-03');
    expect(rows[2]).toContain('−1 (24 → 23)');
    expect(rows[3]).toContain('PORT-03 → GRID');
    expect(rows[3]).toContain('No partner ID');
    expect(rows[3]).toContain('End');
    expect(moves[2].querySelector('.pill')).toBeNull();
  });

  it('mutes the discarded start and strikes through its time', async () => {
    await render();
    const discarded = el.querySelector('.moves li')!;
    expect(discarded.classList).toContain('discarded');
    expect(discarded.querySelector('s')!.textContent).toBe('18:41:07.302');
    expect(discarded.querySelector('.pill.neutral')).toBeTruthy();
  });

  it('explains the duration and, for START_MOVE, where the partner came from', async () => {
    await render();
    expect(text()).toContain('Duration = end − latest start on the same bin.');
    expect(text()).toContain(
      'The end move has no partner ID, so the partner comes from the start.',
    );
  });

  it('shows "Not recorded" when no row has a partner', async () => {
    await render({ ...TASK_48213, partnerId: null, partnerSource: null, aboveP90: false });
    expect(text()).toContain('Not recorded');
    expect(text()).toContain('No partner on any row');
    expect(text()).not.toContain('so the partner comes from the start');
    expect(el.querySelector('.pill.slower')).toBeNull();
  });

  it('moves focus to the heading when it opens', async () => {
    await render();
    expect(document.activeElement).toBe(el.querySelector('h2'));
  });

  it('emits closed for ×, and for Esc', async () => {
    await render();
    el.querySelector<HTMLButtonElement>('[aria-label="Close task"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.closedCount).toBe(2);
  });

  it('is a full-screen view with a back arrow under 1024 px', async () => {
    isDesktop.set(false);
    await render();
    expect(el.querySelector('g-task-panel')!.classList).toContain('fullscreen');
    expect(el.querySelector('[aria-label="Close task"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[aria-label="Back to tasks"]')!.click();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('shows a skeleton while loading', async () => {
    await render(null);
    expect(el.querySelectorAll('.loading .skeleton').length).toBeGreaterThan(0);
    http.expectOne('/api/tasks/48213').flush(TASK_48213);
  });

  it('says when the task does not exist and offers a way back', async () => {
    await render(null, 1);
    http
      .expectOne('/api/tasks/1')
      .flush(
        { type: 'about:blank', title: 'Task not found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    expect(text()).toContain("We couldn't find task 1.");
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Back to tasks')!.click();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('shows other errors with a retry', async () => {
    await render(null);
    http
      .expectOne('/api/tasks/48213')
      .flush(
        { type: 'about:blank', title: 'Server error', status: 500, detail: 'Try later.' },
        { status: 500, statusText: 'Server Error' },
      );
    await fixture.whenStable();
    expect(text()).toContain('Server error');
    el.querySelector<HTMLButtonElement>('g-state button')!.click();
    fixture.detectChanges();
    http.expectOne('/api/tasks/48213').flush(TASK_48213);
    await fixture.whenStable();
    expect(el.querySelectorAll('.moves li').length).toBe(4);
  });
});
