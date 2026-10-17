import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MetaService } from '../meta.service';
import {
  CountPipe,
  DateRangePipe,
  DurationPipe,
  FacilityDatePipe,
  FacilityTimePipe,
  HoursPipe,
  PacePipe,
} from './pipes';

describe('format pipes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MetaService, useValue: { timeZone: signal('America/Chicago') } }],
    });
  });

  it('delegate to the format functions', () => {
    expect(new DurationPipe().transform(220853)).toBe('3:41');
    expect(new PacePipe().transform(105.9)).toBe('106%');
    expect(new CountPipe().transform(31292)).toBe('31,292');
    expect(new HoursPipe().transform(58.4)).toBe('58.4');
    expect(new DateRangePipe().transform('2027-01-04', '2027-01-31')).toBe('Jan 4–31, 2027');
  });

  it('use the facility time zone from MetaService', () => {
    const date = TestBed.runInInjectionContext(() => new FacilityDatePipe());
    const time = TestBed.runInInjectionContext(() => new FacilityTimePipe());
    expect(date.transform('2027-01-20T01:00:00Z')).toBe('Tue, Jan 19');
    expect(date.transform('2027-01-19', 'short')).toBe('Jan 19');
    expect(time.transform('2027-01-20T00:41:55.918Z', 'millis')).toBe('18:41:55.918');
  });
});
