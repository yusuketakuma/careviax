import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError, notFound } from '@/lib/api/response';
import { buildVisitScheduleProposalCaseAccessWhere } from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { buildVisitScheduleBillingPreview } from '@/server/services/visit-schedule-billing-preview';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const caseId = searchParams.get('case_id');
    const proposedDate = searchParams.get('proposed_date');
    const pharmacistId = searchParams.get('pharmacist_id');
    const siteId = searchParams.get('site_id');
    const visitTypeParam = searchParams.get('visit_type');

    if (!caseId || !proposedDate) {
      return validationError('case_id と proposed_date が必要です');
    }

    const caseAccessWhere = buildVisitScheduleProposalCaseAccessWhere(req, pharmacistId);
    const accessibleCase = await prisma.careCase.findFirst({
      where: {
        id: caseId,
        org_id: req.orgId,
        ...(caseAccessWhere ? { AND: [caseAccessWhere] } : {}),
      },
      select: { id: true },
    });
    if (!accessibleCase) return notFound('ケースが見つかりません');

    const preview = await buildVisitScheduleBillingPreview({
      orgId: req.orgId,
      caseId,
      proposedDate,
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
