import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { getPatientTimelineData } from '@/server/services/patient-detail';

export const GET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者IDが不正です');

    const timeline = await getPatientTimelineData(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      role: ctx.role,
      userId: ctx.userId,
    });
    if (!timeline) return notFound('患者が見つかりません');

    return success(timeline);
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);
