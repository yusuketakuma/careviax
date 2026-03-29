import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, validationError } from '@/lib/api/response';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'リスケ承認の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const override = await prisma.visitScheduleOverride.findFirst({
    where: {
      org_id: ctx.orgId,
      source_schedule_id: id,
    },
    include: {
      source_schedule: {
        select: {
          id: true,
          pharmacist_id: true,
          case_id: true,
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
    return success({ data: override });
  }

  const approved = await withOrgContext(ctx.orgId, async (tx) => {
    const updated = await tx.visitScheduleOverride.update({
      where: {
        id: override.id,
      },
      data: {
        approved_by: ctx.userId,
        approved_at: new Date(),
      },
    });

    await tx.visitSchedule.update({
      where: {
        id,
      },
      data: {
        schedule_status: 'rescheduled',
        version: { increment: 1 },
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
    const emergencyContacts = await tx.contactParty.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: override.source_schedule.case_.patient_id,
        is_emergency_contact: true,
      },
      select: {
        id: true,
        name: true,
        relation: true,
        phone: true,
        email: true,
        fax: true,
        is_primary: true,
        organization_name: true,
        notes: true,
      },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    });

    return { updated, emergencyContacts };
  }, { requestContext: ctx });

  return success({
    data: {
      ...approved.updated,
      // FVD-01C: Emergency contacts provided as default recipients for post-approval patient/family notification
      suggested_contacts: approved.emergencyContacts,
    },
  });
}
