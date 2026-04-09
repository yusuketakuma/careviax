import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { error, success, validationError } from '@/lib/api/response';
import { closeBillingCandidatesForMonth } from '@/server/services/billing-evidence';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '請求月次締めの権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const billingMonth = (body as { billing_month?: string }).billing_month;
  if (!billingMonth) return validationError('billing_month は必須です');

  const billingMonthDate = new Date(billingMonth);
  if (Number.isNaN(billingMonthDate.getTime())) {
    return validationError('billing_month の形式が不正です（YYYY-MM-DD）');
  }

  const result = await withOrgContext(ctx.orgId, (tx) =>
    closeBillingCandidatesForMonth(tx, {
      orgId: ctx.orgId,
      billingMonth: billingMonthDate,
      actorId: ctx.userId,
    })
  );

  if (result.blocked) {
    return error(
      'BILLING_CLOSE_BLOCKED',
      '未確認の請求候補が残っているため月次締めできません',
      409,
      {
        summary: result.summary,
        blockingCount: result.blockingCount,
      }
    );
  }

  await notifyWebhookEventForOrg(ctx.orgId, 'billing.exported', {
    billingMonth: billingMonthDate.toISOString(),
    exportedCount: result.exported_count,
  });

  return success({
    message: `${billingMonth} を月次締めしました`,
    exported_count: result.exported_count,
    summary: result.summary,
  });
}
