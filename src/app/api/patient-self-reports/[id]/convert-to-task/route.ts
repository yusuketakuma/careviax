import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE } from '@/lib/patient/archive-summary';
import {
  acquirePatientSelfReportTaskLock,
  findPatientSelfReportTask,
  upsertPatientSelfReportTask,
} from '@/server/services/patient-self-report-task';

const convertSelfReportSchema = z
  .object({
    updated_at: z.string().datetime('updated_at の日時形式が不正です'),
  })
  .strict();

const SELF_REPORT_NOT_FOUND_MESSAGE = '患者自己申告が見つかりません';
const SELF_REPORT_CONFLICT_MESSAGE =
  '患者自己申告が他のユーザーによって更新されています。最新のデータを取得してください。';
const SELF_REPORT_STATE_CONFLICT_MESSAGE =
  'この患者自己申告はタスク化できない状態です。最新のデータを取得してください。';

class PatientSelfReportConversionConflictError extends Error {}

const authenticatedPOST = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('患者自己申告IDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = convertSelfReportSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }
    const expectedUpdatedAt = new Date(parsed.data.updated_at);

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        await acquirePatientSelfReportTaskLock(tx, ctx.orgId, id);

        const report = await tx.patientSelfReport.findFirst({
          where: { id, org_id: ctx.orgId },
          select: {
            id: true,
            patient_id: true,
            subject: true,
            preferred_contact_time: true,
            requested_callback: true,
            status: true,
            triaged_at: true,
            created_at: true,
            updated_at: true,
          },
        });
        if (!report) return { kind: 'not_found' as const };

        const patient = await tx.patient.findFirst({
          where: applyPatientAssignmentWhere({ id: report.patient_id, org_id: ctx.orgId }, ctx),
          select: {
            id: true,
            name: true,
            archived_at: true,
            cases: {
              where: { status: { in: ['assessment', 'active', 'on_hold'] } },
              orderBy: { updated_at: 'desc' },
              take: 1,
              select: {
                id: true,
                primary_pharmacist_id: true,
                backup_pharmacist_id: true,
              },
            },
          },
        });
        if (!patient) return { kind: 'not_found' as const };
        if (patient.archived_at) return { kind: 'archived' as const };

        const versionMatches = report.updated_at.getTime() === expectedUpdatedAt.getTime();
        const careCase = patient.cases[0];
        const taskInput = {
          orgId: ctx.orgId,
          reportId: report.id,
          patientId: report.patient_id,
          patientName: patient.name,
          subject: report.subject,
          preferredContactTime: report.preferred_contact_time,
          requestedCallback: report.requested_callback,
          createdAt: report.created_at,
          caseId: careCase?.id ?? null,
          primaryPharmacistId: careCase?.primary_pharmacist_id ?? null,
          backupPharmacistId: careCase?.backup_pharmacist_id ?? null,
          converterUserId: ctx.userId,
          converterRole: ctx.role,
          lockAcquired: true,
        } as const;

        if (report.status === 'converted_to_task') {
          const existingTask = await findPatientSelfReportTask(tx, ctx.orgId, report.id);
          if (!existingTask && !versionMatches) return { kind: 'conflict' as const };

          const task = await upsertPatientSelfReportTask(tx, {
            ...taskInput,
            existingTask,
          });
          if (task.created) {
            await createAuditLogEntry(tx, ctx, {
              action: 'patient_self_report_converted_to_task',
              targetType: 'patient_self_report',
              targetId: report.id,
              changes: {
                patient_id: report.patient_id,
                status_before: report.status,
                status_after: report.status,
                task_id: task.id,
                task_created: true,
                report_status_changed: false,
                task_assigned: task.assignedTo !== null,
              },
            });
          }
          return { kind: 'success' as const, task, alreadyConverted: true };
        }

        if (report.status !== 'submitted' && report.status !== 'triaged') {
          return { kind: 'state_conflict' as const };
        }
        if (!versionMatches) return { kind: 'conflict' as const };

        const task = await upsertPatientSelfReportTask(tx, taskInput);
        const shouldStampTriage = report.triaged_at === null;
        const updated = await tx.patientSelfReport.updateMany({
          where: {
            id: report.id,
            org_id: ctx.orgId,
            status: report.status,
            updated_at: expectedUpdatedAt,
          },
          data: {
            status: 'converted_to_task',
            ...(shouldStampTriage
              ? {
                  triaged_by: ctx.userId,
                  triaged_at: new Date(),
                }
              : {}),
          },
        });
        if (updated.count !== 1) throw new PatientSelfReportConversionConflictError();

        await createAuditLogEntry(tx, ctx, {
          action: 'patient_self_report_converted_to_task',
          targetType: 'patient_self_report',
          targetId: report.id,
          changes: {
            patient_id: report.patient_id,
            status_before: report.status,
            status_after: 'converted_to_task',
            task_id: task.id,
            task_created: task.created,
            report_status_changed: true,
            task_assigned: task.assignedTo !== null,
            triage_stamped: shouldStampTriage,
          },
        });

        return { kind: 'success' as const, task, alreadyConverted: false };
      },
      { requestContext: ctx },
    ).catch((error) => {
      if (error instanceof PatientSelfReportConversionConflictError) {
        return { kind: 'conflict' as const };
      }
      throw error;
    });

    if (result.kind === 'not_found') {
      return withSensitiveNoStore(notFound(SELF_REPORT_NOT_FOUND_MESSAGE));
    }
    if (result.kind === 'archived') {
      return withSensitiveNoStore(conflict(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE));
    }
    if (result.kind === 'conflict') {
      return withSensitiveNoStore(conflict(SELF_REPORT_CONFLICT_MESSAGE));
    }
    if (result.kind === 'state_conflict') {
      return withSensitiveNoStore(conflict(SELF_REPORT_STATE_CONFLICT_MESSAGE));
    }

    return withSensitiveNoStore(
      success({
        data: {
          task_id: result.task.id,
          task_display_id: result.task.displayId,
          task_status: result.task.status,
          report_status: 'converted_to_task' as const,
          already_converted: result.alreadyConverted,
        },
      }),
    );
  },
  {
    permission: 'canReport',
    message: '患者自己申告のタスク化権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
};
