import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { buildVisitScheduleBillingPreviewBatch } from '@/server/services/visit-schedule-billing-preview';
import { z } from 'zod';

const batchPreviewSchema = z.object({
  items: z.array(
    z.object({
      key: z.string().min(1),
      case_id: z.string().min(1),
      proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      pharmacist_id: z.string().optional(),
      visit_type: z.string().optional(),
    }),
  ).min(1).max(100),
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = batchPreviewSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  return success({
    data: await buildVisitScheduleBillingPreviewBatch(
      parsed.data.items.map((item) => ({
        key: item.key,
        caseId: item.case_id,
        proposedDate: item.proposed_date,
        pharmacistId: item.pharmacist_id,
        visitType: item.visit_type,
      })),
      req.orgId,
    ),
  });
});
