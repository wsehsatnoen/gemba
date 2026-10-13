import { TestBed } from '@angular/core/testing';
import { formatCount } from '../../core/format/format';
import { BarChart } from './bar-chart';
import type { BarDatum } from './chart-types';

const WEEKDAYS: BarDatum[] = [
  { label: 'Mon', value: 1243 },
  { label: 'Tue', value: 1183 },
  { label: 'Sat', value: 981 },
];

describe('BarChart', () => {
  async function render(bars: BarDatum[]) {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('bars', bars);
    fixture.componentRef.setInput('format', formatCount);
    fixture.componentRef.setInput('label', 'Average tasks per operating day');
    fixture.componentRef.setInput('headers', ['Day', 'Tasks']);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('is an image named by its label', async () => {
    const el = await render(WEEKDAYS);
    const svg = el.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Average tasks per operating day');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 640 220');
  });

  it('draws one bar per datum with its formatted value and label', async () => {
    const el = await render(WEEKDAYS);
    expect(el.querySelectorAll('path.bar').length).toBe(3);
    const values = [...el.querySelectorAll('text.value')].map((t) => t.textContent?.trim());
    const labels = [...el.querySelectorAll('text.category')].map((t) => t.textContent?.trim());
    expect(values).toEqual(['1,243', '1,183', '981']);
    expect(labels).toEqual(['Mon', 'Tue', 'Sat']);
  });

  it('scales bars from zero, so the tallest reaches the top margin', async () => {
    const el = await render(WEEKDAYS);
    const tops = [...el.querySelectorAll('text.value')].map((t) => Number(t.getAttribute('y')));
    // The value label sits 6 px above the bar top; the tallest bar's top is at 22.
    expect(tops[0]).toBe(16);
    expect(tops[2]).toBeGreaterThan(tops[1]);
  });

  it('keeps every bar flat when all values are zero', async () => {
    const el = await render([{ label: 'Mon', value: 0 }]);
    expect(el.querySelector('path.bar')?.getAttribute('d')).toBe('');
    expect(el.querySelector('text.value')?.textContent?.trim()).toBe('0');
  });

  it('lists the formatted values in a hidden table with the given headers', async () => {
    const el = await render(WEEKDAYS);
    const table = el.querySelector('table.visually-hidden');
    const headers = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent);
    expect(headers).toEqual(['Day', 'Tasks']);
    const cells = [...(table?.querySelectorAll('tbody tr:first-child > *') ?? [])];
    const first = cells.map((cell) => cell.textContent).join(' ');
    expect(first).toBe('Mon 1,243');
  });
});
