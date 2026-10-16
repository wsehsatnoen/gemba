import { By } from '@angular/platform-browser';
import { LineChart } from '../../shared/charts/line-chart';
import { TaskPanel } from '../tasks/task-panel';
import { TaskTable } from '../tasks/task-table';
import { PartnerDetailPage } from './partner-detail-page';
import { setUpPartnerPage } from './partners.testing';

// The chart, task table, and task panel are used through their inputs and outputs only,
// so these tests hold whatever those components render.
describe('PartnerDetailPage', () => {
  let open: ReturnType<typeof setUpPartnerPage>;

  beforeEach(() => {
    open = setUpPartnerPage('partners/:partnerId', PartnerDetailPage);
  });

  async function openPartner(url: string) {
    const page = await open(url);
    const child = <T>(type: new (...args: never[]) => T) =>
      page.harness.fixture.debugElement.query(By.directive(type))?.componentInstance as
        T | undefined;
    const text = () => page.el.textContent!.replace(/\s+/g, ' ');
    return { ...page, child, text };
  }

  it('shows the header, the tiles, and the legend', async () => {
    const { el, text } = await openPartner('/partners/SIMUSR0142');
    expect(el.querySelector('h1')?.textContent).toBe('SIMUSR0142');
    expect(text()).toContain(
      '612 tasks · 18 days worked · median gap between tasks 0:21 (facility 0:19)',
    );
    expect(el.querySelector('.pace-value')?.textContent?.trim()).toBe('106%');
    const tiles = [...el.querySelectorAll('g-comparison-tiles li')].map((li) => li.textContent);
    expect(tiles.length).toBe(4);
    expect(tiles[3]).toContain('Needs 20 tasks');
    expect(text()).toContain('gray under 20 tasks.');
  });

  it('draws the daily pace with the facility reference and the selected day', async () => {
    const { child } = await openPartner('/partners/SIMUSR0142?day=2027-01-19');
    const chart = child(LineChart)!;
    expect(chart.label()).toBe('Daily pace for SIMUSR0142');
    expect(chart.reference()).toBe(100);
    expect(chart.selectedId()).toBe('2027-01-19');
    expect(chart.format()(81.2)).toBe('81%');
    const points = chart.points();
    expect(points.length).toBe(18);
    expect(points.find((p) => p.id === '2027-01-19')).toEqual({
      id: '2027-01-19',
      label: 'Jan 19',
      value: 81,
      comparison: 'SLOWER',
    });
  });

  it('selecting a point filters the tasks to that day, and the chip removes it', async () => {
    const { el, child, router, settle, text } = await openPartner(
      '/partners/SIMUSR0142?zone=CHILLED&page=2',
    );
    expect(child(TaskTable)!.query()).toEqual({
      from: '2027-01-04',
      to: '2027-01-31',
      zone: 'CHILLED',
      partnerId: 'SIMUSR0142',
      date: undefined,
      page: 2,
      sort: 'startedAt,desc',
    });

    child(LineChart)!.pointSelect.emit('2027-01-19');
    await settle();
    expect(router.url).toBe('/partners/SIMUSR0142?zone=CHILLED&day=2027-01-19');
    expect(child(TaskTable)!.query()).toMatchObject({ date: '2027-01-19', page: 0 });
    expect(text()).toContain('2 above P90');

    const chip = el.querySelector<HTMLButtonElement>('[aria-label="Remove day filter Jan 19"]')!;
    expect(chip.textContent).toContain('Jan 19');
    chip.click();
    await settle();
    expect(router.url).toBe('/partners/SIMUSR0142?zone=CHILLED');
    expect(text()).not.toContain('above P90');
  });

  it('opens the task panel from the table and closes it', async () => {
    const { harness, child, router, settle } = await openPartner('/partners/SIMUSR0142');
    expect(child(TaskPanel)).toBeUndefined();

    child(TaskTable)!.taskSelect.emit(48213);
    await settle();
    expect(router.url).toBe('/partners/SIMUSR0142?task=48213');
    expect(child(TaskTable)!.selectedTaskId()).toBe(48213);
    expect(child(TaskPanel)!.taskId()).toBe(48213);
    expect((harness.routeNativeElement as HTMLElement).classList).toContain('with-panel');

    child(TaskPanel)!.closed.emit();
    await settle();
    expect(router.url).toBe('/partners/SIMUSR0142');
    expect(child(TaskPanel)).toBeUndefined();
  });

  it('says so when the partner does not exist, with a link back', async () => {
    const { el, child, text } = await openPartner('/partners/SIMUSR9999?zone=AMBIENT&task=1');
    expect(el.querySelector('h1')?.textContent).toBe("We couldn't find partner SIMUSR9999.");
    expect(el.querySelector('a[href="/partners?zone=AMBIENT"]')?.textContent).toBe(
      'Back to partners',
    );
    expect(child(LineChart)).toBeUndefined();
    expect(child(TaskPanel)).toBeUndefined();
    expect(text()).not.toContain('pace vs facility');
  });

  it('a search goes back to the list with the filters kept', async () => {
    const { el, router, settle } = await openPartner('/partners/SIMUSR0142?zone=AMBIENT');
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = '0207';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(router.url).toBe('/partners?zone=AMBIENT&q=0207');
  });
});
