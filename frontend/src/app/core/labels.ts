import type { Comparison, MoveRole, PartnerSource, TaskType, Weekday, Zone } from './api/types';

// Display labels for the contract's enum values, in sentence case.

export const ZONE_LABELS: Record<Zone, string> = {
  AMBIENT: 'Ambient',
  CHILLED: 'Chilled',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CYCLE_COUNT: 'Cycle count',
  BIN_MAINTENANCE: 'Bin maintenance',
};

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
  SUNDAY: 'Sun',
};

export const COMPARISON_LABELS: Record<Comparison, string> = {
  FASTER: 'Faster',
  SIMILAR: 'Similar',
  SLOWER: 'Slower',
  INSUFFICIENT_SAMPLE: 'Too few',
};

export const PARTNER_SOURCE_LABELS: Record<PartnerSource, string> = {
  START_MOVE: 'From the start move',
  ACTION_ROW: 'From an action at the port',
};

/** Sub-label when `partnerSource` is null. */
export const NO_PARTNER_SOURCE_LABEL = 'No partner on any row';

/** Role pill text. Actions get no pill. */
export const MOVE_ROLE_LABELS: Record<MoveRole, string | null> = {
  DISCARDED_START: 'Discarded',
  START: 'Start',
  ACTION: null,
  END: 'End',
};
