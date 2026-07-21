import type { Prisma } from '@prisma/client';
import type {
  FirstVisitDocumentAction,
  TimelineEvent,
  TimelineHrefBundle,
} from '@/server/services/patient-detail-timeline-events';

/** Shared frozen empty array; type-linked to each adapter's Row at the use site. */
export const EMPTY = Object.freeze([]) as readonly never[];

/** Minimal Prisma surface the timeline source fetchers depend on. */
export type PatientTimelineRegistryDb = {
  billingCandidate: Pick<Prisma.TransactionClient['billingCandidate'], 'findMany'>;
  careReport: Pick<Prisma.TransactionClient['careReport'], 'findMany'>;
  communicationEvent: Pick<Prisma.TransactionClient['communicationEvent'], 'findMany'>;
  conferenceNote: Pick<Prisma.TransactionClient['conferenceNote'], 'findMany'>;
  dispenseResult: Pick<Prisma.TransactionClient['dispenseResult'], 'findMany'>;
  externalAccessGrant: Pick<Prisma.TransactionClient['externalAccessGrant'], 'findMany'>;
  firstVisitDocument: Pick<Prisma.TransactionClient['firstVisitDocument'], 'findMany'>;
  inquiryRecord: Pick<Prisma.TransactionClient['inquiryRecord'], 'findMany'>;
  managementPlan: Pick<Prisma.TransactionClient['managementPlan'], 'findMany'>;
  patientSelfReport: Pick<Prisma.TransactionClient['patientSelfReport'], 'findMany'>;
  patientMcsMessage: Pick<Prisma.TransactionClient['patientMcsMessage'], 'findMany'>;
  partnerVisitRecord: Pick<Prisma.TransactionClient['partnerVisitRecord'], 'findMany'>;
  residualMedication: Pick<Prisma.TransactionClient['residualMedication'], 'findMany'>;
  medicationStockSnapshot: Pick<Prisma.TransactionClient['medicationStockSnapshot'], 'findMany'>;
  task: Pick<Prisma.TransactionClient['task'], 'findMany'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'findMany'>;
  visitRecord: Pick<Prisma.TransactionClient['visitRecord'], 'findMany'>;
  visitSchedule: Pick<Prisma.TransactionClient['visitSchedule'], 'findMany'>;
};

/** Captured-once fetch inputs. No actorNameMap (doesn't exist at fetch time). */
export interface TimelineFetchCtx {
  db: PatientTimelineRegistryDb;
  orgId: string;
  patientId: string;
  caseIds: string[];
  timelineLimit: number;
  canManageBilling: boolean;
  billingRefs: { visitRecordIds: string[]; cycleIds: string[] };
}

/** Projection inputs. Superset of fetch ctx + post-fetch derived artifacts. */
export interface TimelineProjectCtx {
  patientId: string;
  actorNameMap: ReadonlyMap<string, string>;
  firstVisitDocumentActions: ReadonlyMap<string, FirstVisitDocumentAction>;
  hrefs: TimelineHrefBundle;
}

export interface SourceAdapter<Key extends string, Row> {
  readonly key: Key;
  fetch(ctx: TimelineFetchCtx): Promise<readonly Row[]>;
  readonly emptyFallback: readonly Row[];
  toEvents(rows: readonly Row[], ctx: TimelineProjectCtx): TimelineEvent[];
  collectActorIds?(row: Row): Array<string | null | undefined>;
}

export function defineTimelineSource<Key extends string, Row>(
  adapter: SourceAdapter<Key, Row>,
): SourceAdapter<Key, Row> {
  return adapter;
}

const PATIENT_TIMELINE_SOURCE_MIN_TAKE = 4;

export function resolveTimelineSourceTake(
  ctx: Pick<TimelineFetchCtx, 'timelineLimit'>,
  defaultTake: number,
  options?: { minimumTake?: number },
) {
  const normalizedLimit = Number.isSafeInteger(ctx.timelineLimit) ? ctx.timelineLimit : defaultTake;
  const minimumTake = Math.min(
    defaultTake,
    options?.minimumTake ?? PATIENT_TIMELINE_SOURCE_MIN_TAKE,
  );
  return Math.min(defaultTake, Math.max(minimumTake, normalizedLimit));
}
