import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type {
  ComparisonCell,
  Meta,
  PartnerPage,
  TaskDetail,
  TaskPage,
  ZoneTaskTypeStat,
} from '../app/core/api/types';
import { mockApiInterceptor } from './mock-api.interceptor';

describe('mockApiInterceptor', () => {
  let http: HttpClient;

  beforeEach(() => {
    history.replaceState(null, '', '/');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([mockApiInterceptor]))],
    });
    http = TestBed.inject(HttpClient);
  });

  const get = <T>(url: string, params: Record<string, string> = {}) =>
    firstValueFrom(http.get<T>(url, { params }));

  async function status(url: string): Promise<number> {
    try {
      await get(url);
      return 200;
    } catch (error) {
      return (error as { status: number }).status;
    }
  }

  it('serves meta', async () => {
    expect((await get<Meta>('/api/meta')).facilityTimeZone).toBe('America/Chicago');
  });

  it('filters the zone and task type grid', async () => {
    expect(await get<ZoneTaskTypeStat[]>('/api/analytics/zone-task-type')).toHaveLength(4);
    const chilled = await get<ZoneTaskTypeStat[]>('/api/analytics/zone-task-type', {
      zone: 'CHILLED',
    });
    expect(chilled.map((s) => s.zone)).toEqual(['CHILLED', 'CHILLED']);
  });

  it('searches and pages partners, task count first', async () => {
    const all = await get<PartnerPage>('/api/partners');
    expect(all.page.totalElements).toBe(12);
    expect(all.items[0].partnerId).toBe('SIMUSR0118');
    const found = await get<PartnerPage>('/api/partners', { q: 'usr0142' });
    expect(found.items.map((p) => p.partnerId)).toEqual(['SIMUSR0142']);
  });

  it('returns comparison cells and 404 for an unknown partner', async () => {
    const cells = await get<ComparisonCell[]>('/api/partners/SIMUSR0142/comparison');
    expect(cells.map((c) => c.comparison)).toEqual([
      'FASTER',
      'SLOWER',
      'FASTER',
      'INSUFFICIENT_SAMPLE',
    ]);
    expect(await status('/api/partners/SIMUSR9999')).toBe(404);
  });

  it("filters SIMUSR0142's tasks to Jan 19, newest first", async () => {
    const page = await get<TaskPage>('/api/tasks', {
      partnerId: 'SIMUSR0142',
      date: '2027-01-19',
    });
    expect(page.items.map((t) => t.taskId)).toEqual([48213, 48209, 48196, 48152, 48147]);
    const above = await get<TaskPage>('/api/tasks', {
      partnerId: 'SIMUSR0142',
      date: '2027-01-19',
      aboveP90: 'true',
    });
    expect(above.items.map((t) => t.taskId)).toEqual([48213, 48196]);
  });

  it('pages the task list', async () => {
    const page = await get<TaskPage>('/api/tasks', { page: '1', size: '25' });
    expect(page.page).toMatchObject({ number: 1, size: 25 });
    expect(page.page.totalElements).toBeGreaterThanOrEqual(45);
    expect(page.items).toHaveLength(25);
  });

  it('serves task 48213 with its four moves, and 404 for an unknown task', async () => {
    const task = await get<TaskDetail>('/api/tasks/48213');
    expect(task.moves.map((m) => m.role)).toEqual(['DISCARDED_START', 'START', 'ACTION', 'END']);
    expect(await status('/api/tasks/1')).toBe(404);
  });

  it('rejects an invalid filter with 400', async () => {
    expect(await status('/api/tasks?zone=FROZEN')).toBe(400);
  });

  it('answers ?mock=empty with empty lists and ?mock=error with 500, but never for meta', async () => {
    history.replaceState(null, '', '/?mock=empty');
    expect((await get<TaskPage>('/api/tasks')).items).toEqual([]);
    history.replaceState(null, '', '/?mock=error');
    expect(await status('/api/analytics/summary')).toBe(500);
    expect(await status('/api/meta')).toBe(200);
  });
});
