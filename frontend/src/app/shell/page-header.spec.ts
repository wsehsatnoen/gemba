import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Meta } from '../core/api/types';
import { MetaService } from '../core/meta.service';
import { PageHeader } from './page-header';

const META = { dataFrom: '2027-01-04', dataTo: '2027-01-31' } as Meta;

@Component({
  imports: [PageHeader],
  template: `<g-page-header heading="Overview"><p>Description</p></g-page-header>`,
})
class Host {}

describe('PageHeader', () => {
  it('shows the heading, the filter bar, and the description', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: Host }]),
        { provide: MetaService, useValue: { meta: signal(META), require: () => META } },
      ],
    });
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Overview');
    expect(el.querySelector('g-filter-bar')).not.toBeNull();
    expect(el.querySelector('.description')?.textContent).toBe('Description');
  });
});
