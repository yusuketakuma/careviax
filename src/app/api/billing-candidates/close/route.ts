import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { error, success, validationError } from '@/lib/api/response';
import { closeBillingCandidatesForMonth } from '@/server/services/billing-evidence';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from '../billing-month';

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '請求月次締めの権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const billingMonth = payload.billing_month;
  if (!billingMonth) return validationError('billing_month は必須です');

  const parsedBillingMonth = parseStrictBillingMonth(billingMonth);
  if (!parsedBillingMonth) {
    return validationError(BILLING_MONTH_FORMAT_MESSAGE);
  }

  const result = await withOrgContext(ctx.orgId, (tx) =>
    closeBillingCandidatesForMonth(tx, {
      orgId: ctx.orgId,
      billingMonth: parsedBillingMonth.start,
      actorId: ctx.userId,
      billingDomain: 'home_care',
    }),
  );

  if (result.blocked) {
    return error(
      'BILLING_CLOSE_BLOCKED',
      '未確認の請求候補が残っているため月次締めできません',
      409,
      {
        summary: result.summary,
        blockingCount: result.blockingCount,
      },
    );
  }

  await notifyWebhookEventForOrg(ctx.orgId, 'billing.exported', {
    billingMonth: parsedBillingMonth.start.toISOString(),
    exportedCount: result.exported_count,
  });

  return success({
    message: `${parsedBillingMonth.canonical} を月次締めしました`,
    exported_count: result.exported_count,
    summary: result.summary,
  });
}
