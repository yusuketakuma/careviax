import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, notFound, error, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  createQualificationCheckAdapter,
  QualificationCheckAdapterError,
} from '@/server/adapters/qualification-check';
import { format } from 'date-fns';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { resolvePatientInsurance } from '@/server/services/patient-insurance';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '資格確認の実行権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: {
      id: true,
      medical_insurance_number: true,
      care_insurance_number: true,
    },
  });
  if (!patient) return notFound('患者が見つかりません');

  const activeMedicalInsurance = await resolvePatientInsurance(prisma, {
    orgId: ctx.orgId,
    patientId: patient.id,
    type: 'medical',
  });
  const insuranceNumber = activeMedicalInsurance?.number ?? patient.medical_insurance_number;

  const adapter = createQualificationCheckAdapter({
    provider: (process.env.OQC_PROVIDER as 'stub' | 'mhlw') ?? 'stub',
    baseUrl: process.env.OQC_BASE_URL,
    clientId: process.env.OQC_CLIENT_ID,
    clientSecret: process.env.OQC_CLIENT_SECRET,
    accessToken: process.env.OQC_ACCESS_TOKEN,
  });

  try {
    const result = await adapter.checkInsurance({
      insuranceNumber: insuranceNumber ?? undefined,
      asOfDate: format(new Date(), 'yyyy-MM-dd'),
    });

    await notifyWebhookEventForOrg(ctx.orgId, 'qualification.checked', {
      patientId: patient.id,
      checkedAt: new Date().toISOString(),
      insuranceNumberPresent: Boolean(insuranceNumber),
    });

    return success({ data: result, capabilities: adapter.getCapabilities() });
  } catch (cause) {
    if (cause instanceof QualificationCheckAdapterError) {
      if (cause.code === 'NOT_IMPLEMENTED') {
        return error('OQC_NOT_ENABLED', cause.message, 501);
      }
      if (cause.code === 'UNAUTHORIZED') {
        return error('OQC_UNAUTHORIZED', cause.message, 502);
      }
      return error('OQC_UPSTREAM_FAILURE', cause.message, 502);
    }
    throw cause;
  }
}
