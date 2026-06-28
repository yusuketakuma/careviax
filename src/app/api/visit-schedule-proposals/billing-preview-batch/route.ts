import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
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

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
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

    const accessWhereByCheck = accessChecks.map((item) => ({
      ...item,
      caseAccessWhere: buildVisitScheduleProposalCaseAccessWhere(ctx, item.pharmacistId),
    }));
    const allChecksUseOrgScope = accessWhereByCheck.every((item) => item.caseAccessWhere === null);
    const accessibleCaseIds = allChecksUseOrgScope
      ? new Set(
          (
            await prisma.careCase.findMany({
              where: {
                id: { in: accessWhereByCheck.map((item) => item.caseId) },
                org_id: ctx.orgId,
              },
              select: { id: true },
            })
          ).map((careCase) => careCase.id),
        )
      : new Set(
          (
            await Promise.all(
              accessWhereByCheck.map((item) =>
                prisma.careCase.findFirst({
                  where: {
                    id: item.caseId,
                    org_id: ctx.orgId,
                    ...(item.caseAccessWhere ? { AND: [item.caseAccessWhere] } : {}),
                  },
                  select: { id: true },
                }),
              ),
            )
          )
            .filter((careCase): careCase is { id: string } => careCase !== null)
            .map((careCase) => careCase.id),
        );
    if (accessWhereByCheck.some((item) => !accessibleCaseIds.has(item.caseId))) {
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
        ctx.orgId,
      ),
    });
  },
  {
    permission: 'canVisit',
    message: '訪問候補の算定プレビュー権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
