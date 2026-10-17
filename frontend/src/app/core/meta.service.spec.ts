import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Meta } from './api/types';
import { MetaService } from './meta.service';

const META: Meta = {
  datasetLabel: 'Synthetic data',
  dataFrom: '2027-01-04',
  dataTo: '2027-01-31',
  facilityTimeZone: 'America/Chicago',
  minSampleSize: 20,
};

describe('MetaService', () => {
  let service: MetaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MetaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads /api/meta and exposes the facility time zone', async () => {
    expect(service.timeZone()).toBe('UTC');
    const loading = service.load();
    http.expectOne('/api/meta').flush(META);
    await loading;
    expect(service.meta()).toEqual(META);
    expect(service.require()).toEqual(META);
    expect(service.timeZone()).toBe('America/Chicago');
    expect(service.error()).toBeNull();
  });

  it('keeps the Problem Details when loading fails, and can retry', async () => {
    let loading = service.load();
    http
      .expectOne('/api/meta')
      .flush(
        { type: 'about:blank', title: 'Down for maintenance', status: 503 },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await loading;
    expect(service.meta()).toBeNull();
    expect(service.error()?.title).toBe('Down for maintenance');
    expect(() => service.require()).toThrow();

    loading = service.load();
    http.expectOne('/api/meta').flush(META);
    await loading;
    expect(service.error()).toBeNull();
    expect(service.meta()).toEqual(META);
  });
});
