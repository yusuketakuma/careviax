import {
  Prisma,
  type PharmacyInvoiceDocumentKind,
  type PharmacyInvoiceStatus,
  type PharmacyTaxCategory,
} from '@prisma/client';
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

export type PharmacyInvoiceTransitionAction =
  | 'issue'
  | 'mark_sent'
  | 'mark_received'
  | 'schedule_payment'
  | 'record_payment'
  | 'cancel'
  | 'reissue';

export type PharmacyInvoiceTransitionInput =
  | { action: 'issue'; occurredAt: Date }
  | { action: 'mark_sent'; occurredAt: Date }
  | { action: 'mark_received'; occurredAt: Date }
  | { action: 'schedule_payment'; paymentScheduledFor: Date }
  | { action: 'record_payment'; occurredAt: Date }
  | { action: 'cancel'; reason?: string }
  | { action: 'reissue'; reason?: string };

export type PharmacyInvoiceTransitionErrorCode = 'NOT_FOUND' | 'INVALID_TRANSITION' | 'STALE';

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

export class PharmacyInvoiceTransitionError extends Error {
  constructor(
    readonly code: PharmacyInvoiceTransitionErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PharmacyInvoiceTransitionError';
  }
}

const INVOICE_TRANSITION_RULES = {
  issue: {
    from: ['draft'],
    to: 'issued',
    auditAction: 'pharmacy_invoice_issued',
  },
  mark_sent: {
    from: ['issued'],
    to: 'sent',
    auditAction: 'pharmacy_invoice_sent',
  },
  mark_received: {
    from: ['sent'],
    to: 'received',
    auditAction: 'pharmacy_invoice_received',
  },
  schedule_payment: {
    from: ['issued', 'sent', 'received'],
    to: 'payment_scheduled',
    auditAction: 'pharmacy_invoice_payment_scheduled',
  },
  record_payment: {
    from: ['issued', 'sent', 'received', 'payment_scheduled'],
    to: 'paid',
    auditAction: 'pharmacy_invoice_payment_recorded',
  },
  cancel: {
    from: ['issued', 'sent', 'received', 'payment_scheduled'],
    to: 'cancelled',
    auditAction: 'pharmacy_invoice_cancelled',
  },
  reissue: {
    from: ['issued', 'sent', 'received', 'payment_scheduled', 'paid'],
    to: null,
    auditAction: 'pharmacy_invoice_reissued',
  },
} as const satisfies Record<
  PharmacyInvoiceTransitionAction,
  {
    from: readonly PharmacyInvoiceStatus[];
    to: PharmacyInvoiceStatus | null;
    auditAction: string;
  }
>;

function toDateKey(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toBillingMonthCode(value: Date) {
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
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

function documentNumberPrefix(documentKind: PharmacyInvoiceDocumentKind) {
  return documentKind === 'free_cooperation_report' ? 'PCR' : 'INV';
}

function generateInvoiceNo(invoice: {
  id: string;
  document_kind: PharmacyInvoiceDocumentKind;
  billing_month: Date;
}) {
  const suffix = invoice.id
    .replace(/[^a-z0-9]/gi, '')
    .slice(-8)
    .toUpperCase();
  return `${documentNumberPrefix(invoice.document_kind)}-${toBillingMonthCode(invoice.billing_month)}-${suffix}`;
}

function buildLifecycleSnapshotPatch(
  invoice: {
    snapshot: unknown;
    status: PharmacyInvoiceStatus;
  },
  input: PharmacyInvoiceTransitionInput,
  nextStatus: PharmacyInvoiceStatus,
  actorId: string,
) {
  const source = readJsonObject(invoice.snapshot) ?? {};
  const lifecycleSource = readJsonObject(source.lifecycle) ?? {};
  const now = new Date().toISOString();
  const lifecycle = {
    ...lifecycleSource,
    previous_status: invoice.status,
    current_status: nextStatus,
    last_action: input.action,
    last_action_at: now,
    last_action_by: actorId,
  };

  if (input.action === 'schedule_payment') {
    Object.assign(lifecycle, {
      payment_scheduled_for: toDateKey(input.paymentScheduledFor),
    });
  }
  if (input.action === 'reissue') {
    const reissueCount =
      typeof lifecycleSource.reissue_count === 'number' &&
      Number.isFinite(lifecycleSource.reissue_count)
        ? lifecycleSource.reissue_count + 1
        : 1;
    Object.assign(lifecycle, {
      reissue_count: reissueCount,
      reissue_reason_length: input.reason?.length ?? 0,
    });
  }
  if (input.action === 'cancel') {
    Object.assign(lifecycle, {
      cancel_reason_length: input.reason?.length ?? 0,
    });
  }

  return toPrismaJsonInput({
    ...source,
    lifecycle,
  });
}

function buildTransitionData(
  invoice: {
    id: string;
    document_kind: PharmacyInvoiceDocumentKind;
    billing_month: Date;
    invoice_no: string | null;
    status: PharmacyInvoiceStatus;
    snapshot: unknown;
  },
  input: PharmacyInvoiceTransitionInput,
  nextStatus: PharmacyInvoiceStatus,
  actorId: string,
): Prisma.PharmacyInvoiceUpdateManyMutationInput {
  const data: Prisma.PharmacyInvoiceUpdateManyMutationInput = {
    status: nextStatus,
    snapshot: buildLifecycleSnapshotPatch(invoice, input, nextStatus, actorId),
  };

  if (input.action === 'issue') {
    data.issued_at = input.occurredAt;
    data.invoice_no = invoice.invoice_no ?? generateInvoiceNo(invoice);
  } else if (input.action === 'mark_sent') {
    data.sent_at = input.occurredAt;
  } else if (input.action === 'mark_received') {
    data.received_at = input.occurredAt;
  } else if (input.action === 'record_payment') {
    data.paid_at = input.occurredAt;
  }

  return data;
}

function toSafeInvoiceTransitionResult(invoice: {
  id: string;
  contract_id: string;
  document_kind: PharmacyInvoiceDocumentKind;
  invoice_no: string | null;
  billing_month: Date;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: PharmacyInvoiceStatus;
  issued_at: Date | null;
  sent_at: Date | null;
  received_at: Date | null;
  paid_at: Date | null;
  updated_at: Date;
  _count: { items: number };
}) {
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
    issued_at: invoice.issued_at,
    sent_at: invoice.sent_at,
    received_at: invoice.received_at,
    paid_at: invoice.paid_at,
    updated_at: invoice.updated_at,
    item_count: invoice._count.items,
  };
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

export async function transitionPharmacyInvoice(
  tx: Prisma.TransactionClient,
  ctx: Pick<
    AuthContext,
    'orgId' | 'userId' | 'actorPharmacyId' | 'actorSiteId' | 'ipAddress' | 'userAgent'
  >,
  invoiceId: string,
  input: PharmacyInvoiceTransitionInput,
) {
  const invoice = await tx.pharmacyInvoice.findFirst({
    where: { id: invoiceId, org_id: ctx.orgId },
    select: {
      id: true,
      contract_id: true,
      document_kind: true,
      invoice_no: true,
      billing_month: true,
      subtotal: true,
      tax_amount: true,
      total: true,
      status: true,
      issued_at: true,
      sent_at: true,
      received_at: true,
      paid_at: true,
      snapshot: true,
      updated_at: true,
      _count: { select: { items: true } },
    },
  });

  if (!invoice) {
    throw new PharmacyInvoiceTransitionError('NOT_FOUND', '薬局間請求書が見つかりません');
  }

  const rule = INVOICE_TRANSITION_RULES[input.action];
  if (!(rule.from as readonly PharmacyInvoiceStatus[]).includes(invoice.status)) {
    throw new PharmacyInvoiceTransitionError(
      'INVALID_TRANSITION',
      '現在の状態ではこの請求書操作を実行できません',
      {
        action: input.action,
        current_status: invoice.status,
        allowed_statuses: [...rule.from],
      },
    );
  }

  const nextStatus = rule.to ?? invoice.status;
  const updateResult = await tx.pharmacyInvoice.updateMany({
    where: {
      id: invoice.id,
      org_id: ctx.orgId,
      status: invoice.status,
    },
    data: buildTransitionData(invoice, input, nextStatus, ctx.userId),
  });

  if (updateResult.count !== 1) {
    throw new PharmacyInvoiceTransitionError(
      'STALE',
      '請求書の状態が更新されているため操作を完了できませんでした',
      {
        action: input.action,
        previous_status: invoice.status,
      },
    );
  }

  const updated = await tx.pharmacyInvoice.findFirstOrThrow({
    where: { id: invoice.id, org_id: ctx.orgId },
    select: {
      id: true,
      contract_id: true,
      document_kind: true,
      invoice_no: true,
      billing_month: true,
      subtotal: true,
      tax_amount: true,
      total: true,
      status: true,
      issued_at: true,
      sent_at: true,
      received_at: true,
      paid_at: true,
      updated_at: true,
      _count: { select: { items: true } },
    },
  });

  const auditChanges: Prisma.InputJsonObject = {
    action: input.action,
    previous_status: invoice.status,
    status: updated.status,
    document_kind: updated.document_kind,
    billing_month: toDateKey(updated.billing_month),
    contract_id: updated.contract_id,
    item_count: updated._count.items,
    invoice_no_assigned: !invoice.invoice_no && Boolean(updated.invoice_no),
    has_issued_at: Boolean(updated.issued_at),
    has_sent_at: Boolean(updated.sent_at),
    has_received_at: Boolean(updated.received_at),
    has_paid_at: Boolean(updated.paid_at),
    ...(input.action === 'schedule_payment'
      ? { payment_scheduled_for: toDateKey(input.paymentScheduledFor) }
      : {}),
    ...(input.action === 'cancel' || input.action === 'reissue'
      ? { reason_length: input.reason?.length ?? 0 }
      : {}),
  };

  await createAuditLogEntry(tx, ctx, {
    action: rule.auditAction,
    targetType: 'PharmacyInvoice',
    targetId: invoice.id,
    changes: auditChanges,
  });

  return toSafeInvoiceTransitionResult(updated);
}
