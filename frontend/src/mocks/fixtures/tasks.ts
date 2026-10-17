import type { TaskDetail, TaskListItem } from '../../app/core/api/types';
import { GENERATED_TASKS } from './generated-tasks';

/** The task the portfolio walkthrough opens: a discarded start, a start, an action, an end. */
export const TASK_48213: TaskDetail = {
  taskId: 48213,
  startedAt: '2027-01-19T18:41:55.918-06:00',
  endedAt: '2027-01-19T18:45:36.771-06:00',
  zone: 'CHILLED',
  taskType: 'CYCLE_COUNT',
  port: 3,
  binId: 'SIMTU004417',
  partnerId: 'SIMUSR0142',
  durationMs: 220853,
  p90Ms: 128000,
  aboveP90: true,
  partnerSource: 'START_MOVE',
  moves: [
    {
      transactionId: 911871,
      occurredAt: '2027-01-19T18:41:07.302-06:00',
      transactionType: 'MOVE',
      fromLocation: 'GRID',
      toLocation: 'PORT-03',
      partnerId: 'SIMUSR0207',
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: null,
      role: 'DISCARDED_START',
      note: 'A later start on this bin arrived before the end.',
    },
    {
      transactionId: 911894,
      occurredAt: '2027-01-19T18:41:55.918-06:00',
      transactionType: 'MOVE',
      fromLocation: 'GRID',
      toLocation: 'PORT-03',
      partnerId: 'SIMUSR0142',
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: null,
      role: 'START',
      note: null,
    },
    {
      transactionId: 911903,
      occurredAt: '2027-01-19T18:42:31.004-06:00',
      transactionType: 'ADJUST',
      fromLocation: 'PORT-03',
      toLocation: null,
      partnerId: 'SIMUSR0142',
      quantityBefore: 24,
      quantityAfter: 23,
      quantityChange: -1,
      role: 'ACTION',
      note: null,
    },
    {
      transactionId: 911942,
      occurredAt: '2027-01-19T18:45:36.771-06:00',
      transactionType: 'MOVE',
      fromLocation: 'PORT-03',
      toLocation: 'GRID',
      partnerId: null,
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: null,
      role: 'END',
      note: null,
    },
  ],
};

/** Every task with its moves, newest first. */
export const TASK_DETAILS: TaskDetail[] = [TASK_48213, ...GENERATED_TASKS].sort((a, b) =>
  b.startedAt.localeCompare(a.startedAt),
);

/** The same tasks as list items (the detail-only fields removed), newest first. */
export const TASKS: TaskListItem[] = TASK_DETAILS.map(({ partnerSource, moves, ...item }) => item);
