import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { forbiddenResponse, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { getScheduleVisitBrief } from '@/server/services/visit-brief';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問要約の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId: rawScheduleId } = await params;
  const scheduleId = normalizeRequiredRouteParam(rawScheduleId);
  if (!scheduleId) return validationError('訪問予定IDが不正です');

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: scheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      pharmacist_id: true,
      case_: {
        select: {
          patient_id: true,
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  });

  if (!schedule) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定の要約を閲覧する権限がありません');
  }

  const brief = await getScheduleVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient_id,
    caseIds: [schedule.case_id],
  });

  return success({ data: brief });
}
