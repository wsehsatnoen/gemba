// Interface checks for the Phase 1 stubs. Agent A replaces these with real tests.
import { TestBed } from '@angular/core/testing';
import { PacePill } from './pace-pill';
import { StatCard } from './stat-card';
import { State } from './state';

describe('UI stubs', () => {
  it('stat card takes label, value, and sub', async () => {
    const fixture = TestBed.createComponent(StatCard);
    fixture.componentRef.setInput('label', 'Tasks paired');
    fixture.componentRef.setInput('value', '31,292');
    fixture.componentRef.setInput('sub', 'from 80,000 rows');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('31,292');
  });

  it('pace pill shows the percent, or "Too few"', async () => {
    const fixture = TestBed.createComponent(PacePill);
    fixture.componentRef.setInput('pacePct', 105.9);
    fixture.componentRef.setInput('comparison', 'FASTER');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('106%');
    fixture.componentRef.setInput('pacePct', null);
    fixture.componentRef.setInput('comparison', 'INSUFFICIENT_SAMPLE');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Too few');
  });

  it('state shows the problem and emits retry', async () => {
    const fixture = TestBed.createComponent(State);
    fixture.componentRef.setInput('status', 'error');
    fixture.componentRef.setInput('problem', { type: 'about:blank', title: 'Oops', status: 500 });
    let retried = false;
    fixture.componentInstance.retry.subscribe(() => (retried = true));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Oops');
    fixture.nativeElement.querySelector('button').click();
    expect(retried).toBe(true);
  });
});
