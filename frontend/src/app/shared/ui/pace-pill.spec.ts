import { TestBed } from '@angular/core/testing';
import type { Comparison } from '../../core/api/types';
import { PacePill } from './pace-pill';

async function render(pacePct: number | null, comparison: Comparison) {
  const fixture = TestBed.createComponent(PacePill);
  fixture.componentRef.setInput('pacePct', pacePct);
  fixture.componentRef.setInput('comparison', comparison);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('PacePill', () => {
  it('shows a faster pace as a green percent, and says "faster" to screen readers', async () => {
    const el = await render(105.9, 'FASTER');
    expect(el.classList).toContain('faster');
    expect(el.textContent?.replace(/\s+/g, ' ').trim()).toBe('106% , faster');
    expect(el.querySelector('.visually-hidden')?.textContent).toBe(', faster');
  });

  it('shows a slower pace in amber', async () => {
    const el = await render(94.8, 'SLOWER');
    expect(el.classList).toContain('slower');
    expect(el.classList).not.toContain('faster');
    expect(el.textContent).toContain('95%');
    expect(el.textContent).toContain('slower');
  });

  it('shows a similar pace in neutral gray', async () => {
    const el = await render(100.4, 'SIMILAR');
    expect(el.classList).toContain('neutral');
    expect(el.textContent).toContain('100%');
    expect(el.textContent).toContain('similar');
  });

  it('shows "Too few" in gray for an insufficient sample, with no extra text', async () => {
    const el = await render(null, 'INSUFFICIENT_SAMPLE');
    expect(el.classList).toContain('neutral');
    expect(el.textContent?.trim()).toBe('Too few');
    expect(el.querySelector('.visually-hidden')).toBeNull();
  });
});
