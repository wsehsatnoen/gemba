import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import type { Meta, Problem } from './core/api/types';
import { MetaService } from './core/meta.service';

describe('App', () => {
  const meta = signal<Meta | null>(null);
  const error = signal<Problem | null>(null);
  const load = vi.fn();

  beforeEach(() => {
    meta.set(null);
    error.set(null);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: MetaService, useValue: { meta, error, load } }],
    });
  });

  it('shows the top bar and the synthetic data badge', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.wordmark')?.textContent).toBe('gemba');
    expect(el.textContent).toContain('Synthetic data');
  });

  it('shows an error with a retry when /api/meta failed', async () => {
    error.set({ type: 'about:blank', title: 'Down', status: 503 });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('g-state')?.textContent).toContain('Down');
    el.querySelector<HTMLButtonElement>('g-state button')?.click();
    expect(load).toHaveBeenCalled();
  });

  it('moves focus to the main region from the skip link', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.skip-link')?.click();
    expect(document.activeElement).toBe(el.querySelector('main'));
  });
});
