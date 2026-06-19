import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import {
  conflict,
  error,
  forbiddenResponse,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { recordCareReportPrintAudit } from '@/server/services/export-audit';
import { canAccessCareReportSource } from '@/server/services/care-report-access';

export const runtime = 'nodejs';

const printAuditSchema = z.object({
  intent: z.enum(['preview_rendered', 'print_requested']).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canSendCareReport',
    message: '報告書の印刷権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('報告書IDが不正です'));
  const payload = await readOptionalJsonObjectRequestBody(req);
  const parsedIntent = printAuditSchema.safeParse(payload ?? {});
  if (!parsedIntent.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsedIntent.error.flatten().fieldErrors),
    );
  }
  const intent = parsedIntent.data.intent ?? 'print_requested';

  const report = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      status: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
    },
  });
  if (!report) return withSensitiveNoStore(notFound('報告書が見つかりません'));
  if (report.status !== 'confirmed') {
    return withSensitiveNoStore(conflict('薬剤師確認済みの報告書のみ印刷できます'));
  }
  if (
    !(await canAccessCareReportSource(prisma, ctx.orgId, ctx, {
      patientId: report.patient_id,
      caseId: report.case_id,
      visitRecordId: report.visit_record_id,
    }))
  ) {
    return withSensitiveNoStore(await forbiddenResponse('この報告書を印刷する権限がありません'));
  }

  // Re-read the printable payload after the access check so a status change
  // between checks fails closed before audit persistence and content output.
  const printReport = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId, status: 'confirmed' },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
      report_type: true,
      content: true,
      updated_at: true,
    },
  });
  if (!printReport) {
    return withSensitiveNoStore(conflict('薬剤師確認済みの報告書のみ印刷できます'));
  }
  if (
    !(await canAccessCareReportSource(prisma, ctx.orgId, ctx, {
      patientId: printReport.patient_id,
      caseId: printReport.case_id,
      visitRecordId: printReport.visit_record_id,
    }))
  ) {
    return withSensitiveNoStore(await forbiddenResponse('この報告書を印刷する権限がありません'));
  }

  try {
    await recordCareReportPrintAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      reportId: id,
      intent,
      reportUpdatedAt: printReport.updated_at,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  } catch {
    return withSensitiveNoStore(
      error('PRINT_AUDIT_FAILED', '報告書の印刷監査を記録できませんでした', 500),
    );
  }

  return withSensitiveNoStore(
    success({
      data: {
        audited: true,
        report: {
          id: printReport.id,
          report_type: printReport.report_type,
          content: printReport.content,
        },
      },
    }),
  );
}
