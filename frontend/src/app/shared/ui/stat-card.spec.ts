import { TestBed } from '@angular/core/testing';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('shows the label, the value, and the sub line', async () => {
    const fixture = TestBed.createComponent(StatCard);
    fixture.componentRef.setInput('label', 'Tasks paired');
    fixture.componentRef.setInput('value', '31,292');
    fixture.componentRef.setInput('sub', 'from 80,000 rows');
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.label')?.textContent).toBe('Tasks paired');
    expect(el.querySelector('.value')?.textContent).toBe('31,292');
    expect(el.querySelector('.sub')?.textContent).toBe('from 80,000 rows');
  });

  it('leaves out the sub line when there is none', async () => {
    const fixture = TestBed.createComponent(StatCard);
    fixture.componentRef.setInput('label', 'Tasks per day');
    fixture.componentRef.setInput('value', '1,118');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.sub')).toBeNull();
  });
});
