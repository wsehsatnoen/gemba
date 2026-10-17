// Short names for the generated contract types. Never hand-write a response type:
// change api/openapi.yaml and run `npm run api:types` instead.
import type { components, operations } from '../../api/schema';

type Schemas = components['schemas'];

export type Meta = Schemas['Meta'];
export type Summary = Schemas['Summary'];
export type ZoneTaskTypeStat = Schemas['ZoneTaskTypeStat'];
export type DailyMedian = Schemas['DailyMedian'];
export type WeekdayStat = Schemas['WeekdayStat'];
export type PartnerListItem = Schemas['PartnerListItem'];
export type PartnerSummary = Schemas['PartnerSummary'];
export type PartnerPage = Schemas['PartnerPage'];
export type ComparisonCell = Schemas['ComparisonCell'];
export type PartnerDay = Schemas['PartnerDay'];
export type TaskListItem = Schemas['TaskListItem'];
export type TaskPage = Schemas['TaskPage'];
export type TaskDetail = Schemas['TaskDetail'];
export type Move = Schemas['Move'];
export type MoveRole = Schemas['MoveRole'];
export type PartnerSource = Schemas['PartnerSource'];
export type PageMeta = Schemas['PageMeta'];
export type Problem = Schemas['Problem'];

export type Zone = Schemas['Zone'];
export type TaskType = Schemas['TaskType'];
export type Comparison = Schemas['Comparison'];
export type Weekday = Schemas['Weekday'];
export type PartnerSort = Schemas['PartnerSort'];
export type TaskSort = Schemas['TaskSort'];

/** The shared filters every analytics, partner, and task endpoint accepts. */
export type FilterParams = NonNullable<operations['getSummary']['parameters']['query']>;
export type PartnerQuery = NonNullable<operations['listPartners']['parameters']['query']>;
export type TaskQuery = NonNullable<operations['listTasks']['parameters']['query']>;

export const ZONES: readonly Zone[] = ['AMBIENT', 'CHILLED'];
export const TASK_TYPES: readonly TaskType[] = ['CYCLE_COUNT', 'BIN_MAINTENANCE'];
