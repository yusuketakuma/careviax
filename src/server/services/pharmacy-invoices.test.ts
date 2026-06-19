import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';
import { parseStrictBillingMonth } from '@/app/api/billing-candidates/billing-month';
import { createPharmacyInvoiceDraft, PharmacyInvoiceDraftError } from './pharmacy-invoices';

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};

const billingMonth = (() => {
  const parsed = parseStrictBillingMonth('2026-06-01');
  if (!parsed) throw new Error('invalid test billing month');
  return parsed;
})();

const now = new Date('2026-06-19T00:00:00.000Z');

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate_1',
    org_id: 'org_1',
    partner_visit_record_id: 'partner_visit_record_1',
    contract_version_id: 'contract_version_1',
    billing_month: billingMonth.start,
    billing_status: 'candidate',
    is_billable: true,
    exclusion_reason: null,
    amount_snapshot: {
      fee_rule_id: 'fee_rule_1',
      billing_model: 'fixed_per_visit',
      unit_price: 5500,
      amount: 5500,
      tax_category: 'taxable',
      tax_rate_bp: 1000,
      patient_name: '患者 太郎',
    },
    confirmed_by: null,
    confirmed_at: null,
    created_at: now,
    updated_at: now,
    partner_visit_record: {
      id: 'partner_visit_record_1',
      visit_at: new Date('2026-06-19T02:00:00.000Z'),
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
    },
    contract_version: {
      id: 'contract_version_1',
      org_id: 'org_1',
      contract_id: 'contract_1',
      version_no: 3,
      status: 'active',
      effective_from: billingMonth.start,
      effective_to: null,
      document_file_id: null,
      change_reason: null,
      terms_snapshot: {},
      approved_by_base: 'base',
      approved_by_partner: 'partner',
      approved_at: now,
      created_by: 'user_1',
      created_at: now,
      updated_at: now,
      contract: {
        id: 'contract_1',
        org_id: 'org_1',
        partnership_id: 'partnership_1',
        status: 'active',
        effective_from: billingMonth.start,
        effective_to: null,
        closing_day: 20,
        payment_due_rule: null,
        base_approved_by: 'base',
        base_approved_at: now,
        partner_approved_by: 'partner',
        partner_approved_at: now,
        ended_at: null,
        ended_reason: null,
        created_by: 'user_1',
        updated_by: 'user_1',
        created_at: now,
        updated_at: now,
        partnership: {
          base_site: { id: 'base_site_1', name: '基幹薬局' },
          partner_pharmacy: {
            id: 'partner_pharmacy_1',
            name: '協力薬局',
            pharmacy_code: 'P001',
          },
        },
      },
    },
    invoice_items: [],
    ...overrides,
  };
}

function invoiceFromCreateArgs(args: {
  data: {
    contract_id: string;
    document_kind: 'invoice' | 'free_cooperation_report';
    billing_month: Date;
    issuer_snapshot: unknown;
    recipient_snapshot: unknown;
    subtotal: number;
    tax_amount: number;
    total: number;
    status: 'draft';
    snapshot: unknown;
    created_by: string;
    items: { create: Array<Record<string, unknown>> };
  };
}) {
  return {
    id: 'invoice_1',
    org_id: 'org_1',
    contract_id: args.data.contract_id,
    document_kind: args.data.document_kind,
    invoice_no: null,
    billing_month: args.data.billing_month,
    issuer_snapshot: args.data.issuer_snapshot,
    recipient_snapshot: args.data.recipient_snapshot,
    subtotal: args.data.subtotal,
    tax_amount: args.data.tax_amount,
    total: args.data.total,
    status: args.data.status,
    pdf_file_id: null,
    issued_at: null,
    sent_at: null,
    received_at: null,
    paid_at: null,
    snapshot: args.data.snapshot,
    created_by: args.data.created_by,
    created_at: now,
    updated_at: now,
    items: args.data.items.create.map((item, index) => ({
      id: `invoice_item_${index + 1}`,
      visit_billing_candidate_id: item.visit_billing_candidate_id as string,
      visit_date: item.visit_date as Date,
      description: item.description as string,
      quantity: item.quantity as number,
      unit_price: item.unit_price as number,
      amount: item.amount as number,
      tax_category: item.tax_category as string,
      created_at: now,
    })),
  };
}

describe('createPharmacyInvoiceDraft', () => {
  const pharmacyInvoiceFindFirstMock = vi.fn();
  const pharmacyInvoiceCreateMock = vi.fn();
  const visitBillingCandidateFindManyMock = vi.fn();
  const visitBillingCandidateUpdateManyMock = vi.fn();
  const auditLogCreateMock = vi.fn();

  function tx() {
    return {
      pharmacyInvoice: {
        findFirst: pharmacyInvoiceFindFirstMock,
        create: pharmacyInvoiceCreateMock,
      },
      visitBillingCandidate: {
        findMany: visitBillingCandidateFindManyMock,
        updateMany: visitBillingCandidateUpdateManyMock,
      },
      auditLog: {
        create: auditLogCreateMock,
      },
    } as unknown as Prisma.TransactionClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyInvoiceFindFirstMock.mockResolvedValue(null);
    pharmacyInvoiceCreateMock.mockImplementation(async (args) => invoiceFromCreateArgs(args));
    visitBillingCandidateFindManyMock.mockResolvedValue([candidate()]);
    visitBillingCandidateUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('creates a paid invoice draft from candidate amount snapshots', async () => {
    const result = await createPharmacyInvoiceDraft(tx(), ctx, {
      billingMonth,
      contractId: 'contract_1',
      documentKind: 'invoice',
    });

    expect(result.reused).toBe(false);
    expect(result.invoice).toMatchObject({
      id: 'invoice_1',
      document_kind: 'invoice',
      billing_month: '2026-06-01',
      subtotal: 5500,
      tax_amount: 550,
      total: 6050,
      item_count: 1,
      items: [
        expect.objectContaining({
          visit_billing_candidate_id: 'candidate_1',
          unit_price: 5500,
          amount: 5500,
          tax_category: 'taxable',
        }),
      ],
    });
    expect(visitBillingCandidateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['candidate_1'] },
          billing_status: { in: ['candidate', 'confirmed'] },
        }),
        data: { billing_status: 'invoiced' },
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_invoice_draft_created',
          changes: expect.objectContaining({
            patient_display_mode: 'management_number',
            subtotal: 5500,
            total: 6050,
          }),
        }),
      }),
    );
    expect(JSON.stringify(pharmacyInvoiceCreateMock.mock.calls)).not.toContain('患者 太郎');
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('患者 太郎');
  });

  it('creates a free cooperation report draft with zero totals', async () => {
    visitBillingCandidateFindManyMock.mockResolvedValue([
      candidate({
        amount_snapshot: {
          fee_rule_id: 'fee_rule_free',
          billing_model: 'free',
          unit_price: null,
          amount: 0,
          tax_category: 'out_of_scope',
          tax_rate_bp: null,
        },
      }),
    ]);

    const result = await createPharmacyInvoiceDraft(tx(), ctx, {
      billingMonth,
      contractId: 'contract_1',
      documentKind: 'free_cooperation_report',
    });

    expect(result.invoice).toMatchObject({
      document_kind: 'free_cooperation_report',
      subtotal: 0,
      tax_amount: 0,
      total: 0,
      items: [
        expect.objectContaining({
          description: '無償協力訪問 2026-06-19',
          unit_price: 0,
          amount: 0,
        }),
      ],
    });
  });

  it('reuses an existing active draft without mutating candidates', async () => {
    pharmacyInvoiceFindFirstMock.mockResolvedValue(
      invoiceFromCreateArgs({
        data: {
          contract_id: 'contract_1',
          document_kind: 'invoice',
          billing_month: billingMonth.start,
          issuer_snapshot: {},
          recipient_snapshot: {},
          subtotal: 5500,
          tax_amount: 550,
          total: 6050,
          status: 'draft',
          snapshot: {},
          created_by: 'user_1',
          items: { create: [] },
        },
      }),
    );

    const result = await createPharmacyInvoiceDraft(tx(), ctx, {
      billingMonth,
      contractId: 'contract_1',
      documentKind: 'invoice',
    });

    expect(result.reused).toBe(true);
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(pharmacyInvoiceCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects paid invoice candidates with non-positive amount snapshots', async () => {
    visitBillingCandidateFindManyMock.mockResolvedValue([
      candidate({
        amount_snapshot: {
          fee_rule_id: 'fee_rule_1',
          billing_model: 'fixed_per_visit',
          unit_price: 0,
          amount: 0,
          tax_category: 'taxable',
          tax_rate_bp: 1000,
        },
      }),
    ]);

    await expect(
      createPharmacyInvoiceDraft(tx(), ctx, {
        billingMonth,
        contractId: 'contract_1',
        documentKind: 'invoice',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CANDIDATE_AMOUNT',
    } satisfies Partial<PharmacyInvoiceDraftError>);
    expect(pharmacyInvoiceCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateManyMock).not.toHaveBeenCalled();
  });
});
