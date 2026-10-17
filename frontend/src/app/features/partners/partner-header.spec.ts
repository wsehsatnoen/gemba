import { TestBed } from '@angular/core/testing';
import type { PartnerSummary } from '../../core/api/types';
import { PartnerHeader } from './partner-header';

const SUMMARY: PartnerSummary = {
  partnerId: 'SIMUSR0142',
  taskCount: 1612,
  daysWorked: 18,
  pacePct: 105.9,
  comparison: 'FASTER',
  medianGapMs: 21000,
  facilityMedianGapMs: 19000,
};

describe('PartnerHeader', () => {
  async function create(summary?: PartnerSummary) {
    const fixture = TestBed.createComponent(PartnerHeader);
    fixture.componentRef.setInput('partnerId', 'SIMUSR0142');
    fixture.componentRef.setInput('summary', summary);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the ID, formatted figures, and the pace colored by comparison', async () => {
    const el = await create(SUMMARY);
    expect(el.querySelector('h1')?.textContent).toBe('SIMUSR0142');
    expect(el.querySelector('.stats')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '1,612 tasks · 18 days worked · median gap between tasks 0:21 (facility 0:19)',
    );
    const pace = el.querySelector('.pace-value')!;
    expect(pace.textContent?.trim()).toBe('106%');
    expect(pace.classList).toContain('tone-faster');
    expect(el.textContent).toContain('pace vs facility');
  });

  it('uses amber for slower, gray for similar, and "Too few" for a small sample', async () => {
    let el = await create({ ...SUMMARY, pacePct: 92, comparison: 'SLOWER' });
    expect(el.querySelector('.pace-value')!.classList).toContain('tone-slower');

    el = await create({ ...SUMMARY, pacePct: 101, comparison: 'SIMILAR' });
    expect(el.querySelector('.pace-value')!.classList).toContain('tone-neutral');

    el = await create({
      ...SUMMARY,
      pacePct: null,
      medianGapMs: null,
      comparison: 'INSUFFICIENT_SAMPLE',
    });
    expect(el.querySelector('.pace-value')!.textContent?.trim()).toBe('Too few');
    expect(el.querySelector('.pace-value')!.classList).toContain('tone-neutral');
    expect(el.querySelector('.stats')?.textContent).toContain('median gap between tasks —');
  });

  it('shows skeletons while the summary loads', async () => {
    const el = await create(undefined);
    expect(el.querySelector('h1')?.textContent).toBe('SIMUSR0142');
    expect(el.querySelectorAll('.skeleton').length).toBe(2);
  });
});
