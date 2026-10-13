import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnalyticsApi } from './analytics-api';
import { PartnersApi } from './partners-api';
import { apiRequest } from './request';
import { TasksApi } from './tasks-api';
import type { FilterParams, Summary, TaskQuery } from './types';

const FILTERS: FilterParams = { from: '2027-01-04', to: '2027-01-31' };

describe('apiRequest', () => {
  it('drops empty values and skips when the query is undefined', () => {
    expect(apiRequest('/api/tasks', { page: 0, zone: undefined, q: '', aboveP90: true })).toEqual({
      url: '/api/tasks',
      params: { page: 0, aboveP90: true },
    });
    expect(apiRequest('/api/tasks', undefined)).toBeUndefined();
  });
});

describe('API services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function run<T>(fn: () => T): T {
    const result = TestBed.runInInjectionContext(fn);
    TestBed.tick();
    return result;
  }

  it('fetches the summary with the shared filters and refetches when they change', async () => {
    const filters = signal<FilterParams>(FILTERS);
    const summary = run(() => TestBed.inject(AnalyticsApi).summary(filters));

    const first = http.expectOne((r) => r.url === '/api/analytics/summary');
    expect(first.request.params.get('from')).toBe('2027-01-04');
    expect(first.request.params.has('zone')).toBe(false);
    first.flush({ tasksPaired: 31292 } as Summary);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(summary.value()?.tasksPaired).toBe(31292);

    filters.set({ ...FILTERS, zone: 'CHILLED' });
    TestBed.tick();
    const second = http.expectOne((r) => r.url === '/api/analytics/summary');
    expect(second.request.params.get('zone')).toBe('CHILLED');
    second.flush({ tasksPaired: 1 } as Summary);
  });

  it('calls each analytics endpoint', () => {
    const api = TestBed.inject(AnalyticsApi);
    run(() => api.zoneTaskType(() => FILTERS));
    run(() => api.weekday(() => FILTERS));
    http.expectOne((r) => r.url === '/api/analytics/zone-task-type').flush([]);
    http.expectOne((r) => r.url === '/api/analytics/weekday').flush([]);
  });

  it('calls each partner endpoint with an encoded partner ID', () => {
    const api = TestBed.inject(PartnersApi);
    const request = () => ({ partnerId: 'SIMUSR0142', filters: FILTERS });
    run(() => api.list(() => ({ ...FILTERS, q: '014', page: 1 })));
    run(() => api.partner(request));
    run(() => api.comparison(request));
    run(() => api.daily(() => ({ partnerId: 'a/b', filters: FILTERS })));

    const list = http.expectOne((r) => r.url === '/api/partners');
    expect(list.request.params.get('q')).toBe('014');
    expect(list.request.params.get('page')).toBe('1');
    list.flush({ items: [], page: { number: 1, size: 25, totalElements: 0, totalPages: 0 } });
    http.expectOne((r) => r.url === '/api/partners/SIMUSR0142').flush({});
    http.expectOne((r) => r.url === '/api/partners/SIMUSR0142/comparison').flush([]);
    http.expectOne((r) => r.url === '/api/partners/a%2Fb/daily').flush([]);
  });

  it('does not fetch a partner until there is a request', () => {
    run(() => TestBed.inject(PartnersApi).partner(() => undefined));
    http.expectNone(() => true);
  });

  it('pages tasks and fetches one task only when an ID is set', () => {
    const api = TestBed.inject(TasksApi);
    const query: TaskQuery = { ...FILTERS, partnerId: 'SIMUSR0142', date: '2027-01-19', page: 0 };
    run(() => api.list(() => query));
    const taskId = signal<number | null>(null);
    run(() => api.task(taskId));

    const list = http.expectOne((r) => r.url === '/api/tasks');
    expect(list.request.params.get('date')).toBe('2027-01-19');
    list.flush({ items: [], page: { number: 0, size: 25, totalElements: 0, totalPages: 0 } });
    http.expectNone((r) => r.url.startsWith('/api/tasks/'));

    taskId.set(48213);
    TestBed.tick();
    http.expectOne('/api/tasks/48213').flush({});
  });
});
