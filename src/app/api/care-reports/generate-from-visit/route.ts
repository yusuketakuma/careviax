import { withAuthContext } from '@/lib/auth/context';
import {
  conflict,
  forbiddenResponse,
  success,
  validationError,
  notFound,
} from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import type { GeneratedCareReportFromVisitResponse } from '@/lib/reports/generate-from-visit-contract';
import { generateReportsFromVisit } from '@/server/services/report-generator';
import { z } from 'zod';

const generateFromVisitSchema = z
  .object({
    visit_record_id: z.string().trim().min(1, '訪問記録IDは必須です'),
    expected_visit_record_updated_at: z.string().datetime('訪問記録の版情報が不正です'),
    expected_report_updated_at: z.string().datetime('報告書下書きの版情報が不正です').optional(),
    // p1_04: 主治医/ケアマネに加え、訪問看護(nurse_share)/施設(facility_handoff)の
    // 宛先別下書きも明示要求で生成できる(report-generator が4宛先を射影する)。
    report_type: z
      .enum(['physician_report', 'care_manager_report', 'nurse_share', 'facility_handoff'])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.expected_report_updated_at && !value.report_type) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected_report_updated_at'],
        message: '報告書下書きの版情報はreport_type指定時のみ使用できます',
      });
    }
  });

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = generateFromVisitSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      visit_record_id,
      expected_visit_record_updated_at,
      expected_report_updated_at,
      report_type,
    } = parsed.data;

    let result: {
      reports: Array<{ id: string; report_type: string; status: string; updated_at: Date }>;
    };
    try {
      result = await generateReportsFromVisit(
        ctx.orgId,
        ctx.userId,
        visit_record_id,
        report_type,
        {
          userId: ctx.userId,
          role: ctx.role,
        },
        {
          expectedVisitRecordUpdatedAt: new Date(expected_visit_record_updated_at),
          expectedReportUpdatedAt: expected_report_updated_at
            ? new Date(expected_report_updated_at)
            : null,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        return notFound(message);
      }
      if (message.includes('not accessible')) {
        return forbiddenResponse('この訪問記録から報告書を生成する権限がありません');
      }
      if (message === 'VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORT') {
        return validationError('報告書を生成するには訪問予定と処方サイクルの紐付けが必要です');
      }
      if (message === 'STRUCTURED_SOAP_REQUIRED_FOR_REPORT') {
        return validationError('報告書を生成するには訪問時の構造化SOAP記録が必要です');
      }
      if (message === 'MEDICATION_CYCLE_NOT_FOUND_FOR_REPORT') {
        return validationError('報告書を生成する処方サイクルが見つかりません');
      }
      if (message === 'VISIT_RECORD_STALE_FOR_REPORT_GENERATION') {
        return conflict('訪問記録が同時に更新されました。再読み込みしてください');
      }
      if (message === 'CARE_REPORT_DRAFT_STALE_FOR_REPORT_GENERATION') {
        return conflict('報告書下書きが同時に更新されました。再読み込みしてください');
      }
      if (message === 'CARE_REPORT_DRAFT_VERSION_REQUIRED_FOR_REPORT_GENERATION') {
        return conflict(
          '既存の報告書下書きがあります。下書き詳細を再読み込みしてから個別に再生成してください',
        );
      }
      throw err;
    }

    const responseBody = {
      data: result.reports.map((report) => ({
        ...report,
        updated_at: report.updated_at.toISOString(),
      })),
    } satisfies GeneratedCareReportFromVisitResponse;

    return success(responseBody, 201);
  },
  {
    permission: 'canAuthorReport',
    message: '報告書生成の権限がありません',
  },
);
