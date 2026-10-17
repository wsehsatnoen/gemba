import { httpResource } from '@angular/common/http';
import { Service } from '@angular/core';
import { apiRequest } from './request';
import type { FilterParams, Summary, WeekdayStat, ZoneTaskTypeStat } from './types';

/**
 * Facility-wide figures for the overview. Each method returns an `httpResource` that
 * refetches whenever the signals read inside `filters` change. Call these from a
 * component's field initializers (they need an injection context).
 */
@Service()
export class AnalyticsApi {
  summary(filters: () => FilterParams | undefined) {
    return httpResource<Summary>(() => apiRequest('/api/analytics/summary', filters()));
  }

  zoneTaskType(filters: () => FilterParams | undefined) {
    return httpResource<ZoneTaskTypeStat[]>(() =>
      apiRequest('/api/analytics/zone-task-type', filters()),
    );
  }

  weekday(filters: () => FilterParams | undefined) {
    return httpResource<WeekdayStat[]>(() => apiRequest('/api/analytics/weekday', filters()));
  }
}
