import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { PdfNotFoundError } from './pdf-errors';

export type BillingDocumentKind = 'receipt' | 'invoice';

export type BillingDocumentRecord = {
  id: string;
  kind: BillingDocumentKind;
  billing_month: Date;
  billing_code: string;
  billing_name: string;
  billing_domain: string;
  billing_target_name: string | null;
  patient: {
    id: string;
    name: string;
  } | null;
  collection: {
    status: string | null;
    billed_amount: number | null;
    collected_amount: number | null;
    unpaid_amount: number | null;
    payment_method: string | null;
    payer_name: string | null;
    billed_at: string | null;
    collected_at: string | null;
    receipt_number: string | null;
    receipt_issue_status: string | null;
    invoice_issue_status: string | null;
    receipt_copy_url: string | null;
    invoice_copy_url: string | null;
    updated_at: string | null;
  };
};

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readCollection(value: unknown): BillingDocumentRecord['collection'] | null {
  const collection = readJsonObject(readJsonObject(value)?.collection);
  if (!collection) return null;

  return {
    status: readString(collection.status),
    billed_amount: readNumber(collection.billed_amount),
    collected_amount: readNumber(collection.collected_amount),
    unpaid_amount: readNumber(collection.unpaid_amount),
    payment_method: readString(collection.payment_method),
    payer_name: readString(collection.payer_name),
    billed_at: readString(collection.billed_at),
    collected_at: readString(collection.collected_at),
    receipt_number: readString(collection.receipt_number),
    receipt_issue_status: readString(collection.receipt_issue_status),
    invoice_issue_status: readString(collection.invoice_issue_status),
    receipt_copy_url: readString(collection.receipt_copy_url),
    invoice_copy_url: readString(collection.invoice_copy_url),
    updated_at: readString(collection.updated_at),
  };
}

function readBillingTargetName(value: unknown) {
  const target = readJsonObject(readJsonObject(value)?.billing_target);
  return readString(target?.name);
}

export async function getBillingDocumentRecord(
  orgId: string,
  candidateId: string,
  kind: BillingDocumentKind,
): Promise<BillingDocumentRecord> {
  const candidate = await prisma.billingCandidate.findFirst({
    where: { id: candidateId, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      billing_domain: true,
      billing_target_name: true,
      billing_month: true,
      billing_code: true,
      billing_name: true,
      calculation_breakdown: true,
      source_snapshot: true,
    },
  });

  if (!candidate) {
    throw new PdfNotFoundError('billingCandidate');
  }

  const collection = readCollection(candidate.calculation_breakdown);
  if (!collection) {
    throw new Error('BILLING_DOCUMENT_NOT_ISSUED');
  }

  if (
    kind === 'receipt' &&
    (collection.receipt_issue_status !== 'issued' || !collection.receipt_number)
  ) {
    throw new Error('BILLING_DOCUMENT_NOT_ISSUED');
  }
  if (kind === 'invoice' && collection.invoice_issue_status !== 'issued') {
    throw new Error('BILLING_DOCUMENT_NOT_ISSUED');
  }

  const patient = candidate.patient_id
    ? await prisma.patient.findFirst({
        where: { id: candidate.patient_id, org_id: orgId },
        select: { id: true, name: true },
      })
    : null;

  return {
    id: candidate.id,
    kind,
    billing_month: candidate.billing_month,
    billing_code: candidate.billing_code,
    billing_name: candidate.billing_name,
    billing_domain: candidate.billing_domain,
    billing_target_name:
      candidate.billing_target_name ?? readBillingTargetName(candidate.source_snapshot),
    patient,
    collection,
  };
}
