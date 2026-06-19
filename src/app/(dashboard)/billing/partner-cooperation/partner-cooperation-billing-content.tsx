'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
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

type PharmacyContractRow = {
  id: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  partnership: {
    partner_pharmacy: { name: string; status: string };
    base_site: { name: string };
  };
  latest_version: {
    version_no: number;
    active_fee_rule: {
      billing_model: string;
      unit_price: number | null;
      tax_category: string;
    } | null;
  } | null;
};

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
    owner_partner_pharmacy: { name: string; status: string };
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

function formatYen(value: number | null | undefined) {
  return `${Math.round(value ?? 0).toLocaleString('ja-JP')}円`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return value.slice(0, 10);
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

async function readApiJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
        ? json.message
        : '処理に失敗しました';
    throw new Error(message);
  }
  return json as T;
}

async function fetchSummary(orgId: string, billingMonth: string) {
  const response = await fetch(
    `/api/visit-billing-candidates/summary?billing_month=${encodeURIComponent(billingMonth)}`,
    { headers: { 'x-org-id': orgId } },
  );
  return readApiJson<PartnerCooperationSummary>(response);
}

async function fetchActiveContracts(orgId: string) {
  const response = await fetch('/api/pharmacy-contracts?status=active&limit=50', {
    headers: { 'x-org-id': orgId },
  });
  const json = await readApiJson<{ data: PharmacyContractRow[] }>(response);
  return json.data;
}

async function fetchCandidates(orgId: string, billingMonth: string) {
  const response = await fetch(
    `/api/visit-billing-candidates?billing_month=${encodeURIComponent(billingMonth)}&limit=20`,
    { headers: { 'x-org-id': orgId } },
  );
  const json = await readApiJson<{ data: VisitBillingCandidateRow[] }>(response);
  return json.data;
}

async function fetchInvoices(orgId: string, billingMonth: string) {
  const response = await fetch(
    `/api/pharmacy-invoices?billing_month=${encodeURIComponent(billingMonth)}&limit=20`,
    { headers: { 'x-org-id': orgId } },
  );
  const json = await readApiJson<{ data: PharmacyInvoiceRow[] }>(response);
  return json.data;
}

async function patchInvoiceStatus(orgId: string, invoiceId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/pharmacy-invoices/${invoiceId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify(body),
  });
  return readApiJson<PharmacyInvoiceRow>(response);
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
          tone === 'warning' && 'text-amber-700',
          tone === 'success' && 'text-emerald-700',
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

function CandidateTable({ candidates }: { candidates: VisitBillingCandidateRow[] }) {
  if (candidates.length === 0) {
    return (
      <EmptyState
        title="薬局間協力の請求候補はまだありません"
        description="対象月の確認済み協力訪問記録から、請求候補を生成してください。"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="min-w-full text-sm" aria-label="薬局間協力請求候補一覧">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              訪問日
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              協力薬局
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              状態
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              区分
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              金額
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              根拠
            </th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const blockerText = candidate.amount_summary.blocker_codes.join(', ');
            return (
              <tr key={candidate.id} className="border-t border-border/70">
                <td className="px-3 py-2 tabular-nums">
                  {formatDate(candidate.partner_visit_record.visit_at)}
                </td>
                <td className="px-3 py-2 font-medium">
                  {candidate.partner_visit_record.owner_partner_pharmacy.name}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant={candidate.billing_status === 'excluded' ? 'destructive' : 'outline'}
                  >
                    {statusLabel(candidate.billing_status)}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {billingModelLabel(candidate.amount_summary.billing_model)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatYen(candidate.amount_summary.amount)}
                </td>
                <td className="max-w-64 px-3 py-2 text-xs text-muted-foreground">
                  {candidate.exclusion_reason ?? (blockerText || '算定候補')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DraftResultPanel({ draft }: { draft: InvoiceDraftResult | null }) {
  if (!draft) return null;
  const purpose = encodeURIComponent(`${draft.billing_month} 薬局間月次出力`);
  const documentLabel =
    draft.document_kind === 'free_cooperation_report' ? '無償実績報告書' : '請求書';

  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
      data-testid="partner-invoice-draft-result"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">
            {documentLabel}ドラフト: {draft.id}
          </p>
          <p className="mt-1 text-emerald-900">
            {draft.item_count}件 / 合計 {formatYen(draft.total)}
            {draft.reused_existing_draft ? ' / 既存ドラフトを再利用' : ''}
          </p>
        </div>
        <a
          href={`/api/pharmacy-invoices/${draft.id}/pdf?purpose=${purpose}`}
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

function InvoiceHistoryTable({
  invoices,
  scheduledDates,
  onScheduledDateChange,
  onTransition,
  pendingInvoiceId,
}: {
  invoices: PharmacyInvoiceRow[];
  scheduledDates: Record<string, string>;
  onScheduledDateChange: (invoiceId: string, value: string) => void;
  onTransition: (invoice: PharmacyInvoiceRow, action: InvoiceTransitionAction) => void;
  pendingInvoiceId: string | null;
}) {
  if (invoices.length === 0) {
    return <EmptyState title="対象月の薬局間月次ドキュメントはまだありません" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="min-w-full text-sm" aria-label="薬局間月次ドキュメント一覧">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              ドキュメント
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              協力薬局
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              金額
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              件数
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              状態
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              出力
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const purpose = encodeURIComponent(`${invoice.billing_month} 薬局間月次出力`);
            const actions = invoiceActions(invoice.status);
            const isPending = pendingInvoiceId === invoice.id;
            return (
              <tr key={invoice.id} className="border-t border-border/70">
                <td className="px-3 py-2">
                  <div className="font-medium">{documentKindLabel(invoice.document_kind)}</div>
                  <div className="text-xs text-muted-foreground">
                    {invoice.invoice_no ?? invoice.id}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {invoice.partnership.base_site.name} / {invoice.partnership.partner_pharmacy.name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(invoice.total)}</td>
                <td className="px-3 py-2 tabular-nums">{invoice.item_count}件</td>
                <td className="px-3 py-2">
                  <Badge variant={invoice.status === 'voided' ? 'destructive' : 'outline'}>
                    {statusLabel(invoice.status)}
                  </Badge>
                  {invoice.payment_scheduled_for ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      支払予定 {formatDate(invoice.payment_scheduled_for)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={`/api/pharmacy-invoices/${invoice.id}/pdf?purpose=${purpose}`}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    PDF
                  </a>
                </td>
                <td className="min-w-72 px-3 py-2">
                  {actions.includes('schedule_payment') ? (
                    <Input
                      type="date"
                      className="mb-2 h-8 w-40"
                      value={scheduledDates[invoice.id] ?? todayDateInputValue()}
                      onChange={(event) => onScheduledDateChange(invoice.id, event.target.value)}
                      aria-label={`支払予定日 ${invoice.id}`}
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
                        aria-label={`${documentKindLabel(invoice.document_kind)} ${invoice.id} ${invoiceActionLabel(action)}`}
                      >
                        {invoiceActionIcon(action)}
                        {invoiceActionLabel(action)}
                      </Button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PartnerCooperationBillingContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [monthInput, setMonthInput] = useState(currentMonthInputValue);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [lastDraft, setLastDraft] = useState<InvoiceDraftResult | null>(null);
  const [scheduledDates, setScheduledDates] = useState<Record<string, string>>({});
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

  const candidatesQuery = useQuery({
    queryKey: ['partner-cooperation-candidates', orgId, billingMonth],
    queryFn: () => fetchCandidates(orgId, billingMonth),
    enabled,
    staleTime: 20_000,
  });

  const invoicesQuery = useQuery({
    queryKey: ['partner-cooperation-invoices', orgId, billingMonth],
    queryFn: () => fetchInvoices(orgId, billingMonth),
    enabled,
    staleTime: 20_000,
  });

  const contracts = contractsQuery.data ?? EMPTY_CONTRACTS;
  const selectedContract =
    contracts.find((contract) => contract.id === selectedContractId) ?? contracts[0] ?? null;
  const effectiveContractId = selectedContract?.id ?? '';

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
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ billing_month: billingMonth }),
      });
      return readApiJson<CandidateGenerationResult>(response);
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      setLastDraft(null);
      await invalidateMonth();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '請求候補の生成に失敗しました');
    },
  });

  const createInvoiceDraftMutation = useMutation({
    mutationFn: async (documentKind: 'invoice' | 'free_cooperation_report') => {
      if (!isMonthInputValid) throw new Error('対象月を選択してください');
      if (!effectiveContractId) throw new Error('対象契約を選択してください');
      const response = await fetch('/api/pharmacy-invoices', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          billing_month: billingMonth,
          contract_id: effectiveContractId,
          document_kind: documentKind,
        }),
      });
      return readApiJson<InvoiceDraftResult>(response);
    },
    onSuccess: async (result) => {
      setLastDraft(result);
      toast.success(result.message ?? '薬局間月次ドキュメントを作成しました');
      await invalidateMonth();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '薬局間月次ドキュメントの作成に失敗しました',
      );
    },
  });

  const transitionInvoiceMutation = useMutation({
    mutationFn: async ({
      invoice,
      action,
    }: {
      invoice: PharmacyInvoiceRow;
      action: InvoiceTransitionAction;
    }) => {
      const today = todayDateInputValue();
      const scheduledFor = scheduledDates[invoice.id] ?? today;
      const body: Record<string, unknown> = { action };
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
      return patchInvoiceStatus(orgId, invoice.id, body);
    },
    onSuccess: async (invoice) => {
      toast.success(`${documentKindLabel(invoice.document_kind)}を更新しました`);
      setLastDraft(null);
      await invalidateMonth();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '薬局間月次ドキュメントの更新に失敗しました',
      );
    },
  });

  const isBusy =
    generateCandidatesMutation.isPending ||
    createInvoiceDraftMutation.isPending ||
    transitionInvoiceMutation.isPending;
  const summary = summaryQuery.data ?? null;

  return (
    <div className="space-y-6" data-testid="partner-cooperation-billing">
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="partner-cooperation-controls-heading"
      >
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
            <ContractSelector
              contracts={contracts}
              value={effectiveContractId}
              onChange={(value) => {
                setSelectedContractId(value);
                setLastDraft(null);
              }}
            />
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
          ) : (
            <span>有効な薬局間契約を作成すると、請求書と無償実績報告書を生成できます。</span>
          )}
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
            detail={summaryQuery.error instanceof Error ? summaryQuery.error.message : undefined}
            action={{ label: '再試行', onClick: () => void summaryQuery.refetch() }}
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
            onClick={() => void candidatesQuery.refetch()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            更新
          </Button>
        </div>
        {candidatesQuery.isLoading ? (
          <Skeleton className="h-72 rounded-lg" />
        ) : candidatesQuery.isError ? (
          <ErrorState
            variant="server"
            title="薬局間協力の請求候補を表示できません"
            description="候補一覧の取得に失敗しました。再試行してください。"
            detail={
              candidatesQuery.error instanceof Error ? candidatesQuery.error.message : undefined
            }
            action={{ label: '再試行', onClick: () => void candidatesQuery.refetch() }}
          />
        ) : (
          <CandidateTable candidates={candidatesQuery.data ?? []} />
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void invoicesQuery.refetch()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            更新
          </Button>
        </div>
        {invoicesQuery.isLoading ? (
          <Skeleton className="h-52 rounded-lg" />
        ) : invoicesQuery.isError ? (
          <ErrorState
            variant="server"
            title="薬局間月次ドキュメントを表示できません"
            description="出力履歴の取得に失敗しました。再試行してください。"
            detail={invoicesQuery.error instanceof Error ? invoicesQuery.error.message : undefined}
            action={{ label: '再試行', onClick: () => void invoicesQuery.refetch() }}
          />
        ) : (
          <InvoiceHistoryTable
            invoices={invoicesQuery.data ?? []}
            scheduledDates={scheduledDates}
            onScheduledDateChange={(invoiceId, value) =>
              setScheduledDates((current) => ({ ...current, [invoiceId]: value }))
            }
            onTransition={(invoice, action) =>
              transitionInvoiceMutation.mutate({ invoice, action })
            }
            pendingInvoiceId={
              transitionInvoiceMutation.isPending
                ? (transitionInvoiceMutation.variables?.invoice.id ?? null)
                : null
            }
          />
        )}
      </section>
    </div>
  );
}
