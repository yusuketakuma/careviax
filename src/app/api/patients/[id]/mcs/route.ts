import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { parseOptionalBoundedIntegerParam } from '@/lib/api/pagination';
import {
  getPatientMcsOverview,
  PATIENT_MCS_MAX_MESSAGE_LIMIT,
} from '@/server/services/patient-mcs';
import { canViewSensitivePatientData } from '@/lib/patient/sensitive';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'MCS 連携の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  if (!canViewSensitivePatientData(ctx.role)) {
    return forbidden('MCS 連携の閲覧権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const limitResult = parseOptionalBoundedIntegerParam(
    req.nextUrl.searchParams.get('limit'),
    0,
    PATIENT_MCS_MAX_MESSAGE_LIMIT,
  );
  if (!limitResult.ok) {
    return validationError(
      `limit は 0 から ${PATIENT_MCS_MAX_MESSAGE_LIMIT} の整数で指定してください`,
    );
  }
  const limit = limitResult.value;

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
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
