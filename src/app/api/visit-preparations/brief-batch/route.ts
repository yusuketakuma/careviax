import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { forbiddenResponse, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getScheduleVisitBriefsForSchedules } from '@/server/services/visit-brief';
import type { VisitBrief } from '@/types/visit-brief';

const briefBatchSchema = z.object({
  schedule_ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問要約の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = briefBatchSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const scheduleIds = Array.from(new Set(parsed.data.schedule_ids));
  const schedules = await prisma.visitSchedule.findMany({
    where: {
      id: { in: scheduleIds },
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

  if (schedules.length !== scheduleIds.length) {
    return notFound('訪問予定が見つかりません');
  }

  const inaccessible = schedules.find(
    (schedule) => !canAccessVisitScheduleAssignment(ctx, schedule),
  );
  if (inaccessible) {
    return forbiddenResponse('この訪問予定の要約を閲覧する権限がありません');
  }

  const briefsByScheduleId = await getScheduleVisitBriefsForSchedules(prisma, {
    schedules: schedules.map((schedule) => ({
      scheduleId: schedule.id,
      orgId: ctx.orgId,
      patientId: schedule.case_.patient_id,
      caseId: schedule.case_id,
    })),
  });

  const data: Record<string, VisitBrief> = {};
  for (const schedule of schedules) {
    const brief = briefsByScheduleId.get(schedule.id);
    if (!brief) return notFound('患者が見つかりません');
    data[schedule.id] = brief;
  }

  return success({ data });
}
