import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildVisitScheduleProposalCaseAccessWhere } from '@/lib/auth/visit-schedule-access';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { withOrgContext } from '@/lib/db/rls';
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
        exclude_schedule_id: z.string().optional(),
        exclude_proposal_id: z.string().optional(),
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

    const pharmacistIds = Array.from(
      new Set(
        parsed.data.items
          .map((item) => item.pharmacist_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    if (pharmacistIds.length > 0) {
      const pharmacistRefResult = await validateOrgReferences(ctx.orgId, {
        pharmacist_ids: pharmacistIds,
      });
      if (!pharmacistRefResult.ok) return pharmacistRefResult.response;
    }
    const siteIds = Array.from(
      new Set(
        parsed.data.items
          .map((item) => item.site_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    for (const siteId of siteIds) {
      const siteRefResult = await validateOrgReferences(ctx.orgId, { site_id: siteId });
      if (!siteRefResult.ok) return siteRefResult.response;
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
    const accessCheckKey = (item: { caseId: string; pharmacistId?: string | null }) =>
      `${item.caseId}:${item.pharmacistId ?? ''}`;

    const accessWhereByCheck = accessChecks.map((item) => ({
      ...item,
      caseAccessWhere: buildVisitScheduleProposalCaseAccessWhere(ctx, item.pharmacistId),
    }));
    const allChecksUseOrgScope = accessWhereByCheck.every((item) => item.caseAccessWhere === null);
    const data = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const accessibleCheckKeys = allChecksUseOrgScope
          ? new Set(
              (
                await tx.careCase.findMany({
                  where: {
                    id: { in: accessWhereByCheck.map((item) => item.caseId) },
                    org_id: ctx.orgId,
                  },
                  select: { id: true },
                })
              ).flatMap((careCase) =>
                accessWhereByCheck
                  .filter((item) => item.caseId === careCase.id)
                  .map((item) => accessCheckKey(item)),
              ),
            )
          : new Set(
              (
                await Promise.all(
                  accessWhereByCheck.map(async (item) => {
                    const careCase = await tx.careCase.findFirst({
                      where: {
                        id: item.caseId,
                        org_id: ctx.orgId,
                        ...(item.caseAccessWhere ? { AND: [item.caseAccessWhere] } : {}),
                      },
                      select: { id: true },
                    });
                    return careCase ? accessCheckKey(item) : null;
                  }),
                )
              ).filter((key): key is string => key !== null),
            );
        if (accessWhereByCheck.some((item) => !accessibleCheckKeys.has(accessCheckKey(item)))) {
          return null;
        }

        return buildVisitScheduleBillingPreviewBatch(
          parsed.data.items.map((item) => ({
            key: item.key,
            caseId: item.case_id,
            proposedDate: item.proposed_date,
            pharmacistId: item.pharmacist_id,
            siteId: item.site_id,
            visitType: item.visit_type,
            excludeScheduleId: item.exclude_schedule_id,
            excludeProposalId: item.exclude_proposal_id,
          })),
          ctx.orgId,
          { db: tx },
        );
      },
      { requestContext: ctx },
    );
    if (!data) return notFound('ケースが見つかりません');

    return success({ data });
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
