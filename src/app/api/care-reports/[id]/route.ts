import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';

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
  status: z
    .enum(['draft', 'sent', 'failed', 'confirmed', 'response_waiting'])
    .optional(),
  content: z.record(z.string(), z.unknown()).transform((v) => v as import('@prisma/client').Prisma.InputJsonValue).optional(),
  template_id: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    },
  });

  if (!report) return notFound('報告書が見つかりません');

  // case_id がある場合は intake baseline context を付加してUIでの表示に利用する
  let intakeBaselineContext: ReturnType<typeof getHomeVisitIntake> = null;
  if (report.case_id) {
    const careCase = await prisma.careCase.findFirst({
      where: { id: report.case_id, org_id: ctx.orgId },
      select: { required_visit_support: true },
    });
    intakeBaselineContext = getHomeVisitIntake(careCase?.required_visit_support);
  }

  return success({ data: { ...report, intake_baseline_context: intakeBaselineContext } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    select: { id: true, status: true },
  });
  if (!existing) return notFound('報告書が見つかりません');

  if (existing.status !== 'draft' && parsed.data.status === 'draft') {
    return conflict('送信済みの報告書を下書きへ戻すことはできません');
  }

  const report = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.careReport.update({
      where: { id },
      data: parsed.data,
    });
  }, { requestContext: ctx });

  return success({ data: report });
}
