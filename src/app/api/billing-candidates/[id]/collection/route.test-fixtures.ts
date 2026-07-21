import { createHash, createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

export const CURRENT_UPDATED_AT = '2026-06-01T00:00:00.000Z';
export const LOCAL_AUTH_SECRET = 'ph-os-local-auth-secret';

export function createBillingCollectionRequest(
  body: unknown,
  headers: Record<string, string> = {},
) {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1/collection', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      'x-request-id': 'inbound_request_should_be_ignored',
      'x-correlation-id': 'correlation_collection_1',
      ...headers,
    },
    body: JSON.stringify(requestBody),
  });
}

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function keyedHashJson(value: unknown) {
  return createHmac('sha256', LOCAL_AUTH_SECRET).update(JSON.stringify(value)).digest('hex');
}

export function buildIdempotencyKeyHash(idempotencyKey: string) {
  return `billing-collection:v1:${keyedHashJson({
    purpose: 'billing_collection_idempotency_key',
    org_id: 'org_1',
    candidate_id: 'candidate_1',
    idempotency_key: idempotencyKey,
  })}`;
}

export function buildRequestFingerprint(body: Record<string, unknown>) {
  return `billing-collection-request:v1:${hashJson({
    candidate_id: 'candidate_1',
    expected_updated_at: body.expected_updated_at,
    status: body.status,
    billed_amount: body.billed_amount ?? null,
    collected_amount: body.collected_amount ?? null,
    payment_method: body.payment_method ?? null,
    payer_name: body.payer_name ?? null,
    billed_at: body.billed_at ? new Date(String(body.billed_at)).toISOString() : null,
    scheduled_collection_at: body.scheduled_collection_at
      ? new Date(String(body.scheduled_collection_at)).toISOString()
      : null,
    collected_at: body.collected_at ? new Date(String(body.collected_at)).toISOString() : null,
    receipt_number: body.receipt_number ?? null,
    receipt_issue_status: body.receipt_issue_status ?? null,
    invoice_issue_status: body.invoice_issue_status ?? null,
    save_receipt_copy: body.save_receipt_copy ?? false,
    save_invoice_copy: body.save_invoice_copy ?? false,
    unpaid_reason: body.unpaid_reason ?? null,
    note: body.note ?? null,
  })}`;
}
