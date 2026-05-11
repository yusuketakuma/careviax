import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import {
  conflict,
  forbiddenResponse,
  success,
  validationError,
  notFound,
} from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';
import { getChannelStatsByName, getRecommendedChannels } from '@/lib/contact-profiles';
import {
  inferCareReportTargetRole,
  resolveDocumentDeliveryRule,
} from '@/lib/reports/document-delivery-rules';
import { canAccessCareReportSource } from '@/server/services/care-report-access';

const updateCareReportSchema = z.object({
  report_type: z
    .enum([
      'physician_report',
      'care_manager_report',
      'facility_handoff',
      'nurse_share',
      'family_share',
      'internal_record',
    ])
    .optional(),
  status: z.enum(['draft', 'sent', 'failed', 'confirmed', 'response_waiting']).optional(),
  content: z
    .record(z.string(), z.unknown())
    .transform((v) => v as import('@prisma/client').Prisma.InputJsonValue)
    .optional(),
  template_id: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const report = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      delivery_records: {
        orderBy: { created_at: 'desc' },
      },
      case_: {
        select: { required_visit_support: true },
      },
    },
  });

  if (!report) return notFound('報告書が見つかりません');
  if (
    !(await canAccessCareReportSource(prisma, ctx.orgId, ctx, {
      patientId: report.patient_id,
      caseId: report.case_id,
      visitRecordId: report.visit_record_id,
    }))
  ) {
    return forbiddenResponse('この報告書を閲覧する権限がありません');
  }

  // case_id がある場合は intake baseline context を付加してUIでの表示に利用する
  const intakeBaselineContext = getHomeVisitIntake(report.case_?.required_visit_support ?? null);
  const prescriberInstitutionSuggestion = await findLatestPrescriberInstitutionSuggestion(
    prisma,
    ctx.orgId,
    {
      caseId: report.case_id,
      patientId: report.patient_id,
    },
  );
  const prescriberInstitutionStats =
    prescriberInstitutionSuggestion != null
      ? await getChannelStatsByName(prisma, ctx.orgId, [prescriberInstitutionSuggestion.name])
      : new Map();
  const deliveryRuleSuggestion = await resolveDocumentDeliveryRule({
    orgId: ctx.orgId,
    documentType: 'care_report',
    targetRole: inferCareReportTargetRole(report.report_type),
  });

  const reportData = Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'case_'));

  return success({
    data: {
      ...reportData,
      intake_baseline_context: intakeBaselineContext,
      delivery_rule_suggestion: deliveryRuleSuggestion,
      prescriber_institution_suggestion: prescriberInstitutionSuggestion
        ? {
            ...prescriberInstitutionSuggestion,
            recommended_channels: getRecommendedChannels({
              phone: prescriberInstitutionSuggestion.phone,
              fax: prescriberInstitutionSuggestion.fax,
              address: prescriberInstitutionSuggestion.address,
              stats: prescriberInstitutionStats.get(prescriberInstitutionSuggestion.name),
            }),
            prescribed_date: prescriberInstitutionSuggestion.prescribed_date.toISOString(),
          }
        : null,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  if (parsed.data.status && parsed.data.status !== 'draft') {
    return conflict('報告書の送信状態は送信APIからのみ更新できます');
  }

  const existing = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      status: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
    },
  });
  if (!existing) return notFound('報告書が見つかりません');
  if (
    !(await canAccessCareReportSource(prisma, ctx.orgId, ctx, {
      patientId: existing.patient_id,
      caseId: existing.case_id,
      visitRecordId: existing.visit_record_id,
    }))
  ) {
    return forbiddenResponse('この報告書を更新する権限がありません');
  }

  if (existing.status !== 'draft' && parsed.data.status === 'draft') {
    return conflict('送信済みの報告書を下書きへ戻すことはできません');
  }

  const report = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.careReport.update({
        where: { id },
        data: parsed.data,
      });
    },
    { requestContext: ctx },
  );

  return success({ data: report });
}
