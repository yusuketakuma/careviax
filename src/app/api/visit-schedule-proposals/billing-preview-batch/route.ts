import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError, notFound } from '@/lib/api/response';
import { buildVisitScheduleProposalCaseAccessWhere } from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { buildVisitScheduleBillingPreviewBatch } from '@/server/services/visit-schedule-billing-preview';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { z } from 'zod';

const proposedDateSchema = visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）');

const batchPreviewSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        case_id: z.string().min(1),
        proposed_date: proposedDateSchema,
        pharmacist_id: z.string().optional(),
        site_id: z.string().optional(),
        visit_type: z.string().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = batchPreviewSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const accessChecks = Array.from(
      new Map(
        parsed.data.items.map((item) => [
          `${item.case_id}:${item.pharmacist_id ?? ''}`,
          {
            caseId: item.case_id,
            pharmacistId: item.pharmacist_id,
          },
        ]),
      ).values(),
    );

    const accessibleCases = await Promise.all(
      accessChecks.map((item) => {
        const caseAccessWhere = buildVisitScheduleProposalCaseAccessWhere(req, item.pharmacistId);
        return prisma.careCase.findFirst({
          where: {
            id: item.caseId,
            org_id: req.orgId,
            ...(caseAccessWhere ? { AND: [caseAccessWhere] } : {}),
          },
          select: { id: true },
        });
      }),
    );
    if (accessibleCases.some((careCase) => careCase === null)) {
      return notFound('ケースが見つかりません');
    }

    return success({
      data: await buildVisitScheduleBillingPreviewBatch(
        parsed.data.items.map((item) => ({
          key: item.key,
          caseId: item.case_id,
          proposedDate: item.proposed_date,
          pharmacistId: item.pharmacist_id,
          siteId: item.site_id,
          visitType: item.visit_type,
        })),
        req.orgId,
      ),
    });
  },
  {
    permission: 'canVisit',
    message: '訪問候補の算定プレビュー権限がありません',
  },
);
