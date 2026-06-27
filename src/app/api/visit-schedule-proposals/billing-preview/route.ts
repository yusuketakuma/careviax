import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildVisitScheduleProposalCaseAccessWhere } from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { buildVisitScheduleBillingPreview } from '@/server/services/visit-schedule-billing-preview';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';

const proposedDateSchema = visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）');

const authenticatedGET = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const caseId = searchParams.get('case_id');
    const proposedDate = searchParams.get('proposed_date');
    const pharmacistId = searchParams.get('pharmacist_id');
    const siteId = searchParams.get('site_id');
    const visitTypeParam = searchParams.get('visit_type');

    if (!caseId || !proposedDate) {
      return validationError('case_id と proposed_date が必要です');
    }
    const parsedProposedDate = proposedDateSchema.safeParse(proposedDate);
    if (!parsedProposedDate.success) {
      return validationError('入力値が不正です', {
        proposed_date: ['日付形式が不正です（YYYY-MM-DD）'],
      });
    }

    const caseAccessWhere = buildVisitScheduleProposalCaseAccessWhere(ctx, pharmacistId);
    const accessibleCase = await prisma.careCase.findFirst({
      where: {
        id: caseId,
        org_id: ctx.orgId,
        ...(caseAccessWhere ? { AND: [caseAccessWhere] } : {}),
      },
      select: { id: true },
    });
    if (!accessibleCase) return notFound('ケースが見つかりません');

    const preview = await buildVisitScheduleBillingPreview({
      orgId: ctx.orgId,
      caseId,
      proposedDate: parsedProposedDate.data,
      pharmacistId,
      siteId,
      visitType: visitTypeParam,
    });
    if (!preview) return notFound('ケースが見つかりません');

    return success(preview);
  },
  {
    permission: 'canVisit',
    message: '訪問候補の算定プレビュー権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
