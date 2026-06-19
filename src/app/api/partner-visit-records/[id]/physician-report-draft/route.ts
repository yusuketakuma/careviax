import { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import {
  createPartnerVisitPhysicianReportDraft,
  PartnerVisitPhysicianReportDraftError,
} from '@/server/services/partner-visit-report-drafts';

function draftErrorResponse(error: PartnerVisitPhysicianReportDraftError) {
  switch (error.code) {
    case 'PARTNER_VISIT_RECORD_NOT_FOUND':
      return notFound(error.message);
    case 'PARTNER_VISIT_RECORD_NOT_CONFIRMED':
    case 'PARTNER_VISIT_SOURCE_INACTIVE':
      return conflict(error.message, error.details);
  }
}

export const POST = withAuthContext<{ id: string }>(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) {
      return withSensitiveNoStore(validationError('協力訪問記録IDが不正です'));
    }

    try {
      const result = await withOrgContext(
        ctx.orgId,
        (tx) => createPartnerVisitPhysicianReportDraft(tx, ctx, { partnerVisitRecordId: id }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return withSensitiveNoStore(
        success(
          {
            message: result.reused
              ? '既存の医師向け報告書ドラフトを返しました'
              : '医師向け報告書ドラフトを作成しました',
            reused_existing_draft: result.reused,
            report: result.report,
          },
          result.reused ? 200 : 201,
        ),
      );
    } catch (error) {
      if (error instanceof PartnerVisitPhysicianReportDraftError) {
        return withSensitiveNoStore(draftErrorResponse(error));
      }
      throw error;
    }
  },
  {
    permission: 'canAuthorReport',
    message: '医師向け報告書の作成権限がありません',
  },
);
