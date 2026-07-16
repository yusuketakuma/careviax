'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Receipt,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { apiDataSchema } from '@/lib/api/response-schemas';
import { PHARMACY_INVOICE_PDF_EXPORT_PURPOSE } from '@/lib/audit/export-purpose-codes';
import { formatDateDisplay as formatDate } from '@/lib/datetime/date-display';
import { formatYen } from '@/lib/format/currency';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import {
  pharmacyContractRowSchema as pharmacyCooperationContractRowSchema,
  type PharmacyContractRowContract,
} from '@/lib/pharmacy-cooperation/api-contracts';
import { cn } from '@/lib/utils';

type PartnerCooperationSummary = {
  billing_month: string;
  visit_record_count: number;
  confirmed_visit_record_count: number;
  unconfirmed_visit_record_count: number;
  generated_candidate_count: number;
  billable_candidate_count: number;
  excluded_candidate_count: number;
  invoiced_candidate_count: number;
  free_candidate_count: number;
  paid_candidate_count: number;
  planned_invoice_amount: number;
  pending_candidate_generation_count: number;
};

type PharmacyContractRow = PharmacyContractRowContract;

type VisitBillingCandidateRow = {
  id: string;
  billing_month: string;
  billing_status: string;
  is_billable: boolean;
  exclusion_reason: string | null;
  amount_summary: {
    billing_model: string | null;
    amount: number | null;
    tax_category: string | null;
    blocker_codes: string[];
  };
  partner_visit_record: {
    id: string;
    visit_at: string;
    status: string;
    confirmed_at: string | null;
    owner_partner_pharmacy: { id: string; name: string; status: string };
  };
  contract_version: { id: string; version_no: number; effective_from: string } | null;
};

type PharmacyInvoiceRow = {
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

type InvoiceDraftResult = {
  id: string;
  document_kind: 'invoice' | 'free_cooperation_report';
  status: string;
  billing_month: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  item_count: number;
  reused_existing_draft: boolean;
  message?: string;
};

type PharmacyInvoiceTransitionResult = Omit<PharmacyInvoiceRow, 'partnership'> & {
  updated_at: string;
};

type CandidateGenerationResult = {
  message: string;
  billing_month: string;
  scanned_confirmed_records: number;
  generated_candidates: number;
  billable_count: number;
  excluded_count: number;
  skipped_locked_count: number;
};

type InvoiceTransitionAction =
  | 'issue'
  | 'mark_sent'
  | 'mark_received'
  | 'schedule_payment'
  | 'record_payment'
  | 'cancel'
  | 'reissue';

type PendingInvoiceTransition = {
  invoice: PharmacyInvoiceRow;
  action: InvoiceTransitionAction;
  idempotencyKey: string;
};

const VISIT_BILLING_STATUS_OPTIONS = [
  'candidate',
  'confirmed',
  'excluded',
  'invoiced',
  'voided',
] as const;
const PHARMACY_INVOICE_STATUS_OPTIONS = [
  'draft',
  'issued',
  'sent',
  'received',
  'payment_scheduled',
  'paid',
  'voided',
  'cancelled',
] as const;

const partnerCooperationSummarySchema = z.object({
  billing_month: z.string(),
  visit_record_count: z.number(),
  confirmed_visit_record_count: z.number(),
  unconfirmed_visit_record_count: z.number(),
  generated_candidate_count: z.number(),
  billable_candidate_count: z.number(),
  excluded_candidate_count: z.number(),
  invoiced_candidate_count: z.number(),
  free_candidate_count: z.number(),
  paid_candidate_count: z.number(),
  planned_invoice_amount: z.number(),
  pending_candidate_generation_count: z.number(),
});
const partnerCooperationSummaryResponseSchema = apiDataSchema(partnerCooperationSummarySchema);

const visitBillingCandidateRowSchema = z.object({
  id: z.string(),
  billing_month: z.string(),
  billing_status: z.string(),
  is_billable: z.boolean(),
  exclusion_reason: z.string().nullable(),
  amount_summary: z.object({
    billing_model: z.string().nullable(),
    amount: z.number().nullable(),
    tax_category: z.string().nullable(),
    blocker_codes: z.array(z.string()),
  }),
  partner_visit_record: z.object({
    id: z.string(),
    visit_at: z.string(),
    status: z.string(),
    confirmed_at: z.string().nullable(),
    owner_partner_pharmacy: z.object({ id: z.string(), name: z.string(), status: z.string() }),
  }),
  contract_version: z
    .object({
      id: z.string(),
      version_no: z.number(),
      effective_from: z.string(),
    })
    .nullable(),
});

const pharmacyInvoiceRowSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  document_kind: z.enum(['invoice', 'free_cooperation_report']),
  invoice_no: z.string().nullable(),
  billing_month: z.string(),
  subtotal: z.number(),
  tax_amount: z.number(),
  total: z.number(),
  status: z.string(),
  issued_at: z.string().nullable(),
  sent_at: z.string().nullable(),
  received_at: z.string().nullable(),
  payment_scheduled_for: z.string().nullable(),
  paid_at: z.string().nullable(),
  version: z.number().int().positive(),
  item_count: z.number(),
  partnership: z.object({
    base_site: z.object({ id: z.string(), name: z.string() }),
    partner_pharmacy: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
    }),
  }),
});

const pharmacyInvoiceTransitionResultSchema = pharmacyInvoiceRowSchema
  .omit({
    partnership: true,
  })
  .extend({
    updated_at: z.string(),
  });

const invoiceDraftResultSchema = z.object({
  id: z.string(),
  document_kind: z.enum(['invoice', 'free_cooperation_report']),
  status: z.string(),
  billing_month: z.string(),
  subtotal: z.number(),
  tax_amount: z.number(),
  total: z.number(),
  item_count: z.number(),
  reused_existing_draft: z.boolean(),
  message: z.string().optional(),
});
const invoiceDraftResponseSchema = apiDataSchema(invoiceDraftResultSchema);

const candidateGenerationResultSchema = z.object({
  message: z.string(),
  billing_month: z.string(),
  scanned_confirmed_records: z.number(),
  generated_candidates: z.number(),
  billable_count: z.number(),
  excluded_count: z.number(),
  skipped_locked_count: z.number(),
});
const candidateGenerationResponseSchema = apiDataSchema(candidateGenerationResultSchema);

const activeContractsResponseSchema = apiDataSchema(z.array(pharmacyCooperationContractRowSchema));
const billingCandidatesResponseSchema = z
  .object({
    data: z.array(visitBillingCandidateRowSchema),
    meta: z
      .object({
        limit: z.number().int().min(1).max(100),
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).nullable(),
        returned_count: z.number().int().nonnegative(),
        total_count: z.number().int().nonnegative(),
        count_basis: z.literal('filtered_query_exact'),
        filters_applied: z
          .object({
            billing_month: z.string().nullable(),
            status: z.string().nullable(),
            share_case_id: z.string().nullable(),
            partner_pharmacy_id: z.string().nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.meta.has_more && !value.meta.next_cursor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'next_cursor'],
        message: 'next_cursor is required when has_more is true',
      });
    }
    if (!value.meta.has_more && value.meta.next_cursor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'next_cursor'],
        message: 'next_cursor must be null when has_more is false',
      });
    }
    if (value.meta.returned_count !== value.data.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'returned_count'],
        message: 'returned_count must match data length',
      });
    }
    if (value.meta.total_count < value.meta.returned_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'total_count'],
        message: 'total_count must include returned rows',
      });
    }
  });
const pharmacyInvoicesResponseSchema = z
  .object({
    data: z.array(pharmacyInvoiceRowSchema),
    meta: z
      .object({
        limit: z.number().int().min(1).max(100),
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).nullable(),
        returned_count: z.number().int().nonnegative(),
        total_count: z.number().int().nonnegative(),
        count_basis: z.literal('filtered_query_exact'),
        filters_applied: z
          .object({
            billing_month: z.string().nullable(),
            status: z.string().nullable(),
            document_kind: z.string().nullable(),
            contract_id: z.string().nullable(),
            partner_pharmacy_id: z.string().nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.meta.has_more && !value.meta.next_cursor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'next_cursor'],
        message: 'next_cursor is required when has_more is true',
      });
    }
    if (!value.meta.has_more && value.meta.next_cursor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'next_cursor'],
        message: 'next_cursor must be null when has_more is false',
      });
    }
    if (value.meta.returned_count !== value.data.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'returned_count'],
        message: 'returned_count must match data length',
      });
    }
    if (value.meta.total_count < value.meta.returned_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'total_count'],
        message: 'total_count must include returned rows',
      });
    }
  });
const pharmacyInvoiceTransitionResponseSchema = apiDataSchema(
  pharmacyInvoiceTransitionResultSchema,
);

type CursorPage<T> = {
  data: T[];
  meta: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
    returned_count: number;
    total_count: number;
    count_basis: 'filtered_query_exact';
  };
};

function hasRepeatedCursor(pages: readonly CursorPage<unknown>[], pageParams: readonly unknown[]) {
  const lastPage = pages.at(-1);
  if (!lastPage?.meta.has_more || !lastPage.meta.next_cursor) return false;
  const consumed = new Set(
    pageParams.flatMap((value) => (typeof value === 'string' && value ? [value] : [])),
  );
  const offered = new Set(
    pages.slice(0, -1).flatMap((page) => (page.meta.next_cursor ? [page.meta.next_cursor] : [])),
  );
  return consumed.has(lastPage.meta.next_cursor) || offered.has(lastPage.meta.next_cursor);
}

function getNextCursor<T>(
  lastPage: CursorPage<T>,
  allPages: CursorPage<T>[],
  _lastPageParam: string | undefined,
  allPageParams: Array<string | undefined>,
  errorMessage: string,
) {
  if (!lastPage.meta.has_more) return undefined;
  if (!lastPage.meta.next_cursor) throw new Error(errorMessage);
  if (hasRepeatedCursor(allPages, allPageParams)) return undefined;
  return lastPage.meta.next_cursor;
}

function collectUniqueRows<T extends { id: string }>(pages: readonly CursorPage<T>[]) {
  const seenIds = new Set<string>();
  const rows: T[] = [];
  let hasDuplicateId = false;
  for (const row of pages.flatMap((page) => page.data)) {
    if (seenIds.has(row.id)) {
      hasDuplicateId = true;
      continue;
    }
    seenIds.add(row.id);
    rows.push(row);
  }
  return { rows, hasDuplicateId };
}

function hasCountDrift(pages: readonly CursorPage<unknown>[]) {
  const firstCount = pages[0]?.meta.total_count;
  return firstCount !== undefined && pages.some((page) => page.meta.total_count !== firstCount);
}

const EMPTY_CONTRACTS: PharmacyContractRow[] = [];

function currentMonthInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function todayDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

function canonicalBillingMonth(monthInput: string) {
  return `${monthInput}-01`;
}

function isValidMonthInput(monthInput: string) {
  return /^\d{4}-\d{2}$/.test(monthInput);
}

function safeErrorDetail() {
  return '再試行しても解消しない場合は管理者へ連絡してください。';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    candidate: '候補',
    confirmed: '確認済み',
    excluded: '除外',
    invoiced: '請求化済み',
    voided: '無効',
    draft: '下書き',
    issued: '発行済み',
    sent: '送付済み',
    received: '受領済み',
    payment_scheduled: '支払予定',
    paid: '支払済み',
    cancelled: '取消',
  };
  return labels[status] ?? status;
}

function billingModelLabel(model: string | null) {
  const labels: Record<string, string> = {
    free: '無償',
    fixed_per_visit: '有償/定額',
    per_visit_with_addon: '有償/加算',
    expense_reimbursement: '実費',
  };
  return model ? (labels[model] ?? model) : '未判定';
}

async function fetchSummary(orgId: string, billingMonth: string) {
  const response = await fetch(
    `/api/visit-billing-candidates/summary?billing_month=${encodeURIComponent(billingMonth)}`,
    { headers: buildOrgHeaders(orgId) },
  );
  const json = await readApiJson<{ data: PartnerCooperationSummary }>(response, {
    fallbackMessage: '薬局間協力請求サマリーの取得に失敗しました',
    schema: partnerCooperationSummaryResponseSchema,
  });
  return json.data;
}

async function fetchActiveContracts(orgId: string) {
  const response = await fetch('/api/pharmacy-contracts?status=active&limit=50', {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<{ data: PharmacyContractRow[] }>(response, {
    fallbackMessage: '有効な薬局間契約の取得に失敗しました',
    schema: activeContractsResponseSchema,
  });
  return json.data;
}

async function fetchCandidates(
  orgId: string,
  billingMonth: string,
  filters: { status: string; partnerPharmacyId: string },
  cursor?: string,
) {
  const params = new URLSearchParams({ billing_month: billingMonth, limit: '20' });
  if (filters.status) params.set('status', filters.status);
  if (filters.partnerPharmacyId) {
    params.set('partner_pharmacy_id', filters.partnerPharmacyId);
  }
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/visit-billing-candidates?${params.toString()}`, {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<z.infer<typeof billingCandidatesResponseSchema>>(response, {
    fallbackMessage: '請求候補の取得に失敗しました',
    schema: billingCandidatesResponseSchema,
  });
  if (
    json.meta.filters_applied.billing_month !== billingMonth ||
    json.meta.filters_applied.status !== (filters.status || null) ||
    json.meta.filters_applied.partner_pharmacy_id !== (filters.partnerPharmacyId || null) ||
    json.meta.filters_applied.share_case_id !== null
  ) {
    throw new Error('請求候補の検索条件が応答と一致しません');
  }
  return json;
}

async function fetchInvoices(
  orgId: string,
  billingMonth: string,
  filters: { status: string; partnerPharmacyId: string },
  cursor?: string,
) {
  const params = new URLSearchParams({ billing_month: billingMonth, limit: '20' });
  if (filters.status) params.set('status', filters.status);
  if (filters.partnerPharmacyId) {
    params.set('partner_pharmacy_id', filters.partnerPharmacyId);
  }
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/pharmacy-invoices?${params.toString()}`, {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<z.infer<typeof pharmacyInvoicesResponseSchema>>(response, {
    fallbackMessage: '月次ドキュメントの取得に失敗しました',
    schema: pharmacyInvoicesResponseSchema,
  });
  if (
    json.meta.filters_applied.billing_month !== billingMonth ||
    json.meta.filters_applied.status !== (filters.status || null) ||
    json.meta.filters_applied.partner_pharmacy_id !== (filters.partnerPharmacyId || null) ||
    json.meta.filters_applied.document_kind !== null ||
    json.meta.filters_applied.contract_id !== null
  ) {
    throw new Error('月次ドキュメントの検索条件が応答と一致しません');
  }
  return json;
}

async function patchInvoiceStatus(
  orgId: string,
  invoiceId: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<PharmacyInvoiceTransitionResult> {
  const response = await fetch(`/api/pharmacy-invoices/${invoiceId}`, {
    method: 'PATCH',
    headers: buildOrgHeaders(orgId, {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    }),
    body: JSON.stringify(body),
  });
  const json = await readApiJson(response, {
    fallbackMessage: '月次ドキュメントの更新に失敗しました',
    schema: pharmacyInvoiceTransitionResponseSchema,
  });
  return json.data;
}

function KpiBox({
  label,
  value,
  meta,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  meta: string;
  tone?: 'default' | 'warning' | 'success';
}) {
  return (
    <article className="rounded-lg border border-border/70 bg-card p-4">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-[26px] font-bold leading-9 tabular-nums',
          tone === 'warning' && 'text-state-confirm',
          tone === 'success' && 'text-state-done',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
    </article>
  );
}

function SummaryGrid({ summary }: { summary: PartnerCooperationSummary }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="partner-summary-grid">
      <KpiBox
        label="協力訪問記録"
        value={summary.visit_record_count}
        meta={`確認済み ${summary.confirmed_visit_record_count} / 未確認 ${summary.unconfirmed_visit_record_count}`}
        tone={summary.unconfirmed_visit_record_count > 0 ? 'warning' : 'success'}
      />
      <KpiBox
        label="請求候補"
        value={summary.generated_candidate_count}
        meta={`未生成 ${summary.pending_candidate_generation_count} / 除外 ${summary.excluded_candidate_count}`}
        tone={summary.pending_candidate_generation_count > 0 ? 'warning' : 'default'}
      />
      <KpiBox
        label="有償 / 無償"
        value={`${summary.paid_candidate_count} / ${summary.free_candidate_count}`}
        meta={`請求化済み ${summary.invoiced_candidate_count} 件`}
      />
      <KpiBox
        label="予定請求額"
        value={formatYen(summary.planned_invoice_amount)}
        meta={`${summary.billable_candidate_count} 件の請求可能候補`}
      />
    </div>
  );
}

function ContractSelector({
  contracts,
  value,
  onChange,
}: {
  contracts: PharmacyContractRow[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-foreground">
      対象契約
      <select
        className="min-h-[44px] rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8 sm:min-h-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="対象契約"
      >
        <option value="">契約を選択</option>
        {contracts.map((contract) => (
          <option key={contract.id} value={contract.id}>
            {contract.partnership.partner_pharmacy.name} / v
            {contract.latest_version?.version_no ?? '-'} /{' '}
            {billingModelLabel(contract.latest_version?.active_fee_rule?.billing_model ?? null)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ListFilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-foreground">
      {label}
      <select
        className="min-h-[44px] rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8 sm:min-h-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function collectPartnerPharmacyOptions(
  contracts: readonly PharmacyContractRow[],
  candidates: readonly VisitBillingCandidateRow[],
  invoices: readonly PharmacyInvoiceRow[],
) {
  const byId = new Map<string, string>();
  for (const contract of contracts) {
    const pharmacy = contract.partnership.partner_pharmacy;
    if (!byId.has(pharmacy.id)) byId.set(pharmacy.id, pharmacy.name);
  }
  for (const candidate of candidates) {
    const pharmacy = candidate.partner_visit_record.owner_partner_pharmacy;
    if (!byId.has(pharmacy.id)) byId.set(pharmacy.id, pharmacy.name);
  }
  for (const invoice of invoices) {
    const pharmacy = invoice.partnership.partner_pharmacy;
    if (!byId.has(pharmacy.id)) byId.set(pharmacy.id, pharmacy.name);
  }
  return [...byId].map(([value, label]) => ({ value, label }));
}

function CandidateTable({
  candidates,
  isComplete,
}: {
  candidates: VisitBillingCandidateRow[];
  isComplete: boolean;
}) {
  const columns = useMemo<ColumnDef<VisitBillingCandidateRow>[]>(
    () => [
      {
        id: 'visit_date',
        accessorFn: (candidate) => formatDate(candidate.partner_visit_record.visit_at),
        header: '訪問日',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDate(row.original.partner_visit_record.visit_at)}
          </span>
        ),
        meta: {
          label: '訪問日',
          exportValue: (candidate: VisitBillingCandidateRow) =>
            formatDate(candidate.partner_visit_record.visit_at),
        },
      },
      {
        id: 'partner_pharmacy',
        accessorFn: (candidate) => candidate.partner_visit_record.owner_partner_pharmacy.name,
        header: '協力薬局',
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
        meta: {
          label: '協力薬局',
          exportValue: (candidate: VisitBillingCandidateRow) =>
            candidate.partner_visit_record.owner_partner_pharmacy.name,
        },
      },
      {
        id: 'status',
        accessorFn: (candidate) => statusLabel(candidate.billing_status),
        header: '状態',
        cell: ({ row }) => (
          <Badge variant={row.original.billing_status === 'excluded' ? 'destructive' : 'outline'}>
            {statusLabel(row.original.billing_status)}
          </Badge>
        ),
        meta: {
          label: '状態',
          exportValue: (candidate: VisitBillingCandidateRow) =>
            statusLabel(candidate.billing_status),
        },
      },
      {
        id: 'billing_model',
        accessorFn: (candidate) => billingModelLabel(candidate.amount_summary.billing_model),
        header: '区分',
        cell: ({ row }) => billingModelLabel(row.original.amount_summary.billing_model),
        meta: {
          label: '区分',
          exportValue: (candidate: VisitBillingCandidateRow) =>
            billingModelLabel(candidate.amount_summary.billing_model),
        },
      },
      {
        id: 'amount',
        accessorFn: (candidate) => candidate.amount_summary.amount ?? 0,
        header: '金額',
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatYen(row.original.amount_summary.amount)}
          </span>
        ),
        meta: {
          label: '金額',
          exportValue: (candidate: VisitBillingCandidateRow) =>
            formatYen(candidate.amount_summary.amount),
        },
      },
      {
        id: 'basis',
        accessorFn: (candidate) => {
          const blockerText = candidate.amount_summary.blocker_codes.join(', ');
          return candidate.exclusion_reason ?? (blockerText || '算定候補');
        },
        header: '根拠',
        cell: ({ row }) => {
          const blockerText = row.original.amount_summary.blocker_codes.join(', ');
          return (
            <span className="block max-w-64 text-xs text-muted-foreground">
              {row.original.exclusion_reason ?? (blockerText || '算定候補')}
            </span>
          );
        },
        meta: {
          label: '根拠',
          exportValue: (candidate: VisitBillingCandidateRow) => {
            const blockerText = candidate.amount_summary.blocker_codes.join(', ');
            return candidate.exclusion_reason ?? (blockerText || '算定候補');
          },
        },
      },
    ],
    [],
  );

  if (candidates.length === 0) {
    return (
      <EmptyState
        title={
          isComplete
            ? '薬局間協力の請求候補はまだありません'
            : '読み込み済みの範囲に請求候補はありません'
        }
        description={
          isComplete
            ? '対象月の確認済み協力訪問記録から、請求候補を生成してください。'
            : '未読込の候補があるため、続きの読み込みまたは再読み込みを行ってください。'
        }
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={candidates}
      caption="薬局間協力請求候補一覧"
      getRowId={(candidate) => candidate.id}
      getRowA11yLabel={(candidate) =>
        `${candidate.partner_visit_record.owner_partner_pharmacy.name} ${formatDate(
          candidate.partner_visit_record.visit_at,
        )} ${statusLabel(candidate.billing_status)}`
      }
      toolbar={{
        enableGlobalFilter: true,
        globalFilterPlaceholder: '読込済み請求候補内検索',
        enableColumnVisibility: true,
        filterFields: [
          {
            columnId: 'partner_pharmacy',
            label: '協力薬局',
            placeholder: '読込済み範囲を協力薬局で絞り込み',
          },
          {
            columnId: 'status',
            label: '状態',
            placeholder: '読込済み範囲を状態で絞り込み',
          },
        ],
      }}
    />
  );
}

function DraftResultPanel({ draft }: { draft: InvoiceDraftResult | null }) {
  if (!draft) return null;
  const documentLabel =
    draft.document_kind === 'free_cooperation_report' ? '無償実績報告書' : '請求書';

  return (
    <div
      className="rounded-lg border border-l-4 border-border/70 border-l-state-done bg-card px-4 py-3 text-sm text-foreground"
      data-testid="partner-invoice-draft-result"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-state-done">
            {documentLabel}ドラフト: {draft.id}
          </p>
          <p className="mt-1 text-muted-foreground">
            {draft.item_count}件 / 合計 {formatYen(draft.total)}
            {draft.reused_existing_draft ? ' / 既存ドラフトを再利用' : ''}
          </p>
        </div>
        <a
          href={`/api/pharmacy-invoices/${draft.id}/pdf?purpose=${PHARMACY_INVOICE_PDF_EXPORT_PURPOSE}`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'bg-card')}
        >
          <Download className="size-4" aria-hidden="true" />
          PDFを開く
        </a>
      </div>
    </div>
  );
}

function documentKindLabel(kind: PharmacyInvoiceRow['document_kind']) {
  return kind === 'free_cooperation_report' ? '無償実績報告書' : '請求書';
}

function invoiceNumberLabel(invoice: PharmacyInvoiceRow) {
  return invoice.invoice_no ?? '未採番';
}

function invoiceActions(status: string): InvoiceTransitionAction[] {
  if (status === 'draft') return ['issue'];
  if (status === 'issued') return ['mark_sent', 'schedule_payment', 'cancel', 'reissue'];
  if (status === 'sent') return ['mark_received', 'schedule_payment', 'cancel', 'reissue'];
  if (status === 'received') return ['schedule_payment', 'record_payment', 'cancel', 'reissue'];
  if (status === 'payment_scheduled') return ['record_payment', 'cancel', 'reissue'];
  if (status === 'paid') return ['reissue'];
  return [];
}

function invoiceActionLabel(action: InvoiceTransitionAction) {
  const labels: Record<InvoiceTransitionAction, string> = {
    issue: '発行',
    mark_sent: '送付',
    mark_received: '受領',
    schedule_payment: '支払予定',
    record_payment: '入金',
    cancel: '取消',
    reissue: '再発行',
  };
  return labels[action];
}

function invoiceActionIcon(action: InvoiceTransitionAction) {
  if (action === 'mark_sent') return <Send className="size-4" aria-hidden="true" />;
  if (action === 'schedule_payment') return <CalendarClock className="size-4" aria-hidden="true" />;
  if (action === 'record_payment' || action === 'issue' || action === 'mark_received') {
    return <CheckCircle2 className="size-4" aria-hidden="true" />;
  }
  if (action === 'cancel') return <XCircle className="size-4" aria-hidden="true" />;
  return <RefreshCw className="size-4" aria-hidden="true" />;
}

function invoiceActionRequiresReason(action: InvoiceTransitionAction) {
  return action === 'cancel' || action === 'reissue';
}

function invoiceActionReasonLabel(action: InvoiceTransitionAction) {
  return action === 'cancel' ? '取消理由' : '再発行理由';
}

function invoiceActionVariant(action: InvoiceTransitionAction) {
  return action === 'cancel' || action === 'reissue' ? 'destructive' : 'default';
}

function buildInvoiceTransitionBody({
  action,
  version,
  scheduledFor,
  reason,
}: {
  action: InvoiceTransitionAction;
  version: number;
  scheduledFor: string;
  reason: string;
}) {
  const body: Record<string, unknown> = { action, version };
  const today = todayDateInputValue();
  if (
    action === 'issue' ||
    action === 'mark_sent' ||
    action === 'mark_received' ||
    action === 'record_payment'
  ) {
    body.occurred_at = today;
  }
  if (action === 'schedule_payment') {
    body.payment_scheduled_for = scheduledFor;
  }
  if (invoiceActionRequiresReason(action)) {
    body.reason = reason.trim();
  }
  return body;
}

function invoiceTransitionDescription({
  invoice,
  action,
  scheduledFor,
}: {
  invoice: PharmacyInvoiceRow;
  action: InvoiceTransitionAction;
  scheduledFor: string;
}) {
  const actionLabel = invoiceActionLabel(action);
  const base = `${invoice.partnership.base_site.name} / ${invoice.partnership.partner_pharmacy.name}、${formatDate(
    invoice.billing_month,
  )}、${invoiceNumberLabel(invoice)}、合計 ${formatYen(invoice.total)}。`;
  if (action === 'schedule_payment') {
    return `${base} 支払予定日を ${formatDate(scheduledFor)} として${actionLabel}に更新します。`;
  }
  if (invoiceActionRequiresReason(action)) {
    return `${base} ${actionLabel}は監査ログに記録されます。理由を入力して確定してください。`;
  }
  return `${base} ${documentKindLabel(invoice.document_kind)}を${actionLabel}として更新します。`;
}

function InvoiceHistoryTable({
  invoices,
  isComplete,
  scheduledDates,
  onScheduledDateChange,
  onTransition,
  pendingInvoiceId,
}: {
  invoices: PharmacyInvoiceRow[];
  isComplete: boolean;
  scheduledDates: Record<string, string>;
  onScheduledDateChange: (invoiceId: string, value: string) => void;
  onTransition: (invoice: PharmacyInvoiceRow, action: InvoiceTransitionAction) => void;
  pendingInvoiceId: string | null;
}) {
  const columns = useMemo<ColumnDef<PharmacyInvoiceRow>[]>(
    () => [
      {
        id: 'document',
        accessorFn: (invoice) =>
          `${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)}`,
        header: 'ドキュメント',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{documentKindLabel(row.original.document_kind)}</div>
            <div className="text-xs text-muted-foreground">{invoiceNumberLabel(row.original)}</div>
          </div>
        ),
        meta: {
          label: 'ドキュメント',
          exportValue: (invoice: PharmacyInvoiceRow) =>
            `${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)}`,
        },
      },
      {
        id: 'partner_pharmacy',
        accessorFn: (invoice) =>
          `${invoice.partnership.base_site.name} / ${invoice.partnership.partner_pharmacy.name}`,
        header: '協力薬局',
        cell: ({ row }) =>
          `${row.original.partnership.base_site.name} / ${row.original.partnership.partner_pharmacy.name}`,
        meta: {
          label: '協力薬局',
          exportValue: (invoice: PharmacyInvoiceRow) =>
            `${invoice.partnership.base_site.name} / ${invoice.partnership.partner_pharmacy.name}`,
        },
      },
      {
        id: 'total',
        accessorFn: (invoice) => invoice.total,
        header: '金額',
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatYen(row.original.total)}</span>
        ),
        meta: {
          label: '金額',
          exportValue: (invoice: PharmacyInvoiceRow) => formatYen(invoice.total),
        },
      },
      {
        id: 'item_count',
        accessorFn: (invoice) => invoice.item_count,
        header: '件数',
        cell: ({ row }) => <span className="tabular-nums">{row.original.item_count}件</span>,
        meta: {
          label: '件数',
          exportValue: (invoice: PharmacyInvoiceRow) => `${invoice.item_count}件`,
        },
      },
      {
        id: 'status',
        accessorFn: (invoice) => statusLabel(invoice.status),
        header: '状態',
        cell: ({ row }) => (
          <div>
            <Badge variant={row.original.status === 'voided' ? 'destructive' : 'outline'}>
              {statusLabel(row.original.status)}
            </Badge>
            {row.original.payment_scheduled_for ? (
              <div className="mt-1 text-xs text-muted-foreground">
                支払予定 {formatDate(row.original.payment_scheduled_for)}
              </div>
            ) : null}
          </div>
        ),
        meta: {
          label: '状態',
          exportValue: (invoice: PharmacyInvoiceRow) => {
            const schedule = invoice.payment_scheduled_for
              ? ` / 支払予定 ${formatDate(invoice.payment_scheduled_for)}`
              : '';
            return `${statusLabel(invoice.status)}${schedule}`;
          },
        },
      },
      {
        id: 'output',
        accessorFn: (invoice) =>
          `${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)} PDF`,
        header: '出力',
        enableSorting: false,
        cell: ({ row }) => {
          const invoice = row.original;
          return (
            <a
              href={`/api/pharmacy-invoices/${invoice.id}/pdf?purpose=${PHARMACY_INVOICE_PDF_EXPORT_PURPOSE}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              aria-label={`${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)} PDFを開く`}
            >
              <Download className="size-4" aria-hidden="true" />
              PDF
            </a>
          );
        },
        meta: {
          label: '出力',
          exportValue: (invoice: PharmacyInvoiceRow) =>
            `${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)} PDF`,
        },
      },
      {
        id: 'actions',
        accessorFn: (invoice) => invoiceActions(invoice.status).map(invoiceActionLabel).join(' '),
        header: '操作',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const invoice = row.original;
          const actions = invoiceActions(invoice.status);
          const isPending = pendingInvoiceId === invoice.id;
          return (
            <div>
              {actions.includes('schedule_payment') ? (
                <Input
                  type="date"
                  className="mb-2 h-8 w-40"
                  value={scheduledDates[invoice.id] ?? todayDateInputValue()}
                  onChange={(event) => onScheduledDateChange(invoice.id, event.target.value)}
                  aria-label={`支払予定日 ${invoiceNumberLabel(invoice)}`}
                />
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {actions.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    variant={action === 'cancel' ? 'destructive' : 'outline'}
                    disabled={isPending}
                    onClick={() => onTransition(invoice, action)}
                    aria-label={`${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)} ${invoiceActionLabel(action)}`}
                  >
                    {invoiceActionIcon(action)}
                    {invoiceActionLabel(action)}
                  </Button>
                ))}
              </div>
            </div>
          );
        },
        meta: {
          label: '操作',
          exportValue: (invoice: PharmacyInvoiceRow) =>
            invoiceActions(invoice.status).map(invoiceActionLabel).join(', '),
        },
      },
    ],
    [onScheduledDateChange, onTransition, pendingInvoiceId, scheduledDates],
  );

  if (invoices.length === 0) {
    return (
      <EmptyState
        title={
          isComplete
            ? '対象月の薬局間月次ドキュメントはまだありません'
            : '読み込み済みの範囲に月次ドキュメントはありません'
        }
        description={
          isComplete
            ? undefined
            : '未読込のドキュメントがあるため、続きの読み込みまたは再読み込みを行ってください。'
        }
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={invoices}
      caption="薬局間月次ドキュメント一覧"
      getRowId={(invoice) => invoice.id}
      getRowA11yLabel={(invoice) =>
        `${documentKindLabel(invoice.document_kind)} ${invoiceNumberLabel(invoice)} ${invoice.partnership.partner_pharmacy.name}`
      }
      toolbar={{
        enableGlobalFilter: true,
        globalFilterPlaceholder: '読込済み月次ドキュメント内検索',
        enableColumnVisibility: true,
        filterFields: [
          {
            columnId: 'partner_pharmacy',
            label: '協力薬局',
            placeholder: '読込済み範囲を協力薬局で絞り込み',
          },
          {
            columnId: 'status',
            label: '状態',
            placeholder: '読込済み範囲を状態で絞り込み',
          },
        ],
      }}
    />
  );
}

export function PartnerCooperationBillingContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [monthInput, setMonthInput] = useState(currentMonthInputValue);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [partnerPharmacyFilter, setPartnerPharmacyFilter] = useState('');
  const [candidateStatusFilter, setCandidateStatusFilter] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('');
  const [lastDraft, setLastDraft] = useState<InvoiceDraftResult | null>(null);
  const [scheduledDates, setScheduledDates] = useState<Record<string, string>>({});
  const [pendingInvoiceTransition, setPendingInvoiceTransition] =
    useState<PendingInvoiceTransition | null>(null);
  const [transitionReason, setTransitionReason] = useState('');
  const isMonthInputValid = isValidMonthInput(monthInput);
  const billingMonth = useMemo(
    () => (isMonthInputValid ? canonicalBillingMonth(monthInput) : ''),
    [isMonthInputValid, monthInput],
  );
  const enabled = Boolean(orgId && isMonthInputValid);

  const summaryQuery = useQuery({
    queryKey: ['partner-cooperation-summary', orgId, billingMonth],
    queryFn: () => fetchSummary(orgId, billingMonth),
    enabled,
    staleTime: 20_000,
  });

  const contractsQuery = useQuery({
    queryKey: ['partner-cooperation-contracts', orgId],
    queryFn: () => fetchActiveContracts(orgId),
    enabled,
    staleTime: 60_000,
  });

  const candidateQueryKey = [
    'partner-cooperation-candidates',
    orgId,
    billingMonth,
    candidateStatusFilter,
    partnerPharmacyFilter,
  ] as const;
  const invoiceQueryKey = [
    'partner-cooperation-invoices',
    orgId,
    billingMonth,
    invoiceStatusFilter,
    partnerPharmacyFilter,
  ] as const;

  const candidatesQuery = useInfiniteQuery({
    queryKey: candidateQueryKey,
    queryFn: ({ pageParam }) =>
      fetchCandidates(
        orgId,
        billingMonth,
        { status: candidateStatusFilter, partnerPharmacyId: partnerPharmacyFilter },
        pageParam,
      ),
    getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) =>
      getNextCursor(
        lastPage,
        allPages,
        lastPageParam,
        allPageParams,
        '請求候補の取得に失敗しました',
      ),
    initialPageParam: undefined as string | undefined,
    enabled,
    staleTime: 20_000,
  });

  const invoicesQuery = useInfiniteQuery({
    queryKey: invoiceQueryKey,
    queryFn: ({ pageParam }) =>
      fetchInvoices(
        orgId,
        billingMonth,
        { status: invoiceStatusFilter, partnerPharmacyId: partnerPharmacyFilter },
        pageParam,
      ),
    getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) =>
      getNextCursor(
        lastPage,
        allPages,
        lastPageParam,
        allPageParams,
        '月次ドキュメントの取得に失敗しました',
      ),
    initialPageParam: undefined as string | undefined,
    enabled,
    staleTime: 20_000,
  });

  const candidateCollection = collectUniqueRows(candidatesQuery.data?.pages ?? []);
  const invoiceCollection = collectUniqueRows(invoicesQuery.data?.pages ?? []);
  const candidates = candidateCollection.rows;
  const invoices = invoiceCollection.rows;
  const candidateCursorCycle = hasRepeatedCursor(
    candidatesQuery.data?.pages ?? [],
    candidatesQuery.data?.pageParams ?? [],
  );
  const invoiceCursorCycle = hasRepeatedCursor(
    invoicesQuery.data?.pages ?? [],
    invoicesQuery.data?.pageParams ?? [],
  );
  const candidateInitialError = candidatesQuery.isError && candidates.length === 0;
  const invoiceInitialError = invoicesQuery.isError && invoices.length === 0;
  const candidateCountDrift = hasCountDrift(candidatesQuery.data?.pages ?? []);
  const invoiceCountDrift = hasCountDrift(invoicesQuery.data?.pages ?? []);
  const candidateTotalCount = candidatesQuery.data?.pages[0]?.meta.total_count ?? 0;
  const invoiceTotalCount = invoicesQuery.data?.pages[0]?.meta.total_count ?? 0;
  const candidateCountMismatch =
    !candidatesQuery.hasNextPage && candidates.length !== candidateTotalCount;
  const invoiceCountMismatch = !invoicesQuery.hasNextPage && invoices.length !== invoiceTotalCount;

  const contracts = contractsQuery.data ?? EMPTY_CONTRACTS;
  const selectedContract =
    contracts.find((contract) => contract.id === selectedContractId) ?? contracts[0] ?? null;
  const effectiveContractId = selectedContract?.id ?? '';
  const partnerPharmacyOptions = collectPartnerPharmacyOptions(contracts, candidates, invoices);

  const restartCandidates = async () => {
    await queryClient.resetQueries({ queryKey: candidateQueryKey, exact: true });
  };
  const restartInvoices = async () => {
    await queryClient.resetQueries({ queryKey: invoiceQueryKey, exact: true });
  };

  const invalidateMonth = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partner-cooperation-summary', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['partner-cooperation-candidates', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['partner-cooperation-invoices', orgId] }),
    ]);
  };

  const generateCandidatesMutation = useMutation({
    mutationFn: async () => {
      if (!isMonthInputValid) throw new Error('対象月を選択してください');
      const response = await fetch('/api/visit-billing-candidates', {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({ billing_month: billingMonth }),
      });
      const json = await readApiJson<{ data: CandidateGenerationResult }>(response, {
        fallbackMessage: '請求候補の生成に失敗しました',
        schema: candidateGenerationResponseSchema,
      });
      return json.data;
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      setLastDraft(null);
      await invalidateMonth();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '請求候補の生成に失敗しました'));
    },
  });

  const createInvoiceDraftMutation = useMutation({
    mutationFn: async (documentKind: 'invoice' | 'free_cooperation_report') => {
      if (!isMonthInputValid) throw new Error('対象月を選択してください');
      if (!effectiveContractId) throw new Error('対象契約を選択してください');
      const response = await fetch('/api/pharmacy-invoices', {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          billing_month: billingMonth,
          contract_id: effectiveContractId,
          document_kind: documentKind,
        }),
      });
      const json = await readApiJson(response, {
        fallbackMessage: '薬局間月次ドキュメントの作成に失敗しました',
        schema: invoiceDraftResponseSchema,
      });
      return json.data;
    },
    onSuccess: async (result) => {
      setLastDraft(result);
      toast.success(result.message ?? '薬局間月次ドキュメントを作成しました');
      await invalidateMonth();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '薬局間月次ドキュメントの作成に失敗しました'));
    },
  });

  const transitionInvoiceMutation = useMutation({
    mutationFn: async ({
      invoice,
      idempotencyKey,
      body,
    }: {
      invoice: PharmacyInvoiceRow;
      idempotencyKey: string;
      body: Record<string, unknown>;
    }) => {
      return patchInvoiceStatus(orgId, invoice.id, idempotencyKey, body);
    },
    retry: (failureCount, error) => failureCount < 1 && error instanceof TypeError,
    retryDelay: 0,
    onSuccess: async (invoice) => {
      toast.success(`${documentKindLabel(invoice.document_kind)}を更新しました`);
      closeInvoiceTransitionDialog();
      setLastDraft(null);
      await invalidateMonth();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '薬局間月次ドキュメントの更新に失敗しました'));
    },
  });

  const isBusy =
    generateCandidatesMutation.isPending ||
    createInvoiceDraftMutation.isPending ||
    transitionInvoiceMutation.isPending;
  const summary = summaryQuery.data ?? null;
  const pendingScheduledFor = pendingInvoiceTransition
    ? (scheduledDates[pendingInvoiceTransition.invoice.id] ?? todayDateInputValue())
    : todayDateInputValue();
  const transitionReasonRequired = pendingInvoiceTransition
    ? invoiceActionRequiresReason(pendingInvoiceTransition.action)
    : false;
  const trimmedTransitionReason = transitionReason.trim();

  function closeInvoiceTransitionDialog() {
    setPendingInvoiceTransition(null);
    setTransitionReason('');
  }

  function confirmInvoiceTransition() {
    if (!pendingInvoiceTransition) return;
    if (transitionReasonRequired && !trimmedTransitionReason) return;
    transitionInvoiceMutation.mutate({
      invoice: pendingInvoiceTransition.invoice,
      idempotencyKey: pendingInvoiceTransition.idempotencyKey,
      body: buildInvoiceTransitionBody({
        action: pendingInvoiceTransition.action,
        version: pendingInvoiceTransition.invoice.version,
        scheduledFor: pendingScheduledFor,
        reason: trimmedTransitionReason,
      }),
    });
  }

  return (
    <div className="space-y-6" data-testid="partner-cooperation-billing">
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="partner-cooperation-controls-heading"
      >
        <h2 id="partner-cooperation-controls-heading" className="sr-only">
          月次請求操作と一覧フィルター
        </h2>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[36rem]">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              対象月
              <Input
                type="month"
                value={monthInput}
                onChange={(event) => {
                  setMonthInput(event.target.value);
                  setLastDraft(null);
                }}
                aria-label="対象月"
                aria-invalid={!isMonthInputValid}
              />
              {!isMonthInputValid ? (
                <span className="text-xs font-normal text-destructive">
                  対象月を選択してください。
                </span>
              ) : null}
            </label>
            {contractsQuery.isLoading ? (
              <div className="grid gap-1.5 text-sm font-medium text-foreground">
                対象契約
                <Skeleton className="h-11 rounded-lg sm:h-8" />
              </div>
            ) : contractsQuery.isError ? (
              <div className="grid gap-1.5 text-sm font-medium text-foreground">
                対象契約
                <ErrorState
                  variant="server"
                  size="inline"
                  title="有効な薬局間契約を表示できません"
                  description="契約一覧の取得に失敗しました。再試行してください。"
                  detail={safeErrorDetail()}
                  onRetry={() => void contractsQuery.refetch()}
                  retrySize="sm"
                />
              </div>
            ) : (
              <ContractSelector
                contracts={contracts}
                value={effectiveContractId}
                onChange={(value) => {
                  setSelectedContractId(value);
                  setLastDraft(null);
                }}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => generateCandidatesMutation.mutate()}
              disabled={!enabled || isBusy}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              候補を生成
            </Button>
            <Button
              type="button"
              onClick={() => createInvoiceDraftMutation.mutate('invoice')}
              disabled={!enabled || !effectiveContractId || isBusy}
            >
              <Receipt className="size-4" aria-hidden="true" />
              請求書ドラフト
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => createInvoiceDraftMutation.mutate('free_cooperation_report')}
              disabled={!enabled || !effectiveContractId || isBusy}
            >
              <FileText className="size-4" aria-hidden="true" />
              無償報告書
            </Button>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {selectedContract ? (
            <span>
              選択中: {selectedContract.partnership.base_site.name} /{' '}
              {selectedContract.partnership.partner_pharmacy.name} / 契約 {selectedContract.id}
            </span>
          ) : contractsQuery.isError ? (
            <span>契約一覧を取得できませんでした。上の「再試行」から取得し直してください。</span>
          ) : (
            <span>有効な薬局間契約を作成すると、請求書と無償実績報告書を生成できます。</span>
          )}
        </div>
        <div className="mt-4 border-t border-border/70 pt-4">
          <p className="mb-3 text-sm font-semibold text-foreground">一覧のサーバー検索条件</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ListFilterSelect
              label="一覧の協力薬局"
              value={partnerPharmacyFilter}
              allLabel="すべての協力薬局"
              options={partnerPharmacyOptions}
              onChange={setPartnerPharmacyFilter}
            />
            <ListFilterSelect
              label="請求候補の状態"
              value={candidateStatusFilter}
              allLabel="すべての候補状態"
              options={VISIT_BILLING_STATUS_OPTIONS.map((status) => ({
                value: status,
                label: statusLabel(status),
              }))}
              onChange={setCandidateStatusFilter}
            />
            <ListFilterSelect
              label="月次出力の状態"
              value={invoiceStatusFilter}
              allLabel="すべての出力状態"
              options={PHARMACY_INVOICE_STATUS_OPTIONS.map((status) => ({
                value: status,
                label: statusLabel(status),
              }))}
              onChange={setInvoiceStatusFilter}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            ここで指定した条件は全件数と追加読込へ適用されます。表内検索は読込済み範囲だけが対象です。
          </p>
        </div>
      </section>

      <DraftResultPanel draft={lastDraft} />

      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="partner-cooperation-summary-heading"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="partner-cooperation-summary-heading" className="text-base font-bold">
              月次集計
            </h2>
            <p className="text-sm text-muted-foreground">{billingMonth} の協力訪問請求状況</p>
          </div>
          {summary ? (
            <Badge
              variant={summary.pending_candidate_generation_count > 0 ? 'destructive' : 'outline'}
            >
              未生成 {summary.pending_candidate_generation_count}件
            </Badge>
          ) : null}
        </div>
        {summaryQuery.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : summaryQuery.isError || !summary ? (
          <ErrorState
            variant="server"
            title="薬局間協力の月次集計を表示できません"
            description="対象月の集計取得に失敗しました。再試行してください。"
            detail={safeErrorDetail()}
            onRetry={() => void summaryQuery.refetch()}
          />
        ) : (
          <SummaryGrid summary={summary} />
        )}
      </section>

      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="partner-cooperation-candidates-heading"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="partner-cooperation-candidates-heading" className="text-base font-bold">
              請求候補
            </h2>
            <p className="text-sm text-muted-foreground">候補状態と月次金額を確認します。</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void restartCandidates()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            更新
          </Button>
        </div>
        {candidatesQuery.isLoading ? (
          <Skeleton className="h-72 rounded-lg" />
        ) : candidateInitialError ? (
          <ErrorState
            variant="server"
            title="薬局間協力の請求候補を表示できません"
            description="候補一覧の取得に失敗しました。再試行してください。"
            detail={safeErrorDetail()}
            onRetry={() => void restartCandidates()}
          />
        ) : (
          <div className="space-y-4">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              請求候補を {candidates.length} / 全 {candidateTotalCount} 件読み込み済みです。
              {candidatesQuery.hasNextPage ||
              candidateCursorCycle ||
              candidateCollection.hasDuplicateId ||
              candidateCountDrift ||
              candidateCountMismatch ||
              candidatesQuery.isError
                ? '未読込または要確認の候補があります。'
                : '対象月の候補一覧は確認済みです。'}
            </p>
            <CandidateTable
              candidates={candidates}
              isComplete={
                !candidatesQuery.hasNextPage &&
                !candidateCursorCycle &&
                !candidatesQuery.isError &&
                !candidateCollection.hasDuplicateId &&
                !candidateCountDrift &&
                !candidateCountMismatch
              }
            />
            {candidatesQuery.isFetchNextPageError ? (
              <ErrorState
                variant="server"
                size="inline"
                title="続きの請求候補を取得できませんでした"
                description="読み込み済みの候補は保持しています。通信状態を確認して再試行してください。"
                onRetry={() => void candidatesQuery.fetchNextPage()}
                retryLabel="続きを再試行"
              />
            ) : candidateCursorCycle ? (
              <ErrorState
                variant="server"
                size="inline"
                title="続きの読み込み位置が重複しました"
                description="読み込み済みの候補は保持しています。候補一覧を再読み込みしてください。"
                onRetry={() => void restartCandidates()}
                retryLabel="再読み込み"
              />
            ) : candidateCollection.hasDuplicateId ? (
              <ErrorState
                variant="server"
                size="inline"
                title="請求候補の重複を検出しました"
                description="重複行は表示していません。候補一覧を再読み込みしてください。"
                onRetry={() => void restartCandidates()}
                retryLabel="再読み込み"
              />
            ) : candidateCountDrift || candidateCountMismatch ? (
              <ErrorState
                variant="server"
                size="inline"
                title="請求候補の全件数と読込結果が一致しません"
                description="一覧が更新された可能性があります。先頭から再読み込みしてください。"
                onRetry={() => void restartCandidates()}
                retryLabel="再読み込み"
              />
            ) : null}
            {candidatesQuery.hasNextPage &&
            !candidateCursorCycle &&
            !candidateCollection.hasDuplicateId &&
            !candidateCountDrift &&
            !candidateCountMismatch &&
            !candidatesQuery.isFetchNextPageError ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void candidatesQuery.fetchNextPage()}
                  disabled={candidatesQuery.isFetchingNextPage}
                  aria-label="請求候補をさらに読み込む"
                >
                  {candidatesQuery.isFetchingNextPage ? '請求候補を追加読込中…' : 'さらに読み込む'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="partner-cooperation-invoices-heading"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="partner-cooperation-invoices-heading" className="text-base font-bold">
              月次出力履歴
            </h2>
            <p className="text-sm text-muted-foreground">
              対象月の請求書と無償実績報告書を確認します。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void restartInvoices()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            更新
          </Button>
        </div>
        {invoicesQuery.isLoading ? (
          <Skeleton className="h-52 rounded-lg" />
        ) : invoiceInitialError ? (
          <ErrorState
            variant="server"
            title="薬局間月次ドキュメントを表示できません"
            description="出力履歴の取得に失敗しました。再試行してください。"
            detail={safeErrorDetail()}
            onRetry={() => void restartInvoices()}
          />
        ) : (
          <div className="space-y-4">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              月次ドキュメントを {invoices.length} / 全 {invoiceTotalCount} 件読み込み済みです。
              {invoicesQuery.hasNextPage ||
              invoiceCursorCycle ||
              invoiceCollection.hasDuplicateId ||
              invoiceCountDrift ||
              invoiceCountMismatch ||
              invoicesQuery.isError
                ? '未読込または要確認のドキュメントがあります。'
                : '対象月の出力履歴は確認済みです。'}
            </p>
            <InvoiceHistoryTable
              invoices={invoices}
              isComplete={
                !invoicesQuery.hasNextPage &&
                !invoiceCursorCycle &&
                !invoicesQuery.isError &&
                !invoiceCollection.hasDuplicateId &&
                !invoiceCountDrift &&
                !invoiceCountMismatch
              }
              scheduledDates={scheduledDates}
              onScheduledDateChange={(invoiceId, value) =>
                setScheduledDates((current) => ({ ...current, [invoiceId]: value }))
              }
              onTransition={(invoice, action) =>
                setPendingInvoiceTransition({
                  invoice,
                  action,
                  idempotencyKey: createClientIdempotencyKey(
                    'pharmacy-invoice-transition',
                    invoice.id,
                    action,
                  ),
                })
              }
              pendingInvoiceId={
                transitionInvoiceMutation.isPending
                  ? (transitionInvoiceMutation.variables?.invoice.id ?? null)
                  : null
              }
            />
            {invoicesQuery.isFetchNextPageError ? (
              <ErrorState
                variant="server"
                size="inline"
                title="続きの月次ドキュメントを取得できませんでした"
                description="読み込み済みのドキュメントは保持しています。通信状態を確認して再試行してください。"
                onRetry={() => void invoicesQuery.fetchNextPage()}
                retryLabel="続きを再試行"
              />
            ) : invoiceCursorCycle ? (
              <ErrorState
                variant="server"
                size="inline"
                title="続きの読み込み位置が重複しました"
                description="読み込み済みのドキュメントは保持しています。出力履歴を再読み込みしてください。"
                onRetry={() => void restartInvoices()}
                retryLabel="再読み込み"
              />
            ) : invoiceCollection.hasDuplicateId ? (
              <ErrorState
                variant="server"
                size="inline"
                title="月次ドキュメントの重複を検出しました"
                description="重複行は表示していません。出力履歴を再読み込みしてください。"
                onRetry={() => void restartInvoices()}
                retryLabel="再読み込み"
              />
            ) : invoiceCountDrift || invoiceCountMismatch ? (
              <ErrorState
                variant="server"
                size="inline"
                title="月次ドキュメントの全件数と読込結果が一致しません"
                description="一覧が更新された可能性があります。先頭から再読み込みしてください。"
                onRetry={() => void restartInvoices()}
                retryLabel="再読み込み"
              />
            ) : null}
            {invoicesQuery.hasNextPage &&
            !invoiceCursorCycle &&
            !invoiceCollection.hasDuplicateId &&
            !invoiceCountDrift &&
            !invoiceCountMismatch &&
            !invoicesQuery.isFetchNextPageError ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void invoicesQuery.fetchNextPage()}
                  disabled={invoicesQuery.isFetchingNextPage}
                  aria-label="月次ドキュメントをさらに読み込む"
                >
                  {invoicesQuery.isFetchingNextPage
                    ? '月次ドキュメントを追加読込中…'
                    : 'さらに読み込む'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pendingInvoiceTransition !== null}
        onOpenChange={(open) => {
          if (!open) closeInvoiceTransitionDialog();
        }}
        title={
          pendingInvoiceTransition
            ? `${documentKindLabel(pendingInvoiceTransition.invoice.document_kind)}を${invoiceActionLabel(
                pendingInvoiceTransition.action,
              )}します`
            : '薬局間月次ドキュメントを更新します'
        }
        description={
          pendingInvoiceTransition
            ? invoiceTransitionDescription({
                invoice: pendingInvoiceTransition.invoice,
                action: pendingInvoiceTransition.action,
                scheduledFor: pendingScheduledFor,
              })
            : ''
        }
        confirmLabel={
          pendingInvoiceTransition
            ? `${invoiceActionLabel(pendingInvoiceTransition.action)}する`
            : '更新する'
        }
        variant={
          pendingInvoiceTransition
            ? invoiceActionVariant(pendingInvoiceTransition.action)
            : 'default'
        }
        confirmDisabled={
          transitionInvoiceMutation.isPending ||
          (transitionReasonRequired && !trimmedTransitionReason)
        }
        closeOnConfirm={false}
        onConfirm={confirmInvoiceTransition}
      >
        {pendingInvoiceTransition && transitionReasonRequired ? (
          <div className="space-y-2">
            <Label htmlFor="invoice-transition-reason">
              {invoiceActionReasonLabel(pendingInvoiceTransition.action)}
            </Label>
            <Textarea
              id="invoice-transition-reason"
              value={transitionReason}
              onChange={(event) => setTransitionReason(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={`${invoiceActionReasonLabel(pendingInvoiceTransition.action)}を入力`}
            />
            <p className="text-xs text-muted-foreground">
              理由は監査ログに長さのみ記録され、画面には表示されません。
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
