import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { META } from '../../../mocks/fixtures/meta';
import { mockApiInterceptor } from '../../../mocks/mock-api.interceptor';
import { MetaService } from '../../core/meta.service';
import { Viewport } from '../../core/viewport';
import { TasksPage } from './tasks-page';

describe('TasksPage', () => {
  const isDesktop = signal(true);

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    await harness.fixture.whenStable();
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
        provideRouter([{ path: 'tasks', component: TasksPage }]),
        provideHttpClient(withInterceptors([mockApiInterceptor])),
        {
          provide: MetaService,
          useValue: {
            meta: signal(META),
            timeZone: signal(META.facilityTimeZone),
            require: () => META,
          },
        },
        { provide: Viewport, useValue: { isDesktop } },
      ],
    });
  });

  it('lists tasks under the "Tasks" heading', async () => {
    const { el } = await open('/tasks');
    expect(el.querySelector('h1')!.textContent).toBe('Tasks');
    expect(el.querySelectorAll('tbody tr').length).toBe(25);
    expect(el.querySelector('g-task-panel')).toBeNull();
  });

  it('opens the panel beside the list from a row and closes it again', async () => {
    const { harness, el, router } = await open('/tasks');
    el.querySelector<HTMLButtonElement>('[data-task-id="48213"]')!.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks?task=48213');
    expect(el.querySelector('.layout')!.classList).toContain('with-panel');
    expect(el.querySelector('g-task-panel h2')!.textContent).toBe('Task 48213');

    el.querySelector<HTMLButtonElement>('[aria-label="Close task"]')!.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks');
    expect(el.querySelector('g-task-panel')).toBeNull();
  });

  it('makes the list inert behind the full-screen panel on mobile', async () => {
    isDesktop.set(false);
    const { el } = await open('/tasks?task=48213');
    expect(el.querySelector('.list')!.hasAttribute('inert')).toBe(true);
    expect(el.querySelector('.layout')!.classList).not.toContain('with-panel');
  });

  it('writes the Above P90 toggle to the URL and restarts paging', async () => {
    const { harness, el, router } = await open('/tasks?page=1');
    const toggle = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    toggle.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks?aboveP90=true');
    expect(el.querySelectorAll('tbody .pill.slower').length).toBe(
      el.querySelectorAll('tbody tr').length,
    );

    toggle.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks');
  });

  it('filters by partner and shows it as a removable chip', async () => {
    const { harness, el, router } = await open('/tasks');
    const input = el.querySelector<HTMLInputElement>('#partner-filter')!;
    input.value = 'simusr0142';
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks?partnerId=SIMUSR0142');
    expect(el.querySelector('.chip')!.textContent).toContain('Partner SIMUSR0142');

    el.querySelector<HTMLButtonElement>('.chip-remove')!.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/tasks');
  });
});
