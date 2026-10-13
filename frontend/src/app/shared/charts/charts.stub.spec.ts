// Interface checks for the Phase 1 stubs. Agent A replaces these with real tests.
import { TestBed } from '@angular/core/testing';
import { BarChart } from './bar-chart';
import { LineChart } from './line-chart';
import { Sparkline } from './sparkline';

describe('chart stubs', () => {
  it('sparkline takes points and a label', async () => {
    const fixture = TestBed.createComponent(Sparkline);
    fixture.componentRef.setInput('points', [1, 2, 3]);
    fixture.componentRef.setInput('label', 'Daily median');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('3 points');
  });

  it('bar chart takes bars, a format, and a label', async () => {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('bars', [{ label: 'Mon', value: 1243 }]);
    fixture.componentRef.setInput('format', (v: number) => `${v}!`);
    fixture.componentRef.setInput('label', 'By day of week');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Mon 1243!');
  });

  it('line chart takes points and a reference and emits pointSelect', async () => {
    const fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('points', [
      { id: '2027-01-19', label: 'Jan 19', value: 81, comparison: 'SLOWER' },
    ]);
    fixture.componentRef.setInput('reference', 100);
    fixture.componentRef.setInput('label', 'Daily pace');
    const selected: string[] = [];
    fixture.componentInstance.pointSelect.subscribe((id) => selected.push(id));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    expect(selected).toEqual(['2027-01-19']);
  });
});
