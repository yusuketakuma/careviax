import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { success, validationError, notFound, forbiddenResponse } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { listFieldRevisionsBySourceVisitRecord } from '@/server/services/patient-field-revision-list';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      schedule: {
        select: {
          pharmacist_id: true,
          case_: { select: { primary_pharmacist_id: true, backup_pharmacist_id: true } },
        },
      },
    },
  });

  if (!record) return notFound('訪問記録が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, record.schedule)) {
    return forbiddenResponse('この訪問記録を閲覧する権限がありません');
  }

  const revisions = await listFieldRevisionsBySourceVisitRecord(prisma, {
    orgId: ctx.orgId,
    sourceVisitRecordId: id,
  });

  return success({ data: revisions });
}
