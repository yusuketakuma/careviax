import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { notFound, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getPatientVisitBrief } from '@/server/services/visit-brief';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者要約の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
    },
    select: { id: true },
  });

  if (!patient) return notFound('患者が見つかりません');

  const brief = await getPatientVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: id,
    context: 'patient',
  });

  return success({ data: brief });
}
