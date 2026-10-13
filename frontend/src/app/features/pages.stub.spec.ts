// Smoke tests for the Phase 1 stub pages. Each feature agent replaces its page's test.
import { signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Meta } from '../core/api/types';
import { MetaService } from '../core/meta.service';
import { OverviewPage } from './overview/overview-page';
import { PartnerDetailPage } from './partners/partner-detail-page';
import { PartnerListPage } from './partners/partner-list-page';
import { TasksPage } from './tasks/tasks-page';
import { withComponentInputBinding } from '@angular/router';

const META = { dataFrom: '2027-01-04', dataTo: '2027-01-31' } as Meta;

describe('stub pages', () => {
  async function render(path: string, url: string, component: Type<unknown>) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path, component }], withComponentInputBinding()),
        { provide: MetaService, useValue: { meta: signal(META), require: () => META } },
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return harness.routeNativeElement as HTMLElement;
  }

  it('renders the overview with its title and description', async () => {
    const el = await render('', '/', OverviewPage);
    expect(el.querySelector('h1')?.textContent).toBe('Overview');
    expect(el.textContent).toContain("Each task pairs a bin's start move with its end move.");
  });

  it('renders the partner list', async () => {
    const el = await render('partners', '/partners', PartnerListPage);
    expect(el.querySelector('h1')?.textContent).toBe('Partners');
  });

  it('binds the partner ID from the route', async () => {
    const el = await render('partners/:partnerId', '/partners/SIMUSR0142', PartnerDetailPage);
    expect(el.textContent).toContain('SIMUSR0142');
  });

  it('renders the tasks page', async () => {
    const el = await render('tasks', '/tasks', TasksPage);
    expect(el.querySelector('h1')?.textContent).toBe('Tasks');
  });
});
