import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import type { RequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import type { HandoffData, StructuredSoap } from '@/types/structured-soap';
import type { VisitHandoff } from '@/types/visit-brief';
import { extractHandoffFromSoap } from './visit-brief-ai';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';

type DbClient = typeof prisma | Prisma.TransactionClient;

export const VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE =
  '申し送り抽出に失敗しました。時間をおいて再実行してください';

export class VisitHandoffStaleRecordError extends Error {
  constructor(visitRecordId: string) {
    super(`Visit record ${visitRecordId} changed before handoff extraction could be saved`);
  }
}

export class VisitHandoffMissingDataError extends Error {
  constructor(visitRecordId: string) {
    super(`Visit record ${visitRecordId} has no confirmable handoff data`);
  }
}

export class VisitHandoffInvalidDataError extends Error {
  constructor(visitRecordId: string) {
    super(`Visit record ${visitRecordId} has malformed handoff data`);
  }
}

export class VisitHandoffAlreadyConfirmedError extends Error {
  constructor(visitRecordId: string) {
    super(`Visit record ${visitRecordId} handoff is already confirmed`);
  }
}

export class VisitHandoffSupervisionTaskUnavailableError extends Error {
  constructor(taskId: string) {
    super(`Handoff supervision task ${taskId} is no longer available`);
  }
}

function readStructuredSoap(value: unknown): Partial<StructuredSoap> {
  return readJsonObject(value) ?? {};
}

function readHandoffData(value: unknown): HandoffData | null {
  const handoff = readJsonObject(value);
  return handoff as HandoffData | null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function hasNonBlankString(values: string[]) {
  return values.some((value) => value.trim().length > 0);
}

function hasConfirmableHandoffContent(
  handoff: Pick<HandoffData, 'next_check_items' | 'ongoing_monitoring' | 'decision_rationale'>,
) {
  return (
    hasNonBlankString(handoff.next_check_items) ||
    hasNonBlankString(handoff.ongoing_monitoring) ||
    (handoff.decision_rationale?.trim().length ?? 0) > 0
  );
}

function countHandoffContent(
  handoff: Pick<HandoffData, 'next_check_items' | 'ongoing_monitoring' | 'decision_rationale'>,
) {
  return {
    next_check_items_count: handoff.next_check_items.filter((value) => value.trim()).length,
    ongoing_monitoring_count: handoff.ongoing_monitoring.filter((value) => value.trim()).length,
    decision_rationale_present: (handoff.decision_rationale?.trim().length ?? 0) > 0,
    decision_rationale_length: handoff.decision_rationale?.length ?? 0,
  };
}

function readMutationCount(result: unknown) {
  return typeof result === 'object' &&
    result !== null &&
    'count' in result &&
    typeof result.count === 'number'
    ? result.count
    : null;
}

function editedHandoffFieldNames(
  edits:
    | Partial<Pick<VisitHandoff, 'next_check_items' | 'ongoing_monitoring' | 'decision_rationale'>>
    | null
    | undefined,
) {
  if (!edits) return [];
  return (['next_check_items', 'ongoing_monitoring', 'decision_rationale'] as const).filter(
    (field) => edits[field] !== undefined,
  );
}

export function readConfirmableHandoffData(
  value: unknown,
): { status: 'missing' } | { status: 'invalid' } | { status: 'valid'; handoff: HandoffData } {
  if (value === undefined || value === null) return { status: 'missing' };

  const handoff = readJsonObject(value);
  if (!handoff) return { status: 'invalid' };

  if (
    !isStringArray(handoff.next_check_items) ||
    !isStringArray(handoff.ongoing_monitoring) ||
    !isNullableString(handoff.decision_rationale) ||
    typeof handoff.ai_extracted !== 'boolean' ||
    !isNullableFiniteNumber(handoff.ai_confidence) ||
    !isNullableString(handoff.confirmed_by) ||
    !isNullableString(handoff.confirmed_at) ||
    !isNullableString(handoff.extracted_at)
  ) {
    return { status: 'invalid' };
  }

  const typedHandoff = handoff as HandoffData;
  if (!hasConfirmableHandoffContent(typedHandoff)) {
    return { status: 'invalid' };
  }

  return { status: 'valid', handoff: typedHandoff };
}

export function normalizeStructuredSoapForVisitRecordSave(
  structuredSoap: unknown,
  existingStructuredSoap?: unknown,
): unknown {
  const soap = readJsonObject(structuredSoap);
  if (!soap) return structuredSoap;

  const existingHandoff = readHandoffData(readStructuredSoap(existingStructuredSoap).handoff);
  if (existingHandoff) {
    return {
      ...soap,
      handoff: existingHandoff,
    };
  }

  const handoff = readJsonObject(soap.handoff);
  if (!handoff) return soap;

  return {
    ...soap,
    handoff: {
      ...handoff,
      ai_extracted: false,
      ai_confidence: null,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: null,
    },
  };
}

async function saveHandoffExtractionStatus(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    expectedVersion?: number | null;
    status: 'extracting' | 'succeeded' | 'failed';
    message?: string | null;
    requestContext?: RequestAuthContext;
  },
): Promise<boolean> {
  return withOrgContext(
    args.orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: args.visitRecordId },
        select: { schedule_id: true, version: true, updated_at: true },
      });
      const expectedVersion = args.expectedVersion ?? record.version;
      if (record.version !== expectedVersion) return false;

      const now = new Date();
      await tx.visitHandoffExtraction.upsert({
        where: { visit_record_id: args.visitRecordId },
        create: {
          org_id: args.orgId,
          visit_record_id: args.visitRecordId,
          schedule_id: record.schedule_id,
          source_visit_record_version: record.version,
          source_visit_record_updated_at: record.updated_at,
          status: args.status,
          retry_count: args.status === 'failed' ? 1 : 0,
          last_attempted_at: now,
          last_succeeded_at: args.status === 'succeeded' ? now : null,
          last_failed_at: args.status === 'failed' ? now : null,
          error_message: args.status === 'failed' ? (args.message ?? null) : null,
          retryable: args.status === 'failed',
        },
        update: {
          source_visit_record_version: record.version,
          source_visit_record_updated_at: record.updated_at,
          status: args.status,
          ...(args.status === 'failed' ? { retry_count: { increment: 1 } } : {}),
          last_attempted_at: now,
          last_succeeded_at: args.status === 'succeeded' ? now : undefined,
          last_failed_at: args.status === 'failed' ? now : undefined,
          error_message: args.status === 'failed' ? (args.message ?? null) : null,
          retryable: args.status === 'failed',
        },
      });
      return true;
    },
    { requestContext: args.requestContext },
  );
}

export async function markHandoffExtractionFailed(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    expectedVersion?: number | null;
    requestContext?: RequestAuthContext;
  },
): Promise<boolean> {
  return saveHandoffExtractionStatus(_db, {
    orgId: args.orgId,
    visitRecordId: args.visitRecordId,
    expectedVersion: args.expectedVersion,
    requestContext: args.requestContext,
    status: 'failed',
    message: VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
  });
}

// ─── processHandoffExtraction ─────────────────────────────────────────────────

export async function processHandoffExtraction(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    patientId: string;
    patientName: string;
    structuredSoap: StructuredSoap;
    soapAssessment: string | null;
    soapPlan: string | null;
    expectedVersion?: number | null;
    requestContext?: RequestAuthContext;
    handoffConfirmationAssigneeId?: string | null;
  },
): Promise<VisitHandoff> {
  const {
    orgId,
    visitRecordId,
    patientName,
    structuredSoap,
    soapAssessment,
    soapPlan,
    requestContext,
  } = args;

  const claimedExtraction = await saveHandoffExtractionStatus(_db, {
    orgId,
    visitRecordId,
    expectedVersion: args.expectedVersion,
    requestContext,
    status: 'extracting',
  });
  if (!claimedExtraction) {
    throw new VisitHandoffStaleRecordError(visitRecordId);
  }

  let result;
  try {
    result = await extractHandoffFromSoap({
      patientName,
      soapAssessment: soapAssessment ?? '',
      soapPlan: soapPlan ?? '',
      structuredAssessment: structuredSoap.assessment,
      structuredPlan: structuredSoap.plan,
      previousHandoff: structuredSoap.handoff ?? null,
    });
  } catch (cause) {
    await markHandoffExtractionFailed(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
    });
    throw cause;
  }

  const handoff: HandoffData = {
    next_check_items: result.next_check_items,
    ongoing_monitoring: result.ongoing_monitoring,
    decision_rationale: result.decision_rationale,
    ai_extracted: true,
    ai_confidence: result.confidence,
    confirmed_by: null,
    confirmed_at: null,
    extracted_at: result.extracted_at,
  };

  if (!hasConfirmableHandoffContent(handoff)) {
    await markHandoffExtractionFailed(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
    });
    throw new VisitHandoffInvalidDataError(visitRecordId);
  }

  try {
    await withOrgContext(
      orgId,
      async (tx) => {
        const record = await tx.visitRecord.findUniqueOrThrow({
          where: { id: visitRecordId },
          select: { structured_soap: true, version: true },
        });
        const expectedVersion = args.expectedVersion ?? record.version;

        const existing = readStructuredSoap(record.structured_soap);

        const updated = {
          ...existing,
          handoff,
        };

        const claim = await tx.visitRecord.updateMany({
          where: { id: visitRecordId, version: expectedVersion },
          data: {
            structured_soap: toPrismaJsonInput(updated),
          },
        });
        if (claim.count !== 1) {
          throw new VisitHandoffStaleRecordError(visitRecordId);
        }

        await upsertOperationalTask(tx, {
          orgId,
          taskType: 'handoff_confirmation',
          title: `申し送り確認: ${args.patientName}`,
          priority: 'normal',
          assignedTo: args.handoffConfirmationAssigneeId ?? null,
          dedupeKey: `handoff_confirm_${visitRecordId}`,
          relatedEntityType: 'visit_record',
          relatedEntityId: visitRecordId,
        });
      },
      { requestContext },
    );
    await saveHandoffExtractionStatus(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
      status: 'succeeded',
    });
  } catch (cause) {
    if (cause instanceof VisitHandoffStaleRecordError) throw cause;
    await markHandoffExtractionFailed(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
    });
    throw cause;
  }

  return handoff;
}

// ─── confirmHandoff ───────────────────────────────────────────────────────────

export async function confirmHandoff(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    confirmedBy: string;
    edits?: Partial<
      Pick<VisitHandoff, 'next_check_items' | 'ongoing_monitoring' | 'decision_rationale'>
    >;
    expectedVersion: number;
    requestContext?: RequestAuthContext;
    confirmationWhere?: Prisma.VisitRecordWhereInput;
    confirmationBasis?:
      | 'assigned_schedule'
      | 'case_primary_or_backup'
      | 'task_assignee'
      | 'supervision_task_assignee'
      | 'admin_emergency_override';
    overrideReason?: string | null;
    supervisionReview?: {
      taskId: string;
      traineeUserId: string | null;
      supervisorUserId: string;
      requestedVisitRecordVersion: number | null;
    };
  },
): Promise<VisitHandoff> {
  const {
    orgId,
    visitRecordId,
    confirmedBy,
    edits,
    expectedVersion,
    requestContext,
    confirmationWhere,
    confirmationBasis,
    overrideReason,
    supervisionReview,
  } = args;

  let confirmed: HandoffData | null = null;

  await withOrgContext(
    orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: visitRecordId },
        select: { structured_soap: true, version: true, schedule_id: true },
      });

      if (record.version !== expectedVersion) {
        throw new VisitHandoffStaleRecordError(visitRecordId);
      }

      const currentSoap = readStructuredSoap(record.structured_soap);
      const currentHandoffResult = readConfirmableHandoffData(currentSoap.handoff);

      if (currentHandoffResult.status === 'missing') {
        throw new VisitHandoffMissingDataError(visitRecordId);
      }
      if (currentHandoffResult.status === 'invalid') {
        throw new VisitHandoffInvalidDataError(visitRecordId);
      }

      const currentHandoff = currentHandoffResult.handoff;
      if (currentHandoff.confirmed_at || currentHandoff.confirmed_by) {
        throw new VisitHandoffAlreadyConfirmedError(visitRecordId);
      }

      const editedFields = editedHandoffFieldNames(edits);

      confirmed = {
        ...currentHandoff,
        ...(edits?.next_check_items !== undefined
          ? { next_check_items: edits.next_check_items }
          : {}),
        ...(edits?.ongoing_monitoring !== undefined
          ? { ongoing_monitoring: edits.ongoing_monitoring }
          : {}),
        ...(edits?.decision_rationale !== undefined
          ? { decision_rationale: edits.decision_rationale }
          : {}),
        confirmed_by: confirmedBy,
        confirmed_at: new Date().toISOString(),
      };

      if (!hasConfirmableHandoffContent(confirmed)) {
        throw new VisitHandoffInvalidDataError(visitRecordId);
      }

      if (supervisionReview) {
        const supervisionTaskClaim = await tx.task.updateMany({
          where: {
            id: supervisionReview.taskId,
            org_id: orgId,
            task_type: 'handoff_supervision_review',
            status: { in: ['pending', 'in_progress'] },
            assigned_to: confirmedBy,
            related_entity_type: 'visit_record',
            related_entity_id: visitRecordId,
          },
          data: {
            status: 'in_progress',
          },
        });
        if (supervisionTaskClaim.count !== 1) {
          throw new VisitHandoffSupervisionTaskUnavailableError(supervisionReview.taskId);
        }
      }

      const updated = {
        ...currentSoap,
        handoff: confirmed,
      };
      const claimWhere = confirmationWhere
        ? { AND: [{ id: visitRecordId, version: expectedVersion }, confirmationWhere] }
        : { id: visitRecordId, version: expectedVersion };

      const claim = await tx.visitRecord.updateMany({
        where: claimWhere,
        data: {
          structured_soap: toPrismaJsonInput(updated),
          version: { increment: 1 },
        },
      });
      if (claim.count !== 1) {
        throw new VisitHandoffStaleRecordError(visitRecordId);
      }

      const directConfirmationResolution = await resolveOperationalTasks(tx, {
        orgId,
        dedupeKey: `handoff_confirm_${visitRecordId}`,
        taskType: 'handoff_confirmation',
        assignedToUserId: confirmedBy,
        includeUnassigned: true,
      });

      const traineeConfirmationResolution =
        supervisionReview?.traineeUserId && supervisionReview.traineeUserId !== confirmedBy
          ? await resolveOperationalTasks(tx, {
              orgId,
              dedupeKey: `handoff_confirm_${visitRecordId}`,
              taskType: 'handoff_confirmation',
              assignedToUserId: supervisionReview.traineeUserId,
            })
          : null;

      let supervisionTaskResolution: unknown = null;
      if (supervisionReview) {
        supervisionTaskResolution = await resolveOperationalTasks(tx, {
          orgId,
          taskId: supervisionReview.taskId,
          taskType: 'handoff_supervision_review',
          relatedEntityType: 'visit_record',
          relatedEntityId: visitRecordId,
          assignedToUserId: confirmedBy,
        });
      }

      if (requestContext) {
        await createAuditLogEntry(tx, requestContext, {
          action: supervisionReview
            ? 'visit_handoff_supervision_confirmed'
            : 'visit_handoff_confirmed',
          targetType: 'visit_record',
          targetId: visitRecordId,
          changes: {
            visit_record_id: visitRecordId,
            schedule_id: record.schedule_id,
            confirmed_by: confirmedBy,
            authorized_basis: confirmationBasis ?? 'service_call',
            ...(supervisionReview
              ? {
                  handoff_supervision_task_id: supervisionReview.taskId,
                  trainee_user_id: supervisionReview.traineeUserId,
                  supervisor_user_id: supervisionReview.supervisorUserId,
                  requested_visit_record_version: supervisionReview.requestedVisitRecordVersion,
                  confirmed_visit_record_version: expectedVersion,
                  handoff_confirmation_tasks_resolved_count:
                    (readMutationCount(directConfirmationResolution) ?? 0) +
                    (readMutationCount(traineeConfirmationResolution) ?? 0),
                  handoff_supervision_tasks_resolved_count:
                    readMutationCount(supervisionTaskResolution),
                }
              : {}),
            ...(overrideReason
              ? {
                  override_reason_present: true,
                  override_reason_length: overrideReason.trim().length,
                  override_reason_redacted: true,
                }
              : {}),
            edited_fields: editedFields,
            before: countHandoffContent(currentHandoff),
            after: countHandoffContent(confirmed),
          },
        });
      }
    },
    { requestContext },
  );

  if (!confirmed) {
    throw new Error(`confirmHandoff: update did not complete for visit record ${visitRecordId}`);
  }

  return confirmed;
}

// ─── requestHandoffConfirmationSupervision ─────────────────────────────────

export async function requestHandoffConfirmationSupervision(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    traineeUserId: string;
    supervisorUserId: string;
    expectedVersion: number;
    requestNote?: string | null;
    requestContext?: RequestAuthContext;
  },
): Promise<{
  status: 'requested';
  task_type: 'handoff_supervision_review';
  assigned_to: string;
  visit_record_id: string;
  visit_record_version: number;
}> {
  const {
    orgId,
    visitRecordId,
    traineeUserId,
    supervisorUserId,
    expectedVersion,
    requestNote,
    requestContext,
  } = args;

  let requested = false;

  await withOrgContext(
    orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: visitRecordId },
        select: { structured_soap: true, version: true, schedule_id: true },
      });

      if (record.version !== expectedVersion) {
        throw new VisitHandoffStaleRecordError(visitRecordId);
      }

      const currentSoap = readStructuredSoap(record.structured_soap);
      const currentHandoffResult = readConfirmableHandoffData(currentSoap.handoff);

      if (currentHandoffResult.status === 'missing') {
        throw new VisitHandoffMissingDataError(visitRecordId);
      }
      if (currentHandoffResult.status === 'invalid') {
        throw new VisitHandoffInvalidDataError(visitRecordId);
      }

      const currentHandoff = currentHandoffResult.handoff;
      if (currentHandoff.confirmed_at || currentHandoff.confirmed_by) {
        throw new VisitHandoffAlreadyConfirmedError(visitRecordId);
      }

      await upsertOperationalTask(tx, {
        orgId,
        taskType: 'handoff_supervision_review',
        title: '申し送り上長確認',
        priority: 'normal',
        assignedTo: supervisorUserId,
        dedupeKey: `handoff_supervision_${visitRecordId}_${traineeUserId}`,
        relatedEntityType: 'visit_record',
        relatedEntityId: visitRecordId,
        metadata: {
          visit_record_id: visitRecordId,
          visit_record_version: expectedVersion,
          schedule_id: record.schedule_id,
          trainee_user_id: traineeUserId,
          supervisor_user_id: supervisorUserId,
          request_note_present: Boolean(requestNote?.trim()),
          request_note_length: requestNote?.trim().length ?? 0,
          request_note_redacted: Boolean(requestNote?.trim()),
        },
      });

      if (requestContext) {
        await createAuditLogEntry(tx, requestContext, {
          action: 'visit_handoff_supervision_requested',
          targetType: 'visit_record',
          targetId: visitRecordId,
          changes: {
            visit_record_id: visitRecordId,
            schedule_id: record.schedule_id,
            trainee_user_id: traineeUserId,
            supervisor_user_id: supervisorUserId,
            visit_record_version: expectedVersion,
            request_note_present: Boolean(requestNote?.trim()),
            request_note_length: requestNote?.trim().length ?? 0,
            request_note_redacted: Boolean(requestNote?.trim()),
            handoff: countHandoffContent(currentHandoff),
          },
        });
      }

      requested = true;
    },
    { requestContext },
  );

  if (!requested) {
    throw new Error(
      `requestHandoffConfirmationSupervision: request did not complete for visit record ${visitRecordId}`,
    );
  }

  return {
    status: 'requested',
    task_type: 'handoff_supervision_review',
    assigned_to: supervisorUserId,
    visit_record_id: visitRecordId,
    visit_record_version: expectedVersion,
  };
}
