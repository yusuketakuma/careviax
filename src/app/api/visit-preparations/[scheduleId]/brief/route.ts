import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { notFound, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getScheduleVisitBrief } from '@/server/services/visit-brief';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問要約の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: scheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_: {
        select: {
          patient_id: true,
        },
      },
    },
  });

  if (!schedule) return notFound('訪問予定が見つかりません');

  const brief = await getScheduleVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient_id,
  });

  return success({ data: brief });
}
