import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import {
  conflict,
  error,
  forbiddenResponse,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  careReportPrintAuditRequestSchema,
  isPrintableCareReportContent,
  isPrintableCareReportType,
  type CareReportPrintAuditResponse,
  type CareReportPrintAuditPrintableReport,
} from '@/lib/reports/care-report-print-audit-contract';
import { recordCareReportPrintAudit } from '@/server/services/export-audit';
import { canAccessCareReportSource } from '@/server/services/care-report-access';

export const runtime = 'nodejs';

type PrintAuditRouteContext = { params: Promise<{ id: string }> };

async function authenticatedPOST(req: NextRequest, { params }: PrintAuditRouteContext) {
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
  const parsedIntent = careReportPrintAuditRequestSchema.safeParse(payload ?? {});
  if (!parsedIntent.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsedIntent.error.flatten().fieldErrors),
    );
  }
  const intent = parsedIntent.data.intent ?? 'print_requested';
  const expectedReportUpdatedAt = parsedIntent.data.expected_report_updated_at
    ? new Date(parsedIntent.data.expected_report_updated_at)
    : null;

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
    intent === 'print_requested' &&
    expectedReportUpdatedAt &&
    printReport.updated_at.getTime() !== expectedReportUpdatedAt.getTime()
  ) {
    return withSensitiveNoStore(
      conflict('報告書が更新されています。再読み込みしてから印刷してください'),
    );
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
  if (!isPrintableCareReportType(printReport.report_type)) {
    return withSensitiveNoStore(conflict('印刷対象外の報告書です'));
  }
  if (printReport.content === null) {
    return withSensitiveNoStore(conflict('報告書本文がないため印刷できません'));
  }
  if (!isPrintableCareReportContent(printReport.report_type, printReport.content)) {
    return withSensitiveNoStore(conflict('印刷用の報告書形式が不正です'));
  }

  try {
    await recordCareReportPrintAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorSiteId: ctx.actorSiteId,
      patientId: printReport.patient_id,
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

  const responseBody = {
    data: {
      audited: true,
      report: {
        id: printReport.id,
        report_type: printReport.report_type,
        updated_at: printReport.updated_at.toISOString(),
        content: printReport.content as CareReportPrintAuditPrintableReport['content'],
      },
    },
  } satisfies CareReportPrintAuditResponse<CareReportPrintAuditPrintableReport>;

  return withSensitiveNoStore(success(responseBody));
}

export async function POST(req: NextRequest, routeContext: PrintAuditRouteContext) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
