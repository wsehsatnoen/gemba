import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Component, signal } from '@angular/core';
import { MetaService } from '../core/meta.service';
import { TopBar } from './top-bar';

@Component({ imports: [TopBar], template: '<g-top-bar />' })
class Host {}

describe('TopBar', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Host },
          { path: 'partners', component: Host },
        ]),
        { provide: MetaService, useValue: { meta: signal(null) } },
      ],
    });
  });

  it('links to each page, keeping the filters, and marks the current one', async () => {
    const harness = await RouterTestingHarness.create('/partners?zone=CHILLED&page=3');
    const el = harness.routeNativeElement as HTMLElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Overview', 'Partners', 'Tasks']);
    expect(links[2].getAttribute('href')).toBe('/tasks?zone=CHILLED');
    expect(links[1].getAttribute('aria-current')).toBe('page');
    expect(links[0].getAttribute('aria-current')).toBeNull();
  });

  it('shows the badge and the outside links from the environment', async () => {
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('.badge')?.textContent).toBe('Synthetic data');
    const outside = Array.from(el.querySelectorAll<HTMLAnchorElement>('.outside'));
    expect(outside.map((a) => a.getAttribute('href'))).toEqual([
      '/api/docs',
      'https://github.com/wsehsatnoen/gemba',
    ]);
  });
});
