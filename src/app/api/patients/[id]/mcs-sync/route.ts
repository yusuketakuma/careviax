import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { conflict, error, forbidden, validationError, success, notFound } from '@/lib/api/response';
import { syncPatientMcsSchema } from '@/lib/validations/patient-mcs';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { PatientMcsSyncError, syncPatientMcsTimeline } from '@/server/services/patient-mcs';
import { canViewSensitivePatientData } from '@/lib/patient/sensitive';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'MCS 連携の同期権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  if (!canViewSensitivePatientData(ctx.role)) {
    return forbidden('MCS 連携の同期権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = syncPatientMcsSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  try {
    const result = await syncPatientMcsTimeline({
      orgId: ctx.orgId,
      patientId: id,
      userId: ctx.userId,
      sourceUrl: parsed.data.source_url,
    });

    return success({ data: result });
  } catch (cause) {
    if (cause instanceof PatientMcsSyncError) {
      if (cause.kind === 'validation') {
        return validationError(cause.message);
      }

      if (cause.kind === 'conflict') {
        return conflict(cause.message);
      }
    }

    const message = cause instanceof Error ? cause.message : 'MCS 同期に失敗しました';
    return error('PATIENT_MCS_SYNC_FAILED', message, 502);
  }
}
