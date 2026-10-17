// Formatting for every figure and date on screen. Rule 1: this folder and the chart
// scales are the only places allowed to do arithmetic on values from the API, and
// the arithmetic here is presentation only (unit conversion, rounding, separators).

const LOCALE = 'en-US';
const MISSING = '—';

/** Milliseconds to `m:ss` under an hour and `h:mm:ss` from an hour up, rounded to the second. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return MISSING;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = pad2(seconds);
  return hours > 0 ? `${hours}:${pad2(minutes)}:${ss}` : `${minutes}:${ss}`;
}

/** Pace as a whole percent: 105.9 → "106%". */
export function formatPace(pacePct: number | null | undefined): string {
  if (pacePct == null) return MISSING;
  return `${Math.round(pacePct)}%`;
}

const countFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const hoursFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Whole number with thousands separators: 1117.6 → "1,118". */
export function formatCount(value: number | null | undefined): string {
  return value == null ? MISSING : countFormat.format(value);
}

/** Hours with one decimal: 58.4 → "58.4". */
export function formatHours(value: number | null | undefined): string {
  return value == null ? MISSING : hoursFormat.format(value);
}

export type DateStyle = 'weekday' | 'short';

/**
 * A facility date. Accepts a `YYYY-MM-DD` date (already a facility date, so no time zone
 * conversion) or an ISO timestamp (converted to `timeZone`).
 * 'weekday' → "Tue, Jan 19"; 'short' → "Jan 19".
 */
export function formatFacilityDate(
  value: string | null | undefined,
  timeZone: string,
  style: DateStyle = 'weekday',
): string {
  if (!value) return MISSING;
  const options: Intl.DateTimeFormatOptions =
    style === 'weekday'
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric' };
  const { date, zone } = toInstant(value, timeZone);
  return formatter({ ...options, timeZone: zone }).format(date);
}

export type TimeStyle = 'minutes' | 'millis';

/** A timestamp's time in the facility zone. 'minutes' → "18:41"; 'millis' → "18:41:55.918". */
export function formatFacilityTime(
  value: string | null | undefined,
  timeZone: string,
  style: TimeStyle = 'minutes',
): string {
  if (!value) return MISSING;
  const parts = formatter({
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const hm = `${part('hour')}:${part('minute')}`;
  return style === 'minutes' ? hm : `${hm}:${part('second')}.${part('fractionalSecond')}`;
}

/** An inclusive range of `YYYY-MM-DD` facility dates: "Jan 4–31, 2027". */
export function formatDateRange(from: string, to: string): string {
  const [fy, fm, fd] = splitDate(from);
  const [ty, tm, td] = splitDate(to);
  const month = (m: number) =>
    formatter({ month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 1)));

  if (from === to) return `${month(fm)} ${fd}, ${fy}`;
  if (fy === ty && fm === tm) return `${month(fm)} ${fd}–${td}, ${fy}`;
  if (fy === ty) return `${month(fm)} ${fd} – ${month(tm)} ${td}, ${fy}`;
  return `${month(fm)} ${fd}, ${fy} – ${month(tm)} ${td}, ${ty}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

function toInstant(value: string, timeZone: string): { date: Date; zone: string } {
  if (isDateOnly(value)) {
    const [y, m, d] = splitDate(value);
    // A calendar date: format it in UTC so the viewer's zone can't shift the day.
    return { date: new Date(Date.UTC(y, m - 1, d, 12)), zone: 'UTC' };
  }
  return { date: new Date(value), zone: timeZone };
}

function splitDate(value: string): [number, number, number] {
  const [y, m, d] = value.split('-').map(Number);
  return [y, m, d];
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// Intl formatters are slow to create, so reuse them.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, options);
    formatters.set(key, f);
  }
  return f;
}
