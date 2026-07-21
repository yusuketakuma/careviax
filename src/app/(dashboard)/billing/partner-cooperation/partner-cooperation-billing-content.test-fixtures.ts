export type InvoiceFixture = {
  id: string;
  contract_id: string;
  document_kind: 'invoice' | 'free_cooperation_report';
  invoice_no: string | null;
  billing_month: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: string;
  issued_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  payment_scheduled_for: string | null;
  paid_at: string | null;
  version: number;
  item_count: number;
  partnership: {
    base_site: { id: string; name: string };
    partner_pharmacy: { id: string; name: string; status: string };
  };
};

export function createInvoiceFixture(overrides: Partial<InvoiceFixture> = {}): InvoiceFixture {
  const base: InvoiceFixture = {
    id: 'invoice_existing',
    contract_id: 'contract_1',
    document_kind: 'invoice',
    invoice_no: 'INV-001',
    billing_month: '2026-06-01',
    subtotal: 5500,
    tax_amount: 550,
    total: 6050,
    status: 'draft',
    issued_at: null,
    sent_at: null,
    received_at: null,
    payment_scheduled_for: null,
    paid_at: null,
    version: 1,
    item_count: 1,
    partnership: {
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: {
        id: 'partner_pharmacy_1',
        name: '協力薬局',
        status: 'active',
      },
    },
  };
  return { ...base, ...overrides, partnership: overrides.partnership ?? base.partnership };
}

export function createCandidateFixture(id = 'candidate_1', partnerPharmacyName = '協力薬局') {
  return {
    id,
    billing_month: '2026-06-01T00:00:00.000Z',
    billing_status: 'candidate',
    is_billable: true,
    exclusion_reason: null,
    amount_summary: {
      billing_model: 'fixed_per_visit',
      amount: 5500,
      tax_category: 'taxable',
      blocker_codes: [],
    },
    partner_visit_record: {
      id: `partner_visit_record_${id}`,
      visit_at: '2026-06-18T01:30:00.000Z',
      status: 'confirmed',
      confirmed_at: '2026-06-18T03:00:00.000Z',
      owner_partner_pharmacy: {
        id: id === 'candidate_1' ? 'partner_pharmacy_1' : `partner_pharmacy_${id}`,
        name: partnerPharmacyName,
        status: 'active',
      },
    },
    contract_version: {
      id: 'contract_version_1',
      version_no: 2,
      effective_from: '2026-06-01T00:00:00.000Z',
    },
  };
}

type MetaOptions = {
  hasMore?: boolean;
  nextCursor?: string | null;
  returnedCount?: number;
  totalCount?: number;
  status?: string | null;
  partnerPharmacyId?: string | null;
};

export function candidateMeta({
  hasMore = false,
  nextCursor = null,
  returnedCount = 1,
  totalCount = 1,
  status = null,
  partnerPharmacyId = null,
}: MetaOptions = {}) {
  return {
    limit: 20,
    has_more: hasMore,
    next_cursor: nextCursor,
    returned_count: returnedCount,
    total_count: totalCount,
    count_basis: 'filtered_query_exact',
    filters_applied: {
      billing_month: '2026-06-01',
      status,
      share_case_id: null,
      partner_pharmacy_id: partnerPharmacyId,
    },
  };
}

export function invoiceMeta({
  hasMore = false,
  nextCursor = null,
  returnedCount = 1,
  totalCount = 1,
  status = null,
  partnerPharmacyId = null,
}: MetaOptions = {}) {
  return {
    limit: 20,
    has_more: hasMore,
    next_cursor: nextCursor,
    returned_count: returnedCount,
    total_count: totalCount,
    count_basis: 'filtered_query_exact',
    filters_applied: {
      billing_month: '2026-06-01',
      status,
      document_kind: null,
      contract_id: null,
      partner_pharmacy_id: partnerPharmacyId,
    },
  };
}

export function createCandidateSummaryResponse() {
  return new Response(
    JSON.stringify({
      data: {
        billing_month: '2026-06-01',
        visit_record_count: 4,
        confirmed_visit_record_count: 3,
        unconfirmed_visit_record_count: 1,
        generated_candidate_count: 2,
        billable_candidate_count: 2,
        excluded_candidate_count: 0,
        invoiced_candidate_count: 0,
        free_candidate_count: 1,
        paid_candidate_count: 1,
        planned_invoice_amount: 5500,
        pending_candidate_generation_count: 1,
      },
    }),
    { status: 200 },
  );
}

export function createContractsResponse() {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'contract_1',
          status: 'active',
          effective_from: '2026-06-01T00:00:00.000Z',
          effective_to: null,
          partnership: {
            id: 'partnership_1',
            status: 'active',
            base_site: { id: 'site_1', name: '基幹薬局' },
            partner_pharmacy: {
              id: 'partner_pharmacy_1',
              name: '協力薬局',
              status: 'active',
            },
          },
          latest_version: {
            version_no: 2,
            status: 'active',
            active_fee_rule: {
              billing_model: 'fixed_per_visit',
              unit_price: 5500,
              tax_category: 'taxable',
            },
          },
        },
      ],
      meta: { has_more: false, next_cursor: null },
    }),
    { status: 200 },
  );
}
