import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { registeredError, success, validationError } from '@/lib/api/response';
import { closeBillingCandidatesForMonth } from '@/server/services/billing-evidence';
import { enqueueWebhookEvent } from '@/server/services/outbound-webhook-queue';
import { BILLING_DOMAIN_ERROR_MESSAGE, parseBillingDomainOrDefault } from '../billing-domain';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from '../billing-month';

function isBillingCloseStaleCandidatesError(cause: unknown) {
  return cause instanceof Error && cause.message === 'BILLING_CLOSE_STALE_CANDIDATE';
}

async function closeBillingMonth(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const billingMonth = payload.billing_month;
  if (!billingMonth) return validationError('billing_month は必須です');

  const parsedBillingMonth = parseStrictBillingMonth(billingMonth);
  if (!parsedBillingMonth) {
    return validationError(BILLING_MONTH_FORMAT_MESSAGE);
  }
  const billingDomain = parseBillingDomainOrDefault(payload.billing_domain);
  if (!billingDomain) {
    return validationError(BILLING_DOMAIN_ERROR_MESSAGE);
  }

  let result;
  try {
    result = await withOrgContext(ctx.orgId, async (tx) => {
      const closeResult = await closeBillingCandidatesForMonth(tx, {
        orgId: ctx.orgId,
        billingMonth: parsedBillingMonth.start,
        actorId: ctx.userId,
        billingDomain,
      });
      if (!closeResult.blocked) {
        await enqueueWebhookEvent(tx, {
          orgId: ctx.orgId,
          event: 'billing.exported',
          data: {
            billingMonth: parsedBillingMonth.start.toISOString(),
            billingDomain,
            exportedCount: closeResult.exported_count,
          },
        });
      }
      return closeResult;
    });
  } catch (cause) {
    if (isBillingCloseStaleCandidatesError(cause)) {
      return registeredError(
        'BILLING_CLOSE_STALE_CANDIDATES',
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してから月次締めしてください。',
        {
          billing_month: parsedBillingMonth.start.toISOString(),
          billing_domain: billingDomain,
          conflictCount: 1,
        },
      );
    }
    throw cause;
  }

  if (result.blocked) {
    return registeredError(
      'BILLING_CLOSE_BLOCKED',
      '未確認の請求候補が残っているため月次締めできません',
      {
        summary: result.summary,
        blockingCount: result.blockingCount,
      },
    );
  }

  return success({
    data: {
      message: `${parsedBillingMonth.canonical} を月次締めしました`,
      billing_domain: billingDomain,
      exported_count: result.exported_count,
      summary: result.summary,
    },
  });
}

export const POST = withAuthContext(closeBillingMonth, {
  permission: 'canManageBilling',
  message: '請求月次締めの権限がありません',
});
