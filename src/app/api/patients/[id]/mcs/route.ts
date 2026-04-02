import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getPatientMcsOverview } from '@/server/services/patient-mcs';
import { canViewSensitivePatientData } from '@/lib/patient/sensitive';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'MCS 連携の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  if (!canViewSensitivePatientData(ctx.role)) {
    return forbidden('MCS 連携の閲覧権限がありません');
  }

  const { id } = await params;
  const limitParam = req.nextUrl.searchParams.get('limit');
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsedLimit = Number(limitParam);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 0 || parsedLimit > 100) {
      return validationError('limit は 0 から 100 の整数で指定してください');
    }
    limit = parsedLimit;
  }
  const patient = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, name: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const data = await getPatientMcsOverview({
    orgId: ctx.orgId,
    patientId: id,
    limit,
  });

  return success({
    data: {
      patient,
      ...data,
    },
  });
}
