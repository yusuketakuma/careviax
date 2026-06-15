import { withAuthContext } from '@/lib/auth/context';
import { forbiddenResponse, success, validationError, notFound } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { generateReportsFromVisit } from '@/server/services/report-generator';
import { z } from 'zod';

const generateFromVisitSchema = z.object({
  visit_record_id: z.string().trim().min(1, '訪問記録IDは必須です'),
  // p1_04: 主治医/ケアマネに加え、訪問看護(nurse_share)/施設(facility_handoff)の
  // 宛先別下書きも明示要求で生成できる(report-generator が4宛先を射影する)。
  report_type: z
    .enum(['physician_report', 'care_manager_report', 'nurse_share', 'facility_handoff'])
    .optional(),
});

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = generateFromVisitSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { visit_record_id, report_type } = parsed.data;

    let result: { reports: Array<{ id: string; report_type: string }> };
    try {
      result = await generateReportsFromVisit(ctx.orgId, ctx.userId, visit_record_id, report_type, {
        userId: ctx.userId,
        role: ctx.role,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        return notFound(message);
      }
      if (message.includes('not accessible')) {
        return forbiddenResponse('この訪問記録から報告書を生成する権限がありません');
      }
      throw err;
    }

    return success({ data: result.reports }, 201);
  },
  {
    permission: 'canAuthorReport',
    message: '報告書生成の権限がありません',
  },
);
