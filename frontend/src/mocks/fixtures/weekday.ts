import type { WeekdayStat } from '../../app/core/api/types';

// The range is exactly four weeks, so these average out to the summary's
// 1,117.6 tasks and 58.4 task hours per day. Keep it that way if you change one.
export const WEEKDAY_STATS: WeekdayStat[] = [
  { weekday: 'MONDAY', avgTasks: 1243, avgTaskHours: 65.0 },
  { weekday: 'TUESDAY', avgTasks: 1183, avgTaskHours: 61.8 },
  { weekday: 'WEDNESDAY', avgTasks: 1152, avgTaskHours: 60.2 },
  { weekday: 'THURSDAY', avgTasks: 1122, avgTaskHours: 58.6 },
  { weekday: 'FRIDAY', avgTasks: 1092, avgTaskHours: 57.1 },
  { weekday: 'SATURDAY', avgTasks: 981, avgTaskHours: 51.2 },
  { weekday: 'SUNDAY', avgTasks: 1050, avgTaskHours: 54.9 },
];
