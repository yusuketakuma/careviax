import { withAuthContext } from '@/lib/auth/context';
import { notFound, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getPatientCommunicationsData } from '@/server/services/patient-detail';

export const GET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id } = await params;

    const communications = await getPatientCommunicationsData(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      role: ctx.role,
    });
    if (!communications) return notFound('患者が見つかりません');

    return success(communications);
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  }
);
