import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, notFound, error, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { processHandoffExtraction } from '@/server/services/visit-handoff';
import type { StructuredSoap } from '@/types/structured-soap';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      patient_id: true,
      soap_assessment: true,
      soap_plan: true,
      structured_soap: true,
    },
  });
  if (!record) return notFound('訪問記録が見つかりません');

  if (
    !record.structured_soap ||
    typeof record.structured_soap !== 'object' ||
    Array.isArray(record.structured_soap)
  ) {
    return error('no_structured_soap', '構造化SOAPデータがありません', 422);
  }

  const patient = await prisma.patient.findFirst({
    where: { id: record.patient_id, org_id: ctx.orgId },
    select: { name: true },
  });
  if (!patient) return notFound('患者情報が見つかりません');

  try {
    const handoff = await processHandoffExtraction(prisma, {
      orgId: ctx.orgId,
      visitRecordId: id,
      patientId: record.patient_id,
      patientName: patient.name,
      structuredSoap: record.structured_soap as StructuredSoap,
      soapAssessment: record.soap_assessment ?? null,
      soapPlan: record.soap_plan ?? null,
      requestContext: ctx,
    });
    return success(handoff, 201);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'AI抽出に失敗しました';
    return error('extraction_failed', message, 500);
  }
}
