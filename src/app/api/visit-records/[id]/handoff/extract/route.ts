import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import {
  success,
  notFound,
  error,
  validationError,
  conflict,
  forbiddenResponse,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import {
  processHandoffExtraction,
  VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
  VisitHandoffStaleRecordError,
} from '@/server/services/visit-handoff';
import type { StructuredSoap } from '@/types/structured-soap';

const visitRecordHandoffExtractionSelect = {
  id: true,
  patient_id: true,
  soap_assessment: true,
  soap_plan: true,
  structured_soap: true,
  version: true,
  schedule: {
    select: {
      pharmacist_id: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  },
} as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('訪問記録IDが不正です'));

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: visitRecordHandoffExtractionSelect,
  });
  if (!record) return withSensitiveNoStore(notFound('訪問記録が見つかりません'));

  if (!canAccessVisitScheduleAssignment(ctx, record.schedule)) {
    return withSensitiveNoStore(await forbiddenResponse('この訪問記録を更新する権限がありません'));
  }

  if (
    !record.structured_soap ||
    typeof record.structured_soap !== 'object' ||
    Array.isArray(record.structured_soap)
  ) {
    return withSensitiveNoStore(error('no_structured_soap', '構造化SOAPデータがありません', 422));
  }

  const patient = await prisma.patient.findFirst({
    where: { id: record.patient_id, org_id: ctx.orgId },
    select: { name: true },
  });
  if (!patient) return withSensitiveNoStore(notFound('患者情報が見つかりません'));

  try {
    const handoff = await processHandoffExtraction(prisma, {
      orgId: ctx.orgId,
      visitRecordId: id,
      patientId: record.patient_id,
      patientName: patient.name,
      structuredSoap: record.structured_soap as StructuredSoap,
      soapAssessment: record.soap_assessment ?? null,
      soapPlan: record.soap_plan ?? null,
      expectedVersion: record.version,
      requestContext: ctx,
    });
    return withSensitiveNoStore(success(handoff, 201));
  } catch (cause) {
    if (cause instanceof VisitHandoffStaleRecordError) {
      return withSensitiveNoStore(
        conflict('訪問記録が更新されています。再読み込みしてから申し送り抽出をやり直してください'),
      );
    }
    return withSensitiveNoStore(
      error('extraction_failed', VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE, 500, {
        extraction: { status: 'failed', retryable: true },
      }),
    );
  }
}
