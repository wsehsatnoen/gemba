import { TestBed } from '@angular/core/testing';
import { formatPace } from '../../core/format/format';
import { FACILITY_PACE_PCT } from '../../core/pace';
import type { LinePoint } from './chart-types';
import { LineChart } from './line-chart';

const DAYS: LinePoint[] = [
  { id: '2027-01-18', label: 'Jan 18', value: 102, comparison: 'SIMILAR' },
  { id: '2027-01-19', label: 'Jan 19', value: 81, comparison: 'SLOWER' },
  { id: '2027-01-20', label: 'Jan 20', value: null, comparison: 'INSUFFICIENT_SAMPLE' },
  { id: '2027-01-21', label: 'Jan 21', value: 105, comparison: 'SIMILAR' },
  { id: '2027-01-25', label: 'Jan 25', value: 111, comparison: 'FASTER' },
];

async function render(selectedId: string | null = null) {
  const fixture = TestBed.createComponent(LineChart);
  fixture.componentRef.setInput('points', DAYS);
  fixture.componentRef.setInput('reference', FACILITY_PACE_PCT);
  fixture.componentRef.setInput('selectedId', selectedId);
  fixture.componentRef.setInput('format', formatPace);
  fixture.componentRef.setInput('label', 'Daily pace for SIMUSR0142');
  fixture.componentRef.setInput('headers', ['Day', 'Pace']);
  const selected: string[] = [];
  fixture.componentInstance.pointSelect.subscribe((id) => selected.push(id));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const points = () => [...el.querySelectorAll<SVGGElement>('g.point')];
  return { fixture, el, points, selected };
}

function key(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('LineChart', () => {
  it('is a group named by its label', async () => {
    const { el } = await render();
    const svg = el.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('group');
    expect(svg?.getAttribute('aria-label')).toBe('Daily pace for SIMUSR0142');
  });

  it('draws a point per value and leaves a gap for null', async () => {
    const { el, points } = await render();
    expect(points().length).toBe(4);
    expect(points().map((p) => p.getAttribute('aria-label'))).toEqual([
      'Jan 18, 102%, Similar',
      'Jan 19, 81%, Slower',
      'Jan 21, 105%, Similar',
      'Jan 25, 111%, Faster',
    ]);
    // Two runs: Jan 18–19, then Jan 21–25.
    const d = el.querySelector('path.line')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)?.length).toBe(2);
  });

  it('colors points by comparison', async () => {
    const { points } = await render();
    expect(points().map((p) => p.classList.contains('neutral'))).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(points()[1].classList).toContain('slower');
    expect(points()[3].classList).toContain('faster');
    expect(points()[0].classList).toContain('point');
  });

  it('draws a dashed reference line labeled with the formatted value', async () => {
    const { el } = await render();
    expect(el.querySelector('line.reference')).not.toBeNull();
    expect(el.querySelector('text.reference-label')?.textContent?.trim()).toBe('100%');
  });

  it('draws no reference line without a reference', async () => {
    const { fixture, el } = await render();
    fixture.componentRef.setInput('reference', null);
    await fixture.whenStable();
    expect(el.querySelector('line.reference')).toBeNull();
  });

  it('emits pointSelect with the id on click, Enter, and Space', async () => {
    const { points, selected } = await render();
    points()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    key(points()[0], 'Enter');
    key(points()[3], ' ');
    expect(selected).toEqual(['2027-01-19', '2027-01-18', '2027-01-25']);
  });

  it('puts one point in the tab order and moves focus with the arrow keys', async () => {
    const { fixture, points } = await render();
    expect(points().map((p) => p.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);

    key(points()[0], 'ArrowRight');
    await fixture.whenStable();
    expect(document.activeElement).toBe(points()[1]);
    expect(points()[1].getAttribute('tabindex')).toBe('0');

    key(points()[1], 'End');
    await fixture.whenStable();
    expect(document.activeElement).toBe(points()[3]);

    key(points()[3], 'Home');
    await fixture.whenStable();
    expect(document.activeElement).toBe(points()[0]);
  });

  it('marks the selected point with a ring, a label, and aria-pressed', async () => {
    const { el, points } = await render('2027-01-19');
    const selected = points()[1];
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.getAttribute('tabindex')).toBe('0');
    expect(selected.querySelector('circle.selected-ring')).not.toBeNull();
    expect(points()[0].getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('text.annotation.selected')?.textContent?.trim()).toBe('Jan 19 · 81%');
  });

  it('lists every day in a hidden table, with a dash for no value', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('.visually-hidden table tbody tr')].map((tr) =>
      [...tr.children].map((cell) => cell.textContent).join(' | '),
    );
    expect(rows).toEqual([
      'Jan 18 | 102% | Similar',
      'Jan 19 | 81% | Slower',
      'Jan 20 | — | Too few',
      'Jan 21 | 105% | Similar',
      'Jan 25 | 111% | Faster',
    ]);
  });
});
