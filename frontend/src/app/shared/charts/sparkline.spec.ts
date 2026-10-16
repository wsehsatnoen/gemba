import { TestBed } from '@angular/core/testing';
import { formatDuration } from '../../core/format/format';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  async function render(points: number[], extra: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(Sparkline);
    fixture.componentRef.setInput('points', points);
    fixture.componentRef.setInput('label', 'Daily median, Ambient cycle count');
    for (const [name, value] of Object.entries(extra)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('is an image named by its label', async () => {
    const el = await render([48_000, 50_000, 46_000]);
    const svg = el.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Daily median, Ambient cycle count');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 640 32');
  });

  it('draws one line through the points with a dot on the last one', async () => {
    const el = await render([48_000, 50_000, 46_000]);
    const d = el.querySelector('path.line')?.getAttribute('d') ?? '';
    expect(d.match(/[ML]/g)).toEqual(['M', 'L', 'L']);
    // The highest value sits at the top pad, the lowest at the bottom pad.
    expect(d).toBe('M4 16 L320 4 L636 28');
    const end = el.querySelector('circle.end');
    expect(end?.getAttribute('cx')).toBe('636');
    expect(end?.getAttribute('cy')).toBe('28');
  });

  it('lists the formatted values in a hidden table', async () => {
    const el = await render([48_000, 50_000], {
      format: formatDuration,
      pointLabels: ['Jan 4', 'Jan 5'],
    });
    const table = el.querySelector('.visually-hidden table');
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'Daily median, Ambient cycle count',
    );
    const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
      [...tr.children].map((cell) => cell.textContent).join(' '),
    );
    expect(rows).toEqual(['Jan 4 0:48', 'Jan 5 0:50']);
  });

  it('numbers the rows when there are no point labels', async () => {
    const el = await render([1, 2]);
    expect(el.querySelector('tbody th')?.textContent).toBe('1');
  });

  it('draws nothing for an empty series', async () => {
    const el = await render([]);
    expect(el.querySelector('path.line')?.getAttribute('d')).toBe('');
    expect(el.querySelector('circle.end')).toBeNull();
  });
});
