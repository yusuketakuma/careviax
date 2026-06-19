import { Prisma, type PharmacyInvoiceDocumentKind, type PharmacyTaxCategory } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';

const ACTIVE_INVOICE_STATUSES = [
  'draft',
  'issued',
  'sent',
  'received',
  'payment_scheduled',
  'paid',
] as const;

const TAX_CATEGORIES = new Set<PharmacyTaxCategory>([
  'taxable',
  'tax_exempt',
  'non_taxable',
  'out_of_scope',
  'tax_pending',
]);

const pharmacyInvoiceDraftInclude = {
  items: {
    orderBy: [{ visit_date: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      visit_billing_candidate_id: true,
      visit_date: true,
      description: true,
      quantity: true,
      unit_price: true,
      amount: true,
      tax_category: true,
      created_at: true,
    },
  },
} satisfies Prisma.PharmacyInvoiceInclude;

type PharmacyInvoiceDraftRow = Prisma.PharmacyInvoiceGetPayload<{
  include: typeof pharmacyInvoiceDraftInclude;
}>;

type CandidateRow = Prisma.VisitBillingCandidateGetPayload<{
  include: {
    partner_visit_record: {
      select: {
        id: true;
        visit_at: true;
        share_case_id: true;
        owner_partner_pharmacy_id: true;
      };
    };
    contract_version: {
      include: {
        contract: {
          include: {
            partnership: {
              select: {
                base_site: { select: { id: true; name: true } };
                partner_pharmacy: { select: { id: true; name: true; pharmacy_code: true } };
              };
            };
          };
        };
      };
    };
  };
}>;

export type CreatePharmacyInvoiceDraftInput = {
  billingMonth: {
    canonical: string;
    start: Date;
    nextStart: Date;
  };
  contractId: string;
  documentKind: PharmacyInvoiceDocumentKind;
};

export type PharmacyInvoiceDraftErrorCode =
  | 'NO_ELIGIBLE_CANDIDATES'
  | 'INVALID_CANDIDATE_AMOUNT'
  | 'STALE_CANDIDATES';

export class PharmacyInvoiceDraftError extends Error {
  constructor(
    readonly code: PharmacyInvoiceDraftErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PharmacyInvoiceDraftError';
  }
}

function toDateKey(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toUtcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function readFiniteInt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTaxCategory(value: unknown): PharmacyTaxCategory {
  return typeof value === 'string' && TAX_CATEGORIES.has(value as PharmacyTaxCategory)
    ? (value as PharmacyTaxCategory)
    : 'tax_pending';
}

function readCandidateAmountSnapshot(value: unknown) {
  const snapshot = readJsonObject(value);
  return {
    feeRuleId: readString(snapshot?.fee_rule_id),
    billingModel: readString(snapshot?.billing_model),
    unitPrice: readFiniteInt(snapshot?.unit_price),
    amount: readFiniteInt(snapshot?.amount),
    taxCategory: readTaxCategory(snapshot?.tax_category),
    taxRateBp: readFiniteInt(snapshot?.tax_rate_bp),
    roundingRule: readString(snapshot?.rounding_rule),
  };
}

function documentKindForBillingModel(billingModel: string | null): PharmacyInvoiceDocumentKind {
  return billingModel === 'free' ? 'free_cooperation_report' : 'invoice';
}

function calculateTaxAmount(
  amount: number,
  taxCategory: PharmacyTaxCategory,
  taxRateBp: number | null,
) {
  if (taxCategory !== 'taxable' || !taxRateBp || taxRateBp <= 0) return 0;
  return Math.round((amount * taxRateBp) / 10_000);
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

async function findActiveInvoiceDraft(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: CreatePharmacyInvoiceDraftInput,
) {
  return tx.pharmacyInvoice.findFirst({
    where: {
      org_id: orgId,
      contract_id: input.contractId,
      billing_month: input.billingMonth.start,
      document_kind: input.documentKind,
      status: { in: [...ACTIVE_INVOICE_STATUSES] },
    },
    orderBy: { created_at: 'desc' },
    include: pharmacyInvoiceDraftInclude,
  });
}

function toSafeInvoiceDraft(invoice: PharmacyInvoiceDraftRow, reused: boolean) {
  return {
    id: invoice.id,
    contract_id: invoice.contract_id,
    document_kind: invoice.document_kind,
    invoice_no: invoice.invoice_no,
    billing_month: toDateKey(invoice.billing_month),
    subtotal: invoice.subtotal,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    status: invoice.status,
    reused_existing_draft: reused,
    item_count: invoice.items.length,
    has_issuer_snapshot: invoice.issuer_snapshot !== null,
    has_recipient_snapshot: invoice.recipient_snapshot !== null,
    has_snapshot: invoice.snapshot !== null,
    items: invoice.items.map((item) => ({
      id: item.id,
      visit_billing_candidate_id: item.visit_billing_candidate_id,
      visit_date: toDateKey(item.visit_date),
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount: item.amount,
      tax_category: item.tax_category,
    })),
  };
}

function buildInvoiceItem(candidate: CandidateRow, documentKind: PharmacyInvoiceDocumentKind) {
  const snapshot = readCandidateAmountSnapshot(candidate.amount_snapshot);
  const candidateDocumentKind = documentKindForBillingModel(snapshot.billingModel);
  if (candidateDocumentKind !== documentKind) return null;

  const amount = snapshot.amount;
  if (
    documentKind === 'invoice' &&
    (snapshot.billingModel === 'free' || amount === null || amount <= 0)
  ) {
    throw new PharmacyInvoiceDraftError(
      'INVALID_CANDIDATE_AMOUNT',
      '有償請求書に含められない請求候補が含まれています',
      { candidate_id: candidate.id },
    );
  }
  if (
    documentKind === 'free_cooperation_report' &&
    (snapshot.billingModel !== 'free' || amount !== 0)
  ) {
    throw new PharmacyInvoiceDraftError(
      'INVALID_CANDIDATE_AMOUNT',
      '無償実績報告書に含められない請求候補が含まれています',
      { candidate_id: candidate.id },
    );
  }

  const normalizedAmount = amount ?? 0;
  const visitDate = toUtcDateOnly(candidate.partner_visit_record.visit_at);
  const visitDateKey = toDateKey(visitDate);
  const description =
    documentKind === 'free_cooperation_report'
      ? `無償協力訪問 ${visitDateKey}`
      : `薬局間協力訪問 ${visitDateKey}`;

  return {
    candidateId: candidate.id,
    subtotal: normalizedAmount,
    taxAmount: calculateTaxAmount(normalizedAmount, snapshot.taxCategory, snapshot.taxRateBp),
    create: {
      org_id: candidate.org_id,
      visit_billing_candidate_id: candidate.id,
      visit_date: visitDate,
      description,
      quantity: 1,
      unit_price: snapshot.unitPrice ?? normalizedAmount,
      amount: normalizedAmount,
      tax_category: snapshot.taxCategory,
      snapshot: toPrismaJsonInput({
        snapshot_version: 'pharmacy_invoice_item_v1',
        patient_display_mode: 'management_number',
        source: {
          visit_billing_candidate_id: candidate.id,
          partner_visit_record_id: candidate.partner_visit_record.id,
          contract_version_id: candidate.contract_version_id,
        },
        visit: {
          visit_date: visitDateKey,
        },
        fee: {
          fee_rule_id: snapshot.feeRuleId,
          billing_model: snapshot.billingModel,
          unit_price: snapshot.unitPrice,
          amount: normalizedAmount,
          tax_category: snapshot.taxCategory,
          tax_rate_bp: snapshot.taxRateBp,
          rounding_rule: snapshot.roundingRule,
        },
      }),
    },
  };
}

export async function createPharmacyInvoiceDraft(
  tx: Prisma.TransactionClient,
  ctx: Pick<AuthContext, 'orgId' | 'userId' | 'ipAddress' | 'userAgent'>,
  input: CreatePharmacyInvoiceDraftInput,
) {
  const existingInvoice = await findActiveInvoiceDraft(tx, ctx.orgId, input);
  if (existingInvoice) {
    return {
      invoice: toSafeInvoiceDraft(existingInvoice, true),
      reused: true,
      candidate_count: existingInvoice.items.length,
    };
  }

  const candidates = await tx.visitBillingCandidate.findMany({
    where: {
      org_id: ctx.orgId,
      billing_month: input.billingMonth.start,
      billing_status: { in: ['candidate', 'confirmed'] },
      is_billable: true,
      invoice_items: { none: { org_id: ctx.orgId } },
      contract_version: {
        is: {
          contract_id: input.contractId,
          status: 'active',
          contract: {
            status: 'active',
          },
        },
      },
    },
    orderBy: [{ billing_month: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    include: {
      partner_visit_record: {
        select: {
          id: true,
          visit_at: true,
          share_case_id: true,
          owner_partner_pharmacy_id: true,
        },
      },
      contract_version: {
        include: {
          contract: {
            include: {
              partnership: {
                select: {
                  base_site: { select: { id: true, name: true } },
                  partner_pharmacy: { select: { id: true, name: true, pharmacy_code: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const items = candidates
    .map((candidate) => buildInvoiceItem(candidate, input.documentKind))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (items.length === 0) {
    throw new PharmacyInvoiceDraftError('NO_ELIGIBLE_CANDIDATES', '対象の請求候補がありません', {
      contract_id: input.contractId,
      billing_month: input.billingMonth.canonical,
      document_kind: input.documentKind,
    });
  }

  const firstContractVersion = candidates.find(
    (candidate) => candidate.contract_version?.contract_id === input.contractId,
  )?.contract_version;
  const contract = firstContractVersion?.contract;
  if (!contract) {
    throw new PharmacyInvoiceDraftError(
      'NO_ELIGIBLE_CANDIDATES',
      '有効な契約に紐づく請求候補がありません',
      { contract_id: input.contractId },
    );
  }

  const candidateIds = items.map((item) => item.candidateId);
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
  const total = subtotal + taxAmount;
  const partnerPharmacy = contract.partnership.partner_pharmacy;
  const baseSite = contract.partnership.base_site;

  let invoice: PharmacyInvoiceDraftRow;
  try {
    invoice = await tx.pharmacyInvoice.create({
      data: {
        org_id: ctx.orgId,
        contract_id: input.contractId,
        document_kind: input.documentKind,
        billing_month: input.billingMonth.start,
        issuer_snapshot: toPrismaJsonInput({
          role: 'partner_pharmacy',
          partner_pharmacy_id: partnerPharmacy.id,
          pharmacy_code: partnerPharmacy.pharmacy_code,
          name: partnerPharmacy.name,
        }),
        recipient_snapshot: toPrismaJsonInput({
          role: 'base_pharmacy',
          base_site_id: baseSite.id,
          name: baseSite.name,
        }),
        subtotal,
        tax_amount: taxAmount,
        total,
        status: 'draft',
        snapshot: toPrismaJsonInput({
          snapshot_version: 'pharmacy_invoice_draft_v1',
          document_kind: input.documentKind,
          billing_month: input.billingMonth.canonical,
          patient_display_mode: 'management_number',
          contract_id: input.contractId,
          contract_version_id: firstContractVersion.id,
          contract_version_no: firstContractVersion.version_no,
          candidate_count: candidateIds.length,
          generated_by: ctx.userId,
          generated_at: new Date().toISOString(),
          source_candidate_ids: candidateIds,
        }),
        created_by: ctx.userId,
        items: {
          create: items.map((item) => item.create),
        },
      },
      include: pharmacyInvoiceDraftInclude,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const concurrentInvoice = await findActiveInvoiceDraft(tx, ctx.orgId, input);
      if (concurrentInvoice) {
        return {
          invoice: toSafeInvoiceDraft(concurrentInvoice, true),
          reused: true,
          candidate_count: concurrentInvoice.items.length,
        };
      }
    }
    throw error;
  }

  const updateResult = await tx.visitBillingCandidate.updateMany({
    where: {
      org_id: ctx.orgId,
      id: { in: candidateIds },
      billing_status: { in: ['candidate', 'confirmed'] },
      is_billable: true,
      invoice_items: { some: { invoice_id: invoice.id, org_id: ctx.orgId } },
    },
    data: {
      billing_status: 'invoiced',
    },
  });
  if (updateResult.count !== candidateIds.length) {
    throw new PharmacyInvoiceDraftError(
      'STALE_CANDIDATES',
      '請求候補が更新されているため請求書を作成できませんでした',
      { expected_count: candidateIds.length, updated_count: updateResult.count },
    );
  }

  await createAuditLogEntry(tx, ctx, {
    action: 'pharmacy_invoice_draft_created',
    targetType: 'PharmacyInvoice',
    targetId: invoice.id,
    changes: {
      contract_id: input.contractId,
      document_kind: input.documentKind,
      billing_month: input.billingMonth.canonical,
      candidate_count: candidateIds.length,
      subtotal,
      tax_amount: taxAmount,
      total,
      patient_display_mode: 'management_number',
      source_candidate_ids_truncated: candidateIds.length > 20,
      source_candidate_ids: candidateIds.slice(0, 20),
    },
  });

  return {
    invoice: toSafeInvoiceDraft(invoice, false),
    reused: false,
    candidate_count: candidateIds.length,
  };
}
