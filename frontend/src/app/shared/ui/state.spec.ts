import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Problem } from '../../core/api/types';
import { State, type StateStatus } from './state';

@Component({
  imports: [State],
  template: `
    <g-state [status]="status()" [problem]="problem()" (retry)="retries = retries + 1">
      <p class="empty-message">No tasks match these filters.</p>
    </g-state>
  `,
})
class Host {
  readonly status = signal<StateStatus>('loading');
  readonly problem = signal<Problem | null>(null);
  retries = 0;
}

async function render(status: StateStatus, problem: Problem | null = null) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.status.set(status);
  fixture.componentInstance.problem.set(problem);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('State', () => {
  it('shows a skeleton in a status region while loading', async () => {
    const { el } = await render('loading');
    const region = el.querySelector('[role="status"]');
    expect(region?.textContent).toContain('Loading');
    expect(region?.querySelector('.skeleton')).not.toBeNull();
    expect(el.querySelector('.empty-message')).toBeNull();
  });

  it('shows the projected content when empty', async () => {
    const { el } = await render('empty');
    expect(el.querySelector('[role="status"] .empty-message')?.textContent).toBe(
      'No tasks match these filters.',
    );
    expect(el.querySelector('.skeleton')).toBeNull();
  });

  it('shows the problem title and detail as an alert, and emits retry', async () => {
    const { fixture, el } = await render('error', {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'The analytics query failed.',
    });
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Internal Server Error');
    expect(alert?.textContent).toContain('The analytics query failed.');
    expect(el.querySelector('.empty-message')).toBeNull();

    const button = alert?.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Try again');
    button.click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('falls back to a generic title when there is no problem', async () => {
    const { el } = await render('error');
    expect(el.querySelector('[role="alert"] .title')?.textContent).toBe('Something went wrong');
  });
});
