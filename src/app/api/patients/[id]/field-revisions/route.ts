import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listPatientFieldRevisions } from '@/server/services/patient-field-revision-list';
import { z } from 'zod';

const fieldRevisionQuerySchema = z.object({
  limit: boundedIntegerSearchParam('limit', 1, 200, 50),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? undefined;
  const parsedQuery = parseSearchParams(fieldRevisionQuerySchema, url.searchParams);
  if (!parsedQuery.ok) {
    return validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors);
  }

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role }
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const revisions = await listPatientFieldRevisions(prisma, {
    orgId: ctx.orgId,
    patientId: id,
    category,
    limit: parsedQuery.data.limit,
  });

  return success({ data: revisions });
}
