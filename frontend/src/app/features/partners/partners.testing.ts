// Test setup shared by the partner specs. Not part of the app bundle.
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component, signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { mockApiInterceptor } from '../../../mocks/mock-api.interceptor';
import type { Meta } from '../../core/api/types';
import { MetaService } from '../../core/meta.service';
import { Viewport } from '../../core/viewport';

export const TEST_META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

@Component({ template: '' })
class Blank {}

/**
 * Configures TestBed to answer `/api/*` from the mock fixtures, with the page under test at
 * `path`, and returns a function that opens a URL in a router harness.
 */
export function setUpPartnerPage(path: string, page: Type<unknown>, isDesktop = signal(true)) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([mockApiInterceptor])),
      provideRouter(
        [
          { path, component: page },
          { path: '**', component: Blank },
        ],
        withComponentInputBinding(),
      ),
      {
        provide: MetaService,
        useValue: {
          meta: signal(TEST_META),
          timeZone: signal(TEST_META.facilityTimeZone),
          require: () => TEST_META,
        },
      },
      { provide: Viewport, useValue: { isDesktop } },
    ],
  });

  return async (url: string) => {
    const harness = await RouterTestingHarness.create(url);
    const router = TestBed.inject(Router);
    /** Lets the mock responses arrive and the view update. */
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve));
        await harness.fixture.whenStable();
      }
    };
    await settle();
    return { harness, router, el: harness.routeNativeElement as HTMLElement, settle };
  };
}
