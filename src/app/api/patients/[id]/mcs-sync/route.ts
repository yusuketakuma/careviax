import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import {
  conflict,
  error,
  forbidden,
  internalError,
  validationError,
  success,
} from '@/lib/api/response';
import { syncPatientMcsSchema } from '@/lib/validations/patient-mcs';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { PatientMcsSyncError, syncPatientMcsTimeline } from '@/server/services/patient-mcs';
import { canViewSensitivePatientData } from '@/lib/patient/sensitive';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

export const runtime = 'nodejs';

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

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

    return error('PATIENT_MCS_SYNC_FAILED', 'MCS 同期に失敗しました', 502);
  }
}

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
