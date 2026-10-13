import {
  formatCount,
  formatDateRange,
  formatDuration,
  formatFacilityDate,
  formatFacilityTime,
  formatHours,
  formatPace,
} from './format';

const CHICAGO = 'America/Chicago';

describe('formatDuration', () => {
  it('shows m:ss under an hour, rounded to the second', () => {
    expect(formatDuration(220853)).toBe('3:41');
    expect(formatDuration(48000)).toBe('0:48');
    expect(formatDuration(52499)).toBe('0:52');
    expect(formatDuration(52500)).toBe('0:53');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('shows h:mm:ss from an hour up', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_725_400)).toBe('1:02:05');
  });

  it('rounds 59:59.6 up to an hour', () => {
    expect(formatDuration(3_599_600)).toBe('1:00:00');
  });

  it('shows a dash for a missing value', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('formatPace', () => {
  it('shows a whole percent', () => {
    expect(formatPace(105.9)).toBe('106%');
    expect(formatPace(94.8)).toBe('95%');
    expect(formatPace(100)).toBe('100%');
  });

  it('shows a dash for a missing value', () => {
    expect(formatPace(null)).toBe('—');
  });
});

describe('formatCount and formatHours', () => {
  it('formats counts as whole numbers with separators', () => {
    expect(formatCount(31292)).toBe('31,292');
    expect(formatCount(1117.6)).toBe('1,118');
    expect(formatCount(null)).toBe('—');
  });

  it('formats hours with one decimal', () => {
    expect(formatHours(58.4)).toBe('58.4');
    expect(formatHours(65)).toBe('65.0');
  });
});

describe('formatFacilityDate', () => {
  it('formats a calendar date without shifting the day', () => {
    expect(formatFacilityDate('2027-01-19', CHICAGO)).toBe('Tue, Jan 19');
    expect(formatFacilityDate('2027-01-19', 'Pacific/Kiritimati')).toBe('Tue, Jan 19');
    expect(formatFacilityDate('2027-01-19', CHICAGO, 'short')).toBe('Jan 19');
  });

  it('formats a timestamp in the facility zone, not the viewer zone', () => {
    // 01:00 UTC on Jan 20 is still Jan 19 in Chicago.
    expect(formatFacilityDate('2027-01-20T01:00:00Z', CHICAGO)).toBe('Tue, Jan 19');
  });
});

describe('formatFacilityTime', () => {
  it('shows list times as HH:mm and move times with milliseconds', () => {
    const ts = '2027-01-19T18:41:55.918-06:00';
    expect(formatFacilityTime(ts, CHICAGO)).toBe('18:41');
    expect(formatFacilityTime(ts, CHICAGO, 'millis')).toBe('18:41:55.918');
  });

  it('converts to the facility zone', () => {
    expect(formatFacilityTime('2027-01-20T00:41:55.918Z', CHICAGO, 'millis')).toBe('18:41:55.918');
  });

  it('uses a 24-hour clock with a leading zero', () => {
    expect(formatFacilityTime('2027-01-19T06:05:00.000-06:00', CHICAGO)).toBe('06:05');
    expect(formatFacilityTime('2027-01-19T00:05:00.000-06:00', CHICAGO)).toBe('00:05');
  });
});

describe('formatDateRange', () => {
  it('collapses a range within one month', () => {
    expect(formatDateRange('2027-01-04', '2027-01-31')).toBe('Jan 4–31, 2027');
  });

  it('handles one day, two months, and two years', () => {
    expect(formatDateRange('2027-01-19', '2027-01-19')).toBe('Jan 19, 2027');
    expect(formatDateRange('2027-01-28', '2027-02-03')).toBe('Jan 28 – Feb 3, 2027');
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
});
