import { inject, Pipe, PipeTransform } from '@angular/core';
import { MetaService } from '../meta.service';
import {
  DateStyle,
  formatCount,
  formatDateRange,
  formatDuration,
  formatFacilityDate,
  formatFacilityTime,
  formatHours,
  formatPace,
  TimeStyle,
} from './format';

/** `{{ task.durationMs | duration }}` → "3:41" */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(ms: number | null | undefined): string {
    return formatDuration(ms);
  }
}

/** `{{ partner.pacePct | pace }}` → "106%" */
@Pipe({ name: 'pace' })
export class PacePipe implements PipeTransform {
  transform(pacePct: number | null | undefined): string {
    return formatPace(pacePct);
  }
}

/** `{{ summary.tasksPaired | count }}` → "31,292" */
@Pipe({ name: 'count' })
export class CountPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatCount(value);
  }
}

/** `{{ summary.taskHoursPerDay | hours }}` → "58.4" */
@Pipe({ name: 'hours' })
export class HoursPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatHours(value);
  }
}

/**
 * `{{ day.date | facilityDate }}` → "Tue, Jan 19"; `{{ day.date | facilityDate: 'short' }}` → "Jan 19".
 * Timestamps are shown in the facility time zone from GET /api/meta.
 */
@Pipe({ name: 'facilityDate' })
export class FacilityDatePipe implements PipeTransform {
  private readonly meta = inject(MetaService);

  transform(value: string | null | undefined, style: DateStyle = 'weekday'): string {
    return formatFacilityDate(value, this.meta.timeZone(), style);
  }
}

/** `{{ task.startedAt | facilityTime }}` → "18:41"; `{{ move.occurredAt | facilityTime: 'millis' }}` → "18:41:55.918" */
@Pipe({ name: 'facilityTime' })
export class FacilityTimePipe implements PipeTransform {
  private readonly meta = inject(MetaService);

  transform(value: string | null | undefined, style: TimeStyle = 'minutes'): string {
    return formatFacilityTime(value, this.meta.timeZone(), style);
  }
}

/** `{{ from | dateRange: to }}` → "Jan 4–31, 2027" */
@Pipe({ name: 'dateRange' })
export class DateRangePipe implements PipeTransform {
  transform(from: string, to: string): string {
    return formatDateRange(from, to);
  }
}
