import {
  HttpErrorResponse,
  HttpRequest,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PartnerPage } from '../../core/api/types';
import { MetaService } from '../../core/meta.service';
import { Viewport } from '../../core/viewport';
import { PartnerListPage } from './partner-list-page';
import { setUpPartnerPage, TEST_META } from './partners.testing';

describe('PartnerListPage', () => {
  const isDesktop = signal(true);
  let open: ReturnType<typeof setUpPartnerPage>;

  beforeEach(() => {
    isDesktop.set(true);
    open = setUpPartnerPage('partners', PartnerListPage, isDesktop);
  });

  it('lists partners by task count in a table, each linking to the partner with filters kept', async () => {
    const { el } = await open('/partners?zone=CHILLED');
    expect(el.querySelector('h1')?.textContent).toBe('Partners');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(12);
    expect(rows[0].textContent).toContain('SIMUSR0118');
    expect(rows[0].textContent).toContain('655');
    const link = el.querySelector('a[href^="/partners/SIMUSR0142"]')!;
    expect(link.getAttribute('href')).toBe('/partners/SIMUSR0142?zone=CHILLED');
    expect(el.textContent).toContain('12 partners');
  });

  it('uses stacked rows under 1024 px', async () => {
    isDesktop.set(false);
    const { el } = await open('/partners');
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelector('.stacked a')!.textContent).toContain('655 tasks · 21 days worked');
  });

  it('shows the URL search and writes a new search with the page reset', async () => {
    const { el, router, settle } = await open('/partners?q=0142&page=1');
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.value).toBe('0142');
    input.value = '02';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(router.url).toBe('/partners?q=02');
    expect(el.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('names the search when nothing matches, and clears filters', async () => {
    const { el, router, settle } = await open('/partners?q=nobody&zone=AMBIENT');
    expect(el.textContent).toContain('No partners match “nobody”.');
    const clear = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Clear filters',
    );
    clear!.click();
    await settle();
    expect(router.url).toBe('/partners');
  });
});

/** Lets a response arrive and the view update. */
async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

describe('PartnerListPage requests', () => {
  let requests: HttpRequest<unknown>[];
  let reply: () => Observable<HttpResponse<unknown>>;

  const page = (number: number, totalPages: number): PartnerPage => ({
    items: [
      {
        partnerId: 'SIMUSR0142',
        taskCount: 612,
        daysWorked: 18,
        pacePct: 105.9,
        comparison: 'FASTER',
      },
    ],
    page: { number, size: 25, totalElements: 60, totalPages },
  });
  const ok = (body: unknown) => () => of(new HttpResponse({ status: 200, body }));

  async function open(url: string) {
    requests = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([
            (req) => {
              requests.push(req);
              return reply();
            },
          ]),
        ),
        provideRouter([{ path: 'partners', component: PartnerListPage }]),
        {
          provide: MetaService,
          useValue: {
            meta: signal(TEST_META),
            timeZone: signal('America/Chicago'),
            require: () => TEST_META,
          },
        },
        { provide: Viewport, useValue: { isDesktop: signal(true) } },
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    await settle(harness);
    const el = harness.routeNativeElement as HTMLElement;
    const button = (name: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
    return { harness, el, button, router: TestBed.inject(Router) };
  }

  it('asks for the filtered, searched page sorted by task count, and pages', async () => {
    reply = ok(page(1, 3));
    const { harness, el, button, router } = await open('/partners?q=SIM&zone=AMBIENT&page=1');
    expect(requests.at(-1)!.params.toString()).toBe(
      'from=2027-01-04&to=2027-01-31&zone=AMBIENT&q=SIM&page=1&sort=taskCount,desc',
    );
    expect(el.textContent).toContain('Page 2 of 3');

    reply = ok(page(2, 3));
    button('Next').click();
    await settle(harness);
    expect(router.url).toBe('/partners?q=SIM&zone=AMBIENT&page=2');
    expect(el.textContent).toContain('Page 3 of 3');
    expect(button('Next').disabled).toBe(true);

    button('Previous').click();
    await settle(harness);
    expect(router.url).toBe('/partners?q=SIM&zone=AMBIENT&page=1');
  });

  it('shows the problem with a retry on error', async () => {
    reply = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            error: { type: 'about:blank', title: 'Server error', status: 500, detail: 'Later.' },
          }),
      );
    const { harness, el, button } = await open('/partners');
    expect(el.textContent).toContain('Server error');

    reply = ok(page(0, 1));
    button('Try again').click();
    await settle(harness);
    expect(el.textContent).toContain('SIMUSR0142');
  });
});
