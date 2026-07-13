import { addDays } from 'date-fns';
import type { MemberRole, Prisma } from '@prisma/client';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { upsertOperationalTask, type TaskStatus } from '@/server/services/operational-tasks';

export const PATIENT_SELF_REPORT_TASK_TYPE = 'patient_self_report_followup';
export const PATIENT_SELF_REPORT_TASK_LOCK_NAMESPACE = 'patient_self_report_task';

const CONVERTER_ASSIGNEE_ROLES: ReadonlySet<MemberRole> = new Set([
  'pharmacist',
  'pharmacist_trainee',
]);

export type PatientSelfReportTaskRecord = {
  id: string;
  display_id: string | null;
  status: TaskStatus;
  assigned_to: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Prisma.JsonValue | null;
};

export type PatientSelfReportTaskResult = {
  id: string;
  displayId: string | null;
  status: TaskStatus;
  assignedTo: string | null;
  created: boolean;
};

export function buildPatientSelfReportTaskKey(reportId: string) {
  return `patient-self-report:${reportId}`;
}

export function resolvePatientSelfReportTaskAssignee(input: {
  primaryPharmacistId?: string | null;
  backupPharmacistId?: string | null;
  converterUserId?: string | null;
  converterRole?: MemberRole | null;
}) {
  if (input.primaryPharmacistId) return input.primaryPharmacistId;
  if (input.backupPharmacistId) return input.backupPharmacistId;
  if (
    input.converterUserId &&
    input.converterRole &&
    CONVERTER_ASSIGNEE_ROLES.has(input.converterRole)
  ) {
    return input.converterUserId;
  }
  return null;
}

export async function acquirePatientSelfReportTaskLock(
  tx: Prisma.TransactionClient,
  orgId: string,
  reportId: string,
) {
  await acquireAdvisoryTxLock(tx, PATIENT_SELF_REPORT_TASK_LOCK_NAMESPACE, `${orgId}:${reportId}`);
}

export async function findPatientSelfReportTask(
  tx: Prisma.TransactionClient,
  orgId: string,
  reportId: string,
): Promise<PatientSelfReportTaskRecord | null> {
  return tx.task.findFirst({
    where: {
      org_id: orgId,
      dedupe_key: buildPatientSelfReportTaskKey(reportId),
    },
    select: {
      id: true,
      display_id: true,
      status: true,
      assigned_to: true,
      related_entity_type: true,
      related_entity_id: true,
      metadata: true,
    },
  });
}

function metadataObject(metadata: Prisma.JsonValue | null): Prisma.InputJsonObject {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return { ...metadata } as Prisma.InputJsonObject;
}

function metadataNeedsNormalization(
  metadata: Prisma.JsonValue | null,
  expected: {
    patientId: string;
    reportId: string;
    caseId: string | null;
    requestedCallback: boolean;
  },
) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true;
  return (
    metadata.patient_id !== expected.patientId ||
    metadata.report_id !== expected.reportId ||
    metadata.case_id !== expected.caseId ||
    metadata.requested_callback !== expected.requestedCallback
  );
}

export async function upsertPatientSelfReportTask(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    reportId: string;
    patientId: string;
    patientName: string | null;
    subject: string;
    preferredContactTime: string | null;
    requestedCallback: boolean;
    createdAt: Date;
    caseId: string | null;
    primaryPharmacistId?: string | null;
    backupPharmacistId?: string | null;
    converterUserId?: string | null;
    converterRole?: MemberRole | null;
    lockAcquired?: boolean;
    existingTask?: PatientSelfReportTaskRecord | null;
  },
): Promise<PatientSelfReportTaskResult> {
  if (!input.lockAcquired) {
    await acquirePatientSelfReportTaskLock(tx, input.orgId, input.reportId);
  }

  const existingTask =
    input.existingTask === undefined
      ? await findPatientSelfReportTask(tx, input.orgId, input.reportId)
      : input.existingTask;
  const selectedAssignee = resolvePatientSelfReportTaskAssignee({
    primaryPharmacistId: input.primaryPharmacistId,
    backupPharmacistId: input.backupPharmacistId,
    converterUserId: input.converterUserId,
    converterRole: input.converterRole,
  });
  const desiredAssignee = existingTask?.assigned_to ?? selectedAssignee;
  const expectedMetadata = {
    patientId: input.patientId,
    reportId: input.reportId,
    caseId: input.caseId,
    requestedCallback: input.requestedCallback,
  };

  if (existingTask) {
    const shouldNormalizeMetadata = metadataNeedsNormalization(
      existingTask.metadata,
      expectedMetadata,
    );
    const shouldNormalize =
      existingTask.related_entity_type !== 'patient' ||
      existingTask.related_entity_id !== input.patientId ||
      existingTask.assigned_to !== desiredAssignee ||
      shouldNormalizeMetadata;

    if (shouldNormalize) {
      const normalized = await tx.task.updateMany({
        where: {
          id: existingTask.id,
          org_id: input.orgId,
          dedupe_key: buildPatientSelfReportTaskKey(input.reportId),
        },
        data: {
          related_entity_type: 'patient',
          related_entity_id: input.patientId,
          assigned_to: desiredAssignee,
          ...(shouldNormalizeMetadata
            ? {
                metadata: {
                  ...metadataObject(existingTask.metadata),
                  patient_id: input.patientId,
                  report_id: input.reportId,
                  case_id: input.caseId,
                  requested_callback: input.requestedCallback,
                },
              }
            : {}),
        },
      });
      if (normalized.count !== 1) {
        throw new Error('Patient self-report task normalization did not converge');
      }
    }

    return {
      id: existingTask.id,
      displayId: existingTask.display_id,
      status: existingTask.status,
      assignedTo: desiredAssignee,
      created: false,
    };
  }

  const dueAt = addDays(input.createdAt, input.requestedCallback ? 1 : 2);
  const task = (await upsertOperationalTask(tx, {
    orgId: input.orgId,
    taskType: PATIENT_SELF_REPORT_TASK_TYPE,
    title: `${input.patientName?.trim() || '患者'} からの自己申告対応`,
    description: `${input.subject}${
      input.preferredContactTime ? ` / 希望時間 ${input.preferredContactTime}` : ''
    }`,
    priority: input.requestedCallback ? 'urgent' : 'high',
    assignedTo: desiredAssignee,
    dueDate: dueAt,
    slaDueAt: dueAt,
    relatedEntityType: 'patient',
    relatedEntityId: input.patientId,
    dedupeKey: buildPatientSelfReportTaskKey(input.reportId),
    metadata: {
      patient_id: input.patientId,
      report_id: input.reportId,
      case_id: input.caseId,
      requested_callback: input.requestedCallback,
    },
  })) as { id: string; display_id: string | null };

  return {
    id: task.id,
    displayId: task.display_id,
    status: 'pending',
    assignedTo: desiredAssignee,
    created: true,
  };
}
