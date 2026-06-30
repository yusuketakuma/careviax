import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, notFound, validationError, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { fetchEmergencyContacts } from '@/lib/patient/emergency-contacts';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

class RescheduleApprovalStateChangedError extends Error {
  constructor() {
    super('RESCHEDULE_APPROVAL_STATE_CHANGED');
  }
}

const RESCHEDULE_APPROVABLE_SOURCE_STATUSES = ['planned', 'in_preparation'] as const;

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'リスケ承認の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');

  const override = await prisma.visitScheduleOverride.findFirst({
    where: {
      org_id: ctx.orgId,
      source_schedule_id: id,
      status: 'pending',
    },
    include: {
      source_schedule: {
        select: {
          id: true,
          pharmacist_id: true,
          case_id: true,
          schedule_status: true,
          version: true,
          case_: {
            select: {
              patient_id: true,
            },
          },
        },
      },
    },
  });
  if (!override) return notFound('承認待ちのリスケ要求が見つかりません');
  if (override.requested_by === ctx.userId) {
    return validationError('リスケ要求の申請者自身は承認できません');
  }
  if (override.approved_at) {
    const { source_schedule: overrideSourceSchedule, ...overrideWithoutSourceSchedule } = override;
    return success({
      data: {
        ...overrideWithoutSourceSchedule,
        source_schedule: {
          id: overrideSourceSchedule.id,
          pharmacist_id: overrideSourceSchedule.pharmacist_id,
          case_id: overrideSourceSchedule.case_id,
          case_: overrideSourceSchedule.case_,
        },
        suggested_contacts: [],
      },
    });
  }

  let approved;
  try {
    approved = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const approvedAt = new Date();
        const claim = await tx.visitScheduleOverride.updateMany({
          where: {
            id: override.id,
            org_id: ctx.orgId,
            status: 'pending',
            approved_at: null,
          },
          data: {
            approved_by: ctx.userId,
            approved_at: approvedAt,
          },
        });
        if (claim.count !== 1) {
          throw new RescheduleApprovalStateChangedError();
        }

        const sourceSchedule = await tx.visitSchedule.findFirst({
          where: { id, org_id: ctx.orgId },
          select: { schedule_status: true, version: true },
        });
        if (
          !sourceSchedule ||
          !RESCHEDULE_APPROVABLE_SOURCE_STATUSES.includes(
            sourceSchedule.schedule_status as (typeof RESCHEDULE_APPROVABLE_SOURCE_STATUSES)[number],
          )
        ) {
          throw new RescheduleApprovalStateChangedError();
        }

        const scheduleClaim = await tx.visitSchedule.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            version: sourceSchedule.version,
            schedule_status: sourceSchedule.schedule_status,
          },
          data: {
            schedule_status: 'rescheduled',
            version: { increment: 1 },
          },
        });
        if (scheduleClaim.count !== 1) {
          throw new RescheduleApprovalStateChangedError();
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'visit_schedule_reschedule_approved',
          targetType: 'VisitSchedule',
          targetId: id,
          patientId: override.source_schedule.case_.patient_id,
          changes: {
            schedule_status: {
              from: sourceSchedule.schedule_status,
              to: 'rescheduled',
            },
            override_id: override.id,
            approved_by: ctx.userId,
          },
        });

        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: `visit-reschedule-approval:${id}`,
          status: 'completed',
        });

        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: `visit-reschedule-approval:${override.source_schedule_id}`,
          status: 'completed',
        });

        await dispatchNotificationEvent(tx, {
          orgId: ctx.orgId,
          eventType: 'visit_schedule_reschedule_approved',
          type: 'business',
          title: 'リスケ要求が承認されました',
          message: '確定済み訪問の変更要求が承認され、代替候補の確定待ちになりました。',
          link: `/schedules`,
          explicitUserIds: [override.requested_by, override.source_schedule.pharmacist_id],
          dedupeKey: `visit-reschedule-approval:${override.id}`,
          metadata: {
            override_id: override.id,
            case_id: override.source_schedule.case_id,
            patient_id: override.source_schedule.case_.patient_id,
          },
        });

        // FVD-01C: Fetch emergency contacts as default recipients for post-approval notification
        const emergencyContacts = await fetchEmergencyContacts(
          tx,
          ctx.orgId,
          override.source_schedule.case_.patient_id,
        );

        const { source_schedule: overrideSourceSchedule, ...overrideWithoutSourceSchedule } =
          override;
        const sourceScheduleForResponse = {
          id: overrideSourceSchedule.id,
          pharmacist_id: overrideSourceSchedule.pharmacist_id,
          case_id: overrideSourceSchedule.case_id,
          case_: overrideSourceSchedule.case_,
        };

        return {
          updated: {
            ...overrideWithoutSourceSchedule,
            source_schedule: sourceScheduleForResponse,
            approved_by: ctx.userId,
            approved_at: approvedAt,
          },
          emergencyContacts,
        };
      },
      { requestContext: ctx },
    );
  } catch (error) {
    if (error instanceof RescheduleApprovalStateChangedError) {
      return conflict('リスケ承認が同時に更新されました。再読み込みしてください');
    }
    throw error;
  }

  if (!approved) {
    return conflict('リスケ承認が同時に更新されました。再読み込みしてください');
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_reschedule_approve', schedule_id: id },
  });

  return success({
    data: {
      ...approved.updated,
      // FVD-01C: Emergency contacts provided as default recipients for post-approval patient/family notification
      suggested_contacts: approved.emergencyContacts,
    },
  });
}

export async function POST(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
