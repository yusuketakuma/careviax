import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, type NextResponse } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseOptionalIdempotencyKey } from '@/lib/api/idempotency-key';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { getAuthSecret } from '@/lib/auth/secret';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import {
  updateBillingCollectionSchema,
  type UpdateBillingCollectionInput,
} from '@/lib/validations/billing-collection';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

class BillingCollectionConflictError extends Error {}

const BILLING_PAYMENT_PROFILE_TASK_TYPE = 'patient_billing_payment_profile';
const receiptNumberPlaceholders = new Set(['未記録', '未発行/未記録', '未発行', '不要']);

function buildBillingDocumentPdfUrl(candidateId: string, kind: 'receipt' | 'invoice') {
  return `/api/billing-candidates/${encodeURIComponent(candidateId)}/documents/pdf?kind=${kind}`;
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeReceiptNumber(value: string | null | undefined) {
  const normalized = normalizeNullableText(value);
  return normalized && !receiptNumberPlaceholders.has(normalized) ? normalized : null;
}

function resolveBillingCollectionIdempotencyHashSecret() {
  const configuredSecret = process.env.BILLING_COLLECTION_IDEMPOTENCY_HASH_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  const authSecret = getAuthSecret();
  if (authSecret) return authSecret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('billing collection idempotency hash secret is not configured');
  }
  return 'ph-os-local-billing-collection-idempotency-secret';
}

function keyedHashJson(value: unknown) {
  return createHmac('sha256', resolveBillingCollectionIdempotencyHashSecret())
    .update(JSON.stringify(value))
    .digest('hex');
}

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildBillingCollectionIdempotencyKeyHash(args: {
  orgId: string;
  candidateId: string;
  idempotencyKey: string;
}) {
  return `billing-collection:v1:${keyedHashJson({
    purpose: 'billing_collection_idempotency_key',
    org_id: args.orgId,
    candidate_id: args.candidateId,
    idempotency_key: args.idempotencyKey,
  })}`;
}

function buildBillingCollectionRequestFingerprint(args: {
  candidateId: string;
  data: UpdateBillingCollectionInput;
}) {
  const data = args.data;
  return `billing-collection-request:v1:${hashJson({
    candidate_id: args.candidateId,
    expected_updated_at: data.expected_updated_at,
    status: data.status,
    billed_amount: data.billed_amount ?? null,
    collected_amount: data.collected_amount ?? null,
    payment_method: normalizeNullableText(data.payment_method),
    payer_name: normalizeNullableText(data.payer_name),
    billed_at: data.billed_at ? new Date(data.billed_at).toISOString() : null,
    scheduled_collection_at: data.scheduled_collection_at
      ? new Date(data.scheduled_collection_at).toISOString()
      : null,
    collected_at: data.collected_at ? new Date(data.collected_at).toISOString() : null,
    receipt_number: normalizeReceiptNumber(data.receipt_number),
    receipt_issue_status: data.receipt_issue_status ?? null,
    invoice_issue_status: data.invoice_issue_status ?? null,
    save_receipt_copy: data.save_receipt_copy,
    save_invoice_copy: data.save_invoice_copy,
    unpaid_reason: normalizeNullableText(data.unpaid_reason),
    note: normalizeNullableText(data.note),
  })}`;
}

function readCollectionIdempotencyStatus(input: {
  calculationBreakdown: unknown;
  idempotencyKeyHash: string;
  requestFingerprint: string;
}) {
  const breakdown = readJsonObject(input.calculationBreakdown);
  const collection = readJsonObject(breakdown?.collection);
  const existingKeyHash =
    typeof collection?.idempotency_key_hash === 'string' ? collection.idempotency_key_hash : null;
  if (existingKeyHash !== input.idempotencyKeyHash) return 'none' as const;
  const existingFingerprint =
    typeof collection?.idempotency_request_fingerprint === 'string'
      ? collection.idempotency_request_fingerprint
      : null;
  return existingFingerprint === input.requestFingerprint
    ? ('replayed' as const)
    : ('conflict' as const);
}

function readReceiptIssue(metadata: unknown) {
  const value = readJsonObject(metadata);
  const receiptIssue = typeof value?.receipt_issue === 'string' ? value.receipt_issue : null;
  return receiptIssue === 'paper' || receiptIssue === 'pdf' || receiptIssue === 'none'
    ? receiptIssue
    : null;
}

function readInvoiceIssue(metadata: unknown) {
  const value = readJsonObject(metadata);
  const invoiceIssue = typeof value?.invoice_issue === 'string' ? value.invoice_issue : null;
  return invoiceIssue === 'yes' || invoiceIssue === 'no' ? invoiceIssue : null;
}

function isReceiptManagedPayment(input: {
  status: string;
  collectedAmount: number | null;
  receiptIssue: string | null;
}) {
  return (
    input.receiptIssue != null &&
    input.receiptIssue !== 'none' &&
    ['collected', 'partial'].includes(input.status) &&
    (input.collectedAmount ?? 0) > 0
  );
}

function resolveReceiptIssueStatus(input: {
  requestedStatus: string | undefined;
  receiptIssue: string | null;
  receiptNumber: string | null;
}) {
  if (input.receiptIssue === 'none') return 'not_required';
  if (input.requestedStatus) return input.requestedStatus;
  return input.receiptNumber ? 'issued' : 'not_issued';
}

function isInvoiceManagedBilling(input: {
  status: string;
  billedAmount: number | null;
  invoiceIssue: string | null;
}) {
  return (
    input.invoiceIssue === 'yes' &&
    ['billed', 'collected', 'partial', 'unpaid', 'dunning'].includes(input.status) &&
    (input.billedAmount ?? 0) > 0
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '集金記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const candidateId = normalizeRequiredRouteParam(rawId);
  if (!candidateId) return validationError('請求候補IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsedIdempotencyKey = parseOptionalIdempotencyKey(req.headers.get('idempotency-key'));
  if (!parsedIdempotencyKey.ok) return validationError(parsedIdempotencyKey.message);

  const parsed = updateBillingCollectionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);
  const idempotencyKeyHash = parsedIdempotencyKey.key
    ? buildBillingCollectionIdempotencyKeyHash({
        orgId: ctx.orgId,
        candidateId,
        idempotencyKey: parsedIdempotencyKey.key,
      })
    : null;
  const requestFingerprint = parsedIdempotencyKey.key
    ? buildBillingCollectionRequestFingerprint({ candidateId, data: parsed.data })
    : null;

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const candidate = await tx.billingCandidate.findFirst({
      where: {
        id: candidateId,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        patient_id: true,
        billing_target_type: true,
        billing_target_id: true,
        status: true,
        calculation_breakdown: true,
        updated_at: true,
      },
    });
    if (!candidate) return null;

    if (idempotencyKeyHash && requestFingerprint) {
      const replayStatus = readCollectionIdempotencyStatus({
        calculationBreakdown: candidate.calculation_breakdown,
        idempotencyKeyHash,
        requestFingerprint,
      });
      if (replayStatus === 'replayed') {
        return tx.billingCandidate.findUnique({ where: { id: candidateId } });
      }
      if (replayStatus === 'conflict') return 'idempotency-conflict' as const;
    }
    if (candidate.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
      throw new BillingCollectionConflictError(
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
      );
    }

    const candidatePatientId =
      candidate.patient_id ??
      (candidate.billing_target_type === 'patient' ? candidate.billing_target_id : null);
    if (candidatePatientId) {
      const writable = await requireWritablePatient(tx, ctx, candidatePatientId);
      if ('response' in writable) return { error: writable.response };
    }
    const billingPaymentProfileTask = candidatePatientId
      ? await tx.task.findFirst({
          where: {
            org_id: ctx.orgId,
            task_type: BILLING_PAYMENT_PROFILE_TASK_TYPE,
            related_entity_type: 'patient',
            related_entity_id: candidatePatientId,
          },
          orderBy: [{ updated_at: 'desc' }],
          select: {
            metadata: true,
          },
        })
      : null;
    const receiptIssue = readReceiptIssue(billingPaymentProfileTask?.metadata);
    const invoiceIssue = readInvoiceIssue(billingPaymentProfileTask?.metadata);
    const existingBreakdown = readJsonObject(candidate.calculation_breakdown) ?? {};
    const billedAmount = parsed.data.billed_amount ?? null;
    const collectedAmount = parsed.data.collected_amount ?? null;
    const receiptNumber = normalizeReceiptNumber(parsed.data.receipt_number);
    const receiptIssueStatus = resolveReceiptIssueStatus({
      requestedStatus: parsed.data.receipt_issue_status,
      receiptIssue,
      receiptNumber,
    });
    const invoiceIssueStatus = parsed.data.invoice_issue_status ?? 'not_issued';
    if (
      isReceiptManagedPayment({
        status: parsed.data.status,
        collectedAmount,
        receiptIssue,
      }) &&
      (!receiptNumber || receiptIssueStatus !== 'issued')
    ) {
      return 'missing-receipt-number' as const;
    }
    if (
      isInvoiceManagedBilling({
        status: parsed.data.status,
        billedAmount,
        invoiceIssue,
      }) &&
      invoiceIssueStatus !== 'issued'
    ) {
      return 'missing-invoice-issue-status' as const;
    }
    const unpaidAmount =
      billedAmount == null ? null : Math.max(billedAmount - (collectedAmount ?? 0), 0);
    const receiptCopyUrl =
      parsed.data.save_receipt_copy && receiptIssueStatus === 'issued'
        ? buildBillingDocumentPdfUrl(candidateId, 'receipt')
        : null;
    const invoiceCopyUrl =
      parsed.data.save_invoice_copy && invoiceIssueStatus === 'issued'
        ? buildBillingDocumentPdfUrl(candidateId, 'invoice')
        : null;
    const collection = {
      status: parsed.data.status,
      billed_amount: billedAmount,
      collected_amount: collectedAmount,
      unpaid_amount: unpaidAmount,
      payment_method: normalizeNullableText(parsed.data.payment_method),
      payer_name: normalizeNullableText(parsed.data.payer_name),
      billed_at: parsed.data.billed_at ? new Date(parsed.data.billed_at).toISOString() : null,
      scheduled_collection_at: parsed.data.scheduled_collection_at
        ? new Date(parsed.data.scheduled_collection_at).toISOString()
        : null,
      collected_at: parsed.data.collected_at
        ? new Date(parsed.data.collected_at).toISOString()
        : null,
      receipt_number: receiptNumber,
      receipt_issue_status: receiptIssueStatus,
      invoice_issue_status: invoiceIssueStatus,
      save_receipt_copy: parsed.data.save_receipt_copy,
      save_invoice_copy: parsed.data.save_invoice_copy,
      receipt_copy_url: receiptCopyUrl,
      invoice_copy_url: invoiceCopyUrl,
      unpaid_reason: normalizeNullableText(parsed.data.unpaid_reason),
      note: normalizeNullableText(parsed.data.note),
      ...(idempotencyKeyHash && requestFingerprint
        ? {
            idempotency_key_hash: idempotencyKeyHash,
            idempotency_request_fingerprint: requestFingerprint,
          }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    };
    const nextBreakdown = {
      ...existingBreakdown,
      collection,
    };

    const updateResult = await tx.billingCandidate.updateMany({
      where: {
        id: candidateId,
        org_id: ctx.orgId,
        updated_at: candidate.updated_at,
      },
      data: {
        calculation_breakdown: nextBreakdown as Prisma.InputJsonObject,
      },
    });
    if (updateResult.count !== 1) {
      if (idempotencyKeyHash && requestFingerprint) {
        const winner = await tx.billingCandidate.findUnique({ where: { id: candidateId } });
        const replayStatus = readCollectionIdempotencyStatus({
          calculationBreakdown: winner?.calculation_breakdown,
          idempotencyKeyHash,
          requestFingerprint,
        });
        if (replayStatus === 'replayed') return winner;
        if (replayStatus === 'conflict') return 'idempotency-conflict' as const;
      }
      throw new BillingCollectionConflictError(
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
      );
    }
    const auditCollection = { ...collection };
    delete auditCollection.idempotency_key_hash;
    delete auditCollection.idempotency_request_fingerprint;

    await createAuditLogEntry(tx, ctx, {
      action: 'billing_collection_updated',
      targetType: 'BillingCandidate',
      targetId: candidateId,
      changes: {
        status_before: candidate.status,
        collection: auditCollection as Prisma.InputJsonObject,
      },
    });

    const updated = await tx.billingCandidate.findUnique({
      where: { id: candidateId },
    });
    return updated;
  }).catch((error) => {
    if (error instanceof BillingCollectionConflictError) return 'conflict' as const;
    throw error;
  });

  if (result === 'conflict') {
    return conflict(
      '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    );
  }
  if (result === 'idempotency-conflict') {
    return conflict('Idempotency-Keyが別の集金記録リクエストで使用されています', {
      reason: 'key_reused_with_different_request',
    });
  }
  if (result === 'missing-receipt-number') {
    return validationError('領収証番号と発行状態を入力してください', {
      receipt_number: ['領収証発行が必要な患者では集金時に領収証番号が必須です'],
      receipt_issue_status: ['領収証発行が必要な患者では集金時に発行済み状態が必須です'],
    });
  }
  if (result === 'missing-invoice-issue-status') {
    return validationError('請求書の発行状態を入力してください', {
      invoice_issue_status: ['請求書発行が必要な患者では請求・集金時に発行済み状態が必須です'],
    });
  }
  if (result && typeof result === 'object' && 'error' in result) return result.error;
  if (!result) return notFound('請求候補が見つかりません');

  return success({ data: result });
}
