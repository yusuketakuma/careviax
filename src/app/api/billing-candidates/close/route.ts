import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { readJsonObjectString } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { error, success, validationError } from '@/lib/api/response';
import { logger } from '@/lib/utils/logger';
import { closeBillingCandidatesForMonth } from '@/server/services/billing-evidence';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import {
  createClaimsExportAdapter,
  isClaimsExportConsumerConfigured,
  resolveClaimsExportConfig,
  type ClaimsExportRecord,
} from '@/server/adapters/claims-export';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from '../billing-month';

type ClaimsExportCloseOutcome =
  | { transmitted: false; reason: 'not_configured' }
  | { transmitted: true; recordCount: number }
  | { transmitted: false; reason: 'failed' };

/**
 * 月次締め完了後、レセコン consumer が構成済みであれば締め済み請求候補を
 * CLAIMS-XML として送信する（任意・副作用安全）。
 *
 * consumer 未構成時は何もせず締め処理を阻害しない。送信失敗も握りつぶし、
 * 締め自体は成功扱いのまま継続する（webhook 通知と同じ fire-and-forget 方針）。
 */
async function transmitClaimsExportForClose(args: {
  orgId: string;
  billingMonth: Date;
  billingDomain: string;
}): Promise<ClaimsExportCloseOutcome> {
  if (!isClaimsExportConsumerConfigured()) {
    return { transmitted: false, reason: 'not_configured' };
  }

  try {
    const candidates = await withOrgContext(args.orgId, (tx) =>
      tx.billingCandidate.findMany({
        where: {
          org_id: args.orgId,
          billing_month: args.billingMonth,
          billing_domain: args.billingDomain,
          status: 'exported',
        },
        select: {
          patient_id: true,
          billing_domain: true,
          billing_code: true,
          billing_name: true,
          points: true,
          status: true,
          source_snapshot: true,
        },
      }),
    );

    const records: ClaimsExportRecord[] = candidates.map((candidate) => ({
      patientId: candidate.patient_id ?? '',
      patientName: '',
      billingMonth: args.billingMonth.toISOString().slice(0, 7),
      insuranceType:
        candidate.billing_domain === 'pca_rental'
          ? 'self'
          : readJsonObjectString(candidate.source_snapshot, 'payer_basis') === 'care'
            ? 'care'
            : 'medical',
      billingCode: candidate.billing_code ?? '',
      billingName: candidate.billing_name ?? '',
      points: typeof candidate.points === 'number' ? candidate.points : 0,
      status: candidate.status,
    }));

    const adapter = createClaimsExportAdapter(resolveClaimsExportConfig());
    const result = await adapter.exportClaims({
      orgId: args.orgId,
      siteId: '',
      billingMonth: args.billingMonth.toISOString().slice(0, 7),
      records,
    });

    return { transmitted: true, recordCount: result.recordCount };
  } catch (cause) {
    logger.error(
      {
        event: 'billing.claims_export_transmit_failed',
        orgId: args.orgId,
        entityType: 'billing_month',
        entityId: args.billingMonth.toISOString().slice(0, 7),
        code: 'CLAIMS_EXPORT_TRANSMIT_FAILED',
      },
      cause,
    );
    return { transmitted: false, reason: 'failed' };
  }
}

function parseBillingDomain(value: unknown) {
  if (value === undefined || value === null || value === '') return 'home_care';
  return value === 'home_care' || value === 'pca_rental' ? value : null;
}

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
  const billingDomain = parseBillingDomain(payload.billing_domain);
  if (!billingDomain) {
    return validationError('billing_domain は home_care または pca_rental を指定してください');
  }

  const result = await withOrgContext(ctx.orgId, (tx) =>
    closeBillingCandidatesForMonth(tx, {
      orgId: ctx.orgId,
      billingMonth: parsedBillingMonth.start,
      actorId: ctx.userId,
      billingDomain,
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
    billingDomain,
    exportedCount: result.exported_count,
  });

  const claimsExport = await transmitClaimsExportForClose({
    orgId: ctx.orgId,
    billingMonth: parsedBillingMonth.start,
    billingDomain,
  });

  return success({
    message: `${parsedBillingMonth.canonical} を月次締めしました`,
    billing_domain: billingDomain,
    exported_count: result.exported_count,
    summary: result.summary,
    claims_export: claimsExport,
  });
}
