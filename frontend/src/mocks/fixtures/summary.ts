import type { Summary } from '../../app/core/api/types';

export const SUMMARY: Summary = {
  tasksPaired: 31292,
  rowsImported: 80000,
  operatingDays: 28,
  tasksPerDay: 1117.6,
  taskHoursPerDay: 58.4,
  duplicateStartsDiscarded: 214,
  unattributedTasks: 0,
};

/** What the backend would send for a range with no tasks (`?mock=empty`). */
export const EMPTY_SUMMARY: Summary = {
  tasksPaired: 0,
  rowsImported: 0,
  operatingDays: 0,
  tasksPerDay: 0,
  taskHoursPerDay: 0,
  duplicateStartsDiscarded: 0,
  unattributedTasks: 0,
};
