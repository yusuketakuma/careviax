import { NextRequest } from 'next/server';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { readJsonObjectString } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
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
import { resolveClaimsExportSiteId } from '@/server/services/claims-export-site';
import { BILLING_DOMAIN_ERROR_MESSAGE, parseBillingDomainOrDefault } from '../billing-domain';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from '../billing-month';

type ClaimsExportCloseOutcome =
  | { transmitted: false; reason: 'not_configured' }
  | { transmitted: false; reason: 'no_records' }
  | { transmitted: true; recordCount: number }
  | { transmitted: false; reason: 'missing_site_id' | 'multiple_site_ids' | 'failed' };

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
  candidateIds: string[];
  ctx: AuthContext;
}): Promise<ClaimsExportCloseOutcome> {
  if (!isClaimsExportConsumerConfigured()) {
    return { transmitted: false, reason: 'not_configured' };
  }
  if (args.candidateIds.length === 0) {
    return { transmitted: false, reason: 'no_records' };
  }

  try {
    const candidates = await withOrgContext(args.orgId, (tx) =>
      tx.billingCandidate.findMany({
        where: {
          org_id: args.orgId,
          billing_month: args.billingMonth,
          billing_domain: args.billingDomain,
          status: 'exported',
          id: { in: args.candidateIds },
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

    const siteResolution = resolveClaimsExportSiteId(candidates);
    if (!siteResolution.ok) {
      logger.error(
        {
          event: 'billing.claims_export_site_unresolved',
          orgId: args.orgId,
          entityType: 'billing_month',
          entityId: args.billingMonth.toISOString().slice(0, 7),
          operation: args.billingDomain,
          phase: siteResolution.reason,
          count:
            siteResolution.reason === 'missing_site_id'
              ? siteResolution.missingCount
              : siteResolution.siteCount,
          code: 'CLAIMS_EXPORT_SITE_UNRESOLVED',
        },
        new Error('CLAIMS_EXPORT_SITE_UNRESOLVED'),
      );
      return { transmitted: false, reason: siteResolution.reason };
    }

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

    try {
      await withOrgContext(args.orgId, (tx) =>
        createAuditLogEntry(tx, args.ctx, {
          action: 'billing.claims_export_attempted',
          targetType: 'billing_month',
          targetId: `${args.billingMonth.toISOString().slice(0, 7)}/${args.billingDomain}`,
          changes: {
            billing_domain: args.billingDomain,
            site_id: siteResolution.siteId,
            record_count: records.length,
            audit_phase: 'attempt',
          },
        }),
      );
    } catch (auditCause) {
      logger.error(
        {
          event: 'billing.claims_export_audit_failed',
          orgId: args.orgId,
          entityType: 'billing_month',
          entityId: args.billingMonth.toISOString().slice(0, 7),
          phase: 'attempt',
          count: records.length,
          code: 'CLAIMS_EXPORT_AUDIT_FAILED',
        },
        auditCause,
      );
      return { transmitted: false, reason: 'failed' };
    }

    const adapter = createClaimsExportAdapter(resolveClaimsExportConfig());
    const result = await adapter.exportClaims({
      orgId: args.orgId,
      siteId: siteResolution.siteId,
      billingMonth: args.billingMonth.toISOString().slice(0, 7),
      records,
    });

    // 3省2 audit-by-default: 要配慮個人情報(レセプト請求)の外部送信を必ず監査ログへ記録する。
    // この時点で PHI は既に外部送信済み。監査書込の失敗で送信成功(transmitted:true)を
    // 覆してはならない(誤って「送信失敗」と返すと再送で二重送信になる)ため、監査は独自の
    // try/catch で隔離し、失敗時は専用イベントで記録して別途検知できるようにする。
    try {
      await withOrgContext(args.orgId, (tx) =>
        createAuditLogEntry(tx, args.ctx, {
          action: 'billing.claims_export_transmitted',
          targetType: 'billing_month',
          targetId: `${args.billingMonth.toISOString().slice(0, 7)}/${args.billingDomain}`,
          changes: {
            billing_domain: args.billingDomain,
            site_id: siteResolution.siteId,
            record_count: result.recordCount,
            audit_phase: 'success',
          },
        }),
      );
    } catch (auditCause) {
      logger.error(
        {
          event: 'billing.claims_export_audit_failed',
          orgId: args.orgId,
          entityType: 'billing_month',
          entityId: args.billingMonth.toISOString().slice(0, 7),
          phase: 'success',
          count: result.recordCount,
          code: 'CLAIMS_EXPORT_AUDIT_FAILED',
        },
        auditCause,
      );
    }

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

function isBillingCloseStaleCandidatesError(cause: unknown) {
  return cause instanceof Error && cause.message === 'BILLING_CLOSE_STALE_CANDIDATE';
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
  const billingDomain = parseBillingDomainOrDefault(payload.billing_domain);
  if (!billingDomain) {
    return validationError(BILLING_DOMAIN_ERROR_MESSAGE);
  }

  let result;
  try {
    result = await withOrgContext(ctx.orgId, (tx) =>
      closeBillingCandidatesForMonth(tx, {
        orgId: ctx.orgId,
        billingMonth: parsedBillingMonth.start,
        actorId: ctx.userId,
        billingDomain,
      }),
    );
  } catch (cause) {
    if (isBillingCloseStaleCandidatesError(cause)) {
      return error(
        'BILLING_CLOSE_STALE_CANDIDATES',
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してから月次締めしてください。',
        409,
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
    candidateIds: result.exported_candidate_ids,
    ctx,
  });

  return success({
    message: `${parsedBillingMonth.canonical} を月次締めしました`,
    billing_domain: billingDomain,
    exported_count: result.exported_count,
    summary: result.summary,
    claims_export: claimsExport,
  });
}
