'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Handshake,
  Plus,
  RefreshCw,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loading';
import { readApiJson } from '@/lib/api/client-json';
import {
  apiDataSchema,
  cursorPaginatedPageSchema,
  type CursorPaginatedPage,
} from '@/lib/api/response-schemas';
import { formatDateDisplay as formatDate } from '@/lib/datetime/date-display';
import { formatUtcDateKey } from '@/lib/date-key';
import { formatYen } from '@/lib/format/currency';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  partnerPharmacyRowSchema,
  pharmacyContractRowSchema,
  pharmacyPartnershipRowSchema,
  pharmacySiteRowSchema,
  type PartnerPharmacyRowContract,
  type PharmacyContractRowContract,
  type PharmacyPartnershipRowContract,
  type PharmacySiteRowContract,
} from '@/lib/pharmacy-cooperation/api-contracts';

type PharmacySiteRow = PharmacySiteRowContract;
type PartnerPharmacyRow = PartnerPharmacyRowContract;
type PharmacyPartnershipRow = PharmacyPartnershipRowContract;
type PharmacyContractRow = PharmacyContractRowContract;

type ContractTemplateRow = {
  id: string;
  name: string;
  version: number;
  format: string;
  is_default?: boolean;
};

type ContractDocumentRow = {
  id: string;
  contract_id: string;
  version_id: string;
  template_id: string;
  file_id: string | null;
  document_type: string;
  hash_value: string;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ContractDocumentPreview = {
  document_type: string;
  hash_value: string;
  rendered_text: string;
  snapshot: {
    template: { id: string; name: string; version: number; format: string };
    version: { id: string; version_no: number; status: string };
    fee_schedule: {
      billing_model: string;
      unit_price: number | null;
      tax_category: string;
      tax_rate_bp: number | null;
      rounding_rule: string | null;
    };
    articles: Array<{ article_no: number; title: string }>;
  };
};

type ContractRenewalAlert = {
  contract: PharmacyContractRow;
  daysRemaining: number;
  expiresOn: string;
};

type PartnerPharmacyForm = {
  name: string;
  pharmacy_code: string;
  tel: string;
};

type PartnershipForm = {
  base_site_id: string;
  partner_pharmacy_id: string;
  effective_from: string;
};

type ContractForm = {
  partnership_id: string;
  status: 'draft' | 'active';
  effective_from: string;
  billing_model: 'free' | 'fixed_per_visit';
  unit_price: string;
  base_approved_by: string;
  partner_approved_by: string;
};

type ApprovalForm = {
  base_approved_by: string;
  partner_approved_by: string;
};

type ContractDocumentForm = {
  contract_id: string;
  template_id: string;
  document_type: string;
  signed_file: File | null;
  signed_at: string;
  generate_pdf: boolean;
};

type PresignedUploadResponse = {
  data: {
    id: string;
    uploadUrl: string;
    headers?: Record<string, string>;
  };
};

type CompleteUploadResponse = {
  data: {
    id: string;
  };
};

const contractDocumentRowSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  version_id: z.string(),
  template_id: z.string(),
  file_id: z.string().nullable(),
  document_type: z.string(),
  hash_value: z.string(),
  signed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const contractDocumentPreviewSchema = z.object({
  document_type: z.string(),
  hash_value: z.string(),
  rendered_text: z.string(),
  snapshot: z.object({
    template: z.object({
      id: z.string(),
      name: z.string(),
      version: z.number(),
      format: z.string(),
    }),
    version: z.object({
      id: z.string(),
      version_no: z.number(),
      status: z.string(),
    }),
    fee_schedule: z.object({
      billing_model: z.string(),
      unit_price: z.number().nullable(),
      tax_category: z.string(),
      tax_rate_bp: z.number().nullable(),
      rounding_rule: z.string().nullable(),
    }),
    articles: z.array(
      z.object({
        article_no: z.number(),
        title: z.string(),
      }),
    ),
  }),
});

const contractTemplateRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  format: z.string(),
  is_default: z.boolean().optional(),
});

const presignedUploadResponseSchema = apiDataSchema(
  z.object({
    id: z.string(),
    uploadUrl: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
);

const completeUploadResponseSchema = apiDataSchema(
  z.object({
    id: z.string(),
  }),
);

const pharmacySitesResponseSchema = apiDataSchema(z.array(pharmacySiteRowSchema));
const partnerPharmacyPageSchema = cursorPaginatedPageSchema(partnerPharmacyRowSchema);
const pharmacyPartnershipPageSchema = cursorPaginatedPageSchema(pharmacyPartnershipRowSchema);
const pharmacyContractPageSchema = cursorPaginatedPageSchema(pharmacyContractRowSchema);
const contractTemplatesResponseSchema = apiDataSchema(z.array(contractTemplateRowSchema));
const contractDocumentsResponseSchema = apiDataSchema(z.array(contractDocumentRowSchema));
const contractDocumentPreviewResponseSchema = contractDocumentPreviewSchema.extend({
  mode: z.literal('preview'),
});
const savedContractDocumentResponseSchema = contractDocumentRowSchema.extend({
  preview: contractDocumentPreviewSchema,
});

function todayDateKey() {
  return formatUtcDateKey(new Date());
}

async function fetchPharmacySites(orgId: string) {
  const response = await fetch('/api/pharmacy-sites', { headers: { 'x-org-id': orgId } });
  return readApiJson<{ data: PharmacySiteRow[] }>(response, {
    fallbackMessage: '薬局拠点の取得に失敗しました',
    schema: pharmacySitesResponseSchema,
  });
}

async function fetchPartnerPharmacies(orgId: string) {
  const response = await fetch('/api/partner-pharmacies?limit=20', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPaginatedPage<PartnerPharmacyRow>>(response, {
    fallbackMessage: '協力薬局の取得に失敗しました',
    schema: partnerPharmacyPageSchema,
  });
}

async function fetchPartnerships(orgId: string) {
  const response = await fetch('/api/pharmacy-partnerships?limit=20', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPaginatedPage<PharmacyPartnershipRow>>(response, {
    fallbackMessage: '薬局間連携の取得に失敗しました',
    schema: pharmacyPartnershipPageSchema,
  });
}

async function fetchContracts(orgId: string) {
  const response = await fetch('/api/pharmacy-contracts?limit=20', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPaginatedPage<PharmacyContractRow>>(response, {
    fallbackMessage: '薬局間契約の取得に失敗しました',
    schema: pharmacyContractPageSchema,
  });
}

async function fetchContractTemplates(orgId: string) {
  const response = await fetch('/api/templates?template_type=contract_document', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<{ data: ContractTemplateRow[] }>(response, {
    fallbackMessage: '契約テンプレートの取得に失敗しました',
    schema: contractTemplatesResponseSchema,
  });
}

async function fetchContractDocuments(orgId: string, contractId: string) {
  const response = await fetch(`/api/pharmacy-contracts/${contractId}/documents`, {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<{ data: ContractDocumentRow[] }>(response, {
    fallbackMessage: '契約書類の取得に失敗しました',
    schema: contractDocumentsResponseSchema,
  });
}

async function uploadContractDocumentPdf(orgId: string, file: File) {
  if (file.type !== 'application/pdf') {
    throw new Error('署名済み契約書PDFを選択してください');
  }

  const presignResponse = await fetch('/api/files/presigned-upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify({
      purpose: 'contract-document',
      file_name: file.name,
      mime_type: 'application/pdf',
      size_bytes: file.size,
    }),
  });
  const presigned = await readApiJson<PresignedUploadResponse>(presignResponse, {
    fallbackMessage: '署名付きアップロードURLの取得に失敗しました',
    schema: presignedUploadResponseSchema,
  });

  const uploadResponse = await fetch(presigned.data.uploadUrl, {
    method: 'PUT',
    headers: presigned.data.headers ?? { 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error('署名済み契約書PDFのアップロードに失敗しました');
  }

  const completeResponse = await fetch('/api/files/complete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify({
      file_id: presigned.data.id,
      etag: uploadResponse.headers.get('etag') ?? undefined,
    }),
  });
  const completed = await readApiJson<CompleteUploadResponse>(completeResponse, {
    fallbackMessage: 'ファイル登録の完了に失敗しました',
    schema: completeUploadResponseSchema,
  });
  return completed.data.id;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: '有効',
    inactive: '停止',
    archived: 'アーカイブ',
    draft: '下書き',
    suspended: '停止中',
    expired: '期限切れ',
    terminated: '終了',
    ended: '終了',
    pending_base_approval: '基幹承認待ち',
    pending_partner_approval: '協力承認待ち',
  };
  return labels[status] ?? status;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (
    status === 'archived' ||
    status === 'expired' ||
    status === 'terminated' ||
    status === 'ended'
  ) {
    return 'destructive';
  }
  if (status === 'draft') return 'secondary';
  return 'outline';
}

const CONTRACT_RENEWAL_ALERT_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateKeyUtcTime(value: string | null | undefined) {
  const dateKey = formatDate(value);
  if (dateKey === '-' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const time = Date.parse(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(time) ? null : time;
}

function daysUntilDate(value: string | null | undefined, today: string) {
  const target = dateKeyUtcTime(value);
  const base = dateKeyUtcTime(today);
  if (target === null || base === null) return null;
  return Math.round((target - base) / DAY_MS);
}

function shouldShowContractRenewalAlert(status: string) {
  return [
    'active',
    'suspended',
    'expired',
    'pending_base_approval',
    'pending_partner_approval',
  ].includes(status);
}

function buildContractRenewalAlerts(contracts: PharmacyContractRow[], today: string) {
  return contracts
    .flatMap<ContractRenewalAlert>((contract) => {
      if (!shouldShowContractRenewalAlert(contract.status)) return [];
      const daysRemaining = daysUntilDate(contract.effective_to, today);
      if (daysRemaining === null || daysRemaining > CONTRACT_RENEWAL_ALERT_WINDOW_DAYS) return [];
      return [
        {
          contract,
          daysRemaining,
          expiresOn: formatDate(contract.effective_to),
        },
      ];
    })
    .sort((left, right) => left.daysRemaining - right.daysRemaining);
}

function billingModelLabel(model: string | null | undefined) {
  const labels: Record<string, string> = {
    free: '無償',
    fixed_per_visit: '有償/定額',
    per_visit_with_addon: '有償/加算',
    expense_reimbursement: '実費',
  };
  return model ? (labels[model] ?? model) : '未設定';
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-foreground">{children}</span>;
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-3">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function NativeSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <select
        className="!h-11 !min-h-[44px] rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {children}
      </select>
    </label>
  );
}

function QueryError({
  isLoading,
  isError,
  error,
  refetch,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}) {
  if (isLoading) return <Skeleton className="h-28 rounded-lg" />;
  if (!isError) return null;
  return (
    <ErrorState
      variant="server"
      title="薬局間協力設定を表示できません"
      description="マスタ一覧の取得に失敗しました。"
      detail={error instanceof Error ? error.message : undefined}
      onRetry={refetch}
    />
  );
}

function PartnershipTable({
  partnerships,
  approvalForms,
  setApprovalForms,
  isActivating,
  onActivate,
}: {
  partnerships: PharmacyPartnershipRow[];
  approvalForms: Record<string, ApprovalForm>;
  setApprovalForms: Dispatch<SetStateAction<Record<string, ApprovalForm>>>;
  isActivating: boolean;
  onActivate: (id: string) => void;
}) {
  const columns = useMemo<ColumnDef<PharmacyPartnershipRow>[]>(
    () => [
      {
        id: 'partnership',
        accessorFn: (partnership) => `${partnership.id} ${statusLabel(partnership.status)}`,
        header: '連携',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.id}</div>
            <Badge className="mt-1" variant={statusVariant(row.original.status)}>
              {statusLabel(row.original.status)}
            </Badge>
          </div>
        ),
        meta: { label: '連携' },
      },
      {
        id: 'partner_pharmacy',
        accessorFn: (partnership) =>
          `${partnership.base_site.name} ${partnership.partner_pharmacy.name}`,
        header: '協力薬局',
        cell: ({ row }) => (
          <span>
            {row.original.base_site.name} / {row.original.partner_pharmacy.name}
          </span>
        ),
        meta: { label: '協力薬局' },
      },
      {
        id: 'period',
        accessorFn: (partnership) =>
          `${formatDate(partnership.effective_from)} ${formatDate(partnership.effective_to)}`,
        header: '有効期間',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDate(row.original.effective_from)} - {formatDate(row.original.effective_to)}
          </span>
        ),
        meta: { label: '有効期間' },
      },
      {
        id: 'approval',
        header: '承認',
        cell: ({ row }) => {
          const partnership = row.original;
          const approvals = approvalForms[partnership.id] ?? {
            base_approved_by: '',
            partner_approved_by: '',
          };
          return partnership.status === 'active' ? (
            <span className="text-xs text-muted-foreground">承認済み</span>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={approvals.base_approved_by}
                onChange={(event) =>
                  setApprovalForms((current) => ({
                    ...current,
                    [partnership.id]: {
                      ...approvals,
                      base_approved_by: event.target.value,
                    },
                  }))
                }
                placeholder="基幹承認者"
                aria-label={`${partnership.id} の基幹承認者`}
              />
              <Input
                value={approvals.partner_approved_by}
                onChange={(event) =>
                  setApprovalForms((current) => ({
                    ...current,
                    [partnership.id]: {
                      ...approvals,
                      partner_approved_by: event.target.value,
                    },
                  }))
                }
                placeholder="協力承認者"
                aria-label={`${partnership.id} の協力承認者`}
              />
            </div>
          );
        },
        enableSorting: false,
        meta: { label: '承認' },
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const partnership = row.original;
          return (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isActivating || partnership.status === 'active'}
                onClick={() => onActivate(partnership.id)}
                aria-label={`${partnership.id} ${partnership.partner_pharmacy.name} の薬局間連携を有効化`}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                有効化
              </Button>
            </div>
          );
        },
        enableSorting: false,
        meta: { label: '操作', mobileLabel: '操作' },
      },
    ],
    [approvalForms, isActivating, onActivate, setApprovalForms],
  );

  return (
    <DataTable
      columns={columns}
      data={partnerships}
      caption="薬局間連携一覧"
      getRowId={(partnership) => partnership.id}
      getRowA11yLabel={(partnership) =>
        `${partnership.id} ${partnership.partner_pharmacy.name} ${statusLabel(partnership.status)}`
      }
      toolbar={{
        enableGlobalFilter: true,
        globalFilterPlaceholder: '薬局間連携内検索',
        enableColumnVisibility: true,
        filterFields: [
          { columnId: 'partner_pharmacy', label: '協力薬局', placeholder: '協力薬局で絞り込み' },
          { columnId: 'partnership', label: '連携状態', placeholder: '状態で絞り込み' },
        ],
      }}
    />
  );
}

function ContractDocumentTable({ documents }: { documents: ContractDocumentRow[] }) {
  const columns = useMemo<ColumnDef<ContractDocumentRow>[]>(
    () => [
      {
        id: 'document',
        accessorFn: (document) => `${document.id} ${document.hash_value}`,
        header: '文書',
        cell: ({ row }) => (
          <div>
            <div className="flex items-center gap-2 font-medium">
              <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
              {row.original.id}
            </div>
            <div className="mt-1 max-w-72 truncate font-mono text-xs text-muted-foreground">
              {row.original.hash_value}
            </div>
          </div>
        ),
        meta: { label: '文書' },
      },
      {
        id: 'file',
        accessorFn: (document) => (document.file_id ? '添付済み' : '未添付'),
        header: '署名PDF',
        cell: ({ row }) => (row.original.file_id ? '添付済み' : '未添付'),
        meta: { label: '署名PDF' },
      },
      {
        id: 'signed_at',
        accessorFn: (document) => formatDate(document.signed_at),
        header: '署名日',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDate(row.original.signed_at)}</span>
        ),
        meta: { label: '署名日' },
      },
      {
        id: 'created_at',
        accessorFn: (document) => formatDate(document.created_at),
        header: '保存日時',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDate(row.original.created_at)}</span>
        ),
        meta: { label: '保存日時' },
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={documents}
      caption="契約書一覧"
      getRowId={(document) => document.id}
      getRowA11yLabel={(document) => `${document.id} ${document.file_id ? '添付済み' : '未添付'}`}
      toolbar={{
        enableGlobalFilter: true,
        globalFilterPlaceholder: '契約書内検索',
        enableColumnVisibility: true,
      }}
    />
  );
}

function ContractTable({ contracts }: { contracts: PharmacyContractRow[] }) {
  const columns = useMemo<ColumnDef<PharmacyContractRow>[]>(
    () => [
      {
        id: 'contract',
        accessorFn: (contract) => `${contract.id} ${statusLabel(contract.status)}`,
        header: '契約',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.id}</div>
            <Badge className="mt-1" variant={statusVariant(row.original.status)}>
              {statusLabel(row.original.status)}
            </Badge>
          </div>
        ),
        meta: { label: '契約' },
      },
      {
        id: 'partnership',
        accessorFn: (contract) =>
          `${contract.partnership.base_site.name} ${contract.partnership.partner_pharmacy.name}`,
        header: '連携',
        cell: ({ row }) => (
          <span>
            {row.original.partnership.base_site.name} /{' '}
            {row.original.partnership.partner_pharmacy.name}
          </span>
        ),
        meta: { label: '連携' },
      },
      {
        id: 'period',
        accessorFn: (contract) =>
          `${formatDate(contract.effective_from)} ${formatDate(contract.effective_to)}`,
        header: '期間',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDate(row.original.effective_from)} - {formatDate(row.original.effective_to)}
          </span>
        ),
        meta: { label: '期間' },
      },
      {
        id: 'fee_rule',
        accessorFn: (contract) =>
          `${billingModelLabel(contract.latest_version?.active_fee_rule?.billing_model)} ${formatYen(
            contract.latest_version?.active_fee_rule?.unit_price,
          )}`,
        header: '費用条件',
        cell: ({ row }) => (
          <span>
            {billingModelLabel(row.original.latest_version?.active_fee_rule?.billing_model)}
            <span className="ml-2 tabular-nums text-muted-foreground">
              {formatYen(row.original.latest_version?.active_fee_rule?.unit_price)}
            </span>
          </span>
        ),
        meta: { label: '費用条件' },
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={contracts}
      caption="薬局間契約一覧"
      getRowId={(contract) => contract.id}
      getRowA11yLabel={(contract) =>
        `${contract.id} ${contract.partnership.partner_pharmacy.name} ${statusLabel(
          contract.status,
        )}`
      }
      toolbar={{
        enableGlobalFilter: true,
        globalFilterPlaceholder: '薬局間契約内検索',
        enableColumnVisibility: true,
        filterFields: [
          { columnId: 'partnership', label: '連携薬局', placeholder: '連携薬局で絞り込み' },
          { columnId: 'contract', label: '契約状態', placeholder: '状態で絞り込み' },
        ],
      }}
    />
  );
}

function renewalAlertLabel(daysRemaining: number) {
  if (daysRemaining < 0) return `期限切れ ${Math.abs(daysRemaining)}日超過`;
  if (daysRemaining === 0) return '本日期限';
  return `あと${daysRemaining}日`;
}

function ContractRenewalAlerts({ alerts }: { alerts: ContractRenewalAlert[] }) {
  if (alerts.length === 0) return null;

  const hasExpiredContract = alerts.some((alert) => alert.daysRemaining < 0);

  return (
    <SectionShell
      title="契約更新アラート"
      description={`終了日が${CONTRACT_RENEWAL_ALERT_WINDOW_DAYS}日以内または期限切れの薬局間契約を確認します。`}
    >
      <div className="space-y-3">
        <Alert variant={hasExpiredContract ? 'destructive' : 'default'}>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>契約期限の確認が必要です</AlertTitle>
          <AlertDescription>
            {alerts.length}
            件の契約が更新確認の対象です。終了日、費用条件、双方の承認記録を確認してください。
          </AlertDescription>
        </Alert>
        <div role="list" aria-label="契約更新アラート一覧" className="grid gap-3 lg:grid-cols-2">
          {alerts.map(({ contract, daysRemaining, expiresOn }) => (
            <div
              key={contract.id}
              role="listitem"
              className="rounded-md border border-border/70 bg-background p-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{contract.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {contract.partnership.base_site.name} /{' '}
                    {contract.partnership.partner_pharmacy.name}
                  </p>
                </div>
                <Badge variant={daysRemaining < 0 ? 'destructive' : 'outline'}>
                  {renewalAlertLabel(daysRemaining)}
                </Badge>
              </div>
              <dl className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3">
                  <dt>終了日</dt>
                  <dd className="font-medium tabular-nums text-foreground">{expiresOn}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>契約状態</dt>
                  <dd className="font-medium text-foreground">{statusLabel(contract.status)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                  <dt>費用条件</dt>
                  <dd className="font-medium text-foreground">
                    {billingModelLabel(contract.latest_version?.active_fee_rule?.billing_model)}
                    <span className="ml-2 tabular-nums">
                      {formatYen(contract.latest_version?.active_fee_rule?.unit_price)}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

export function PharmacyCooperationSetupContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const today = useMemo(() => todayDateKey(), []);
  const [partnerForm, setPartnerForm] = useState<PartnerPharmacyForm>({
    name: '',
    pharmacy_code: '',
    tel: '',
  });
  const [partnershipForm, setPartnershipForm] = useState<PartnershipForm>({
    base_site_id: '',
    partner_pharmacy_id: '',
    effective_from: today,
  });
  const [approvalForms, setApprovalForms] = useState<Record<string, ApprovalForm>>({});
  const [contractForm, setContractForm] = useState<ContractForm>({
    partnership_id: '',
    status: 'active',
    effective_from: today,
    billing_model: 'fixed_per_visit',
    unit_price: '5500',
    base_approved_by: '',
    partner_approved_by: '',
  });
  const [documentForm, setDocumentForm] = useState<ContractDocumentForm>({
    contract_id: '',
    template_id: '',
    document_type: 'basic_contract',
    signed_file: null,
    signed_at: '',
    generate_pdf: true,
  });
  const [contractDocumentPreview, setContractDocumentPreview] =
    useState<ContractDocumentPreview | null>(null);
  const enabled = Boolean(orgId);

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-cooperation-setup-sites', orgId],
    queryFn: () => fetchPharmacySites(orgId),
    enabled,
    staleTime: 60_000,
  });

  const partnersQuery = useQuery({
    queryKey: ['pharmacy-cooperation-setup-partners', orgId],
    queryFn: () => fetchPartnerPharmacies(orgId),
    enabled,
    staleTime: 30_000,
  });

  const partnershipsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-setup-partnerships', orgId],
    queryFn: () => fetchPartnerships(orgId),
    enabled,
    staleTime: 30_000,
  });

  const contractsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-setup-contracts', orgId],
    queryFn: () => fetchContracts(orgId),
    enabled,
    staleTime: 30_000,
  });

  const contractTemplatesQuery = useQuery({
    queryKey: ['pharmacy-cooperation-setup-contract-templates', orgId],
    queryFn: () => fetchContractTemplates(orgId),
    enabled,
    staleTime: 60_000,
  });

  const sites = sitesQuery.data?.data ?? [];
  const partners = partnersQuery.data?.data ?? [];
  const partnerships = partnershipsQuery.data?.data ?? [];
  const contracts = contractsQuery.data?.data ?? [];
  const contractTemplates = contractTemplatesQuery.data?.data ?? [];
  const activePartnerships = partnerships.filter((partnership) => partnership.status === 'active');
  const effectiveBaseSiteId = partnershipForm.base_site_id || sites[0]?.id || '';
  const effectivePartnerPharmacyId = partnershipForm.partner_pharmacy_id || partners[0]?.id || '';
  const effectiveContractPartnershipId =
    contractForm.partnership_id || activePartnerships[0]?.id || '';
  const effectiveDocumentContractId = documentForm.contract_id || contracts[0]?.id || '';
  const effectiveDocumentTemplateId = documentForm.template_id || contractTemplates[0]?.id || '';
  const contractDocumentsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-setup-contract-documents', orgId, effectiveDocumentContractId],
    queryFn: () => fetchContractDocuments(orgId, effectiveDocumentContractId),
    enabled: enabled && Boolean(effectiveDocumentContractId),
    staleTime: 30_000,
  });
  const contractDocuments = contractDocumentsQuery.data?.data ?? [];
  const contractRenewalAlerts = buildContractRenewalAlerts(contracts, today);
  const isLoading =
    sitesQuery.isLoading ||
    partnersQuery.isLoading ||
    partnershipsQuery.isLoading ||
    contractsQuery.isLoading ||
    contractTemplatesQuery.isLoading ||
    (contractDocumentsQuery.isLoading && Boolean(effectiveDocumentContractId));
  const isError =
    sitesQuery.isError ||
    partnersQuery.isError ||
    partnershipsQuery.isError ||
    contractsQuery.isError ||
    contractTemplatesQuery.isError ||
    contractDocumentsQuery.isError;

  const invalidateSetup = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-setup-partners', orgId] }),
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-cooperation-setup-partnerships', orgId],
      }),
      queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-setup-contracts', orgId] }),
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-cooperation-setup-contract-documents', orgId],
      }),
    ]);
  };

  const createPartnerMutation = useMutation({
    mutationFn: async () => {
      if (!partnerForm.name.trim()) throw new Error('協力薬局名を入力してください');
      const response = await fetch('/api/partner-pharmacies', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          name: partnerForm.name,
          ...(partnerForm.pharmacy_code ? { pharmacy_code: partnerForm.pharmacy_code } : {}),
          ...(partnerForm.tel ? { tel: partnerForm.tel } : {}),
        }),
      });
      return readApiJson<PartnerPharmacyRow>(response, {
        fallbackMessage: '協力薬局の登録に失敗しました',
        schema: partnerPharmacyRowSchema,
      });
    },
    onSuccess: async () => {
      toast.success('協力薬局を登録しました');
      setPartnerForm({ name: '', pharmacy_code: '', tel: '' });
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '協力薬局の登録に失敗しました'));
    },
  });

  const createPartnershipMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveBaseSiteId) throw new Error('基準薬局を選択してください');
      if (!effectivePartnerPharmacyId) throw new Error('協力薬局を選択してください');
      const response = await fetch('/api/pharmacy-partnerships', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          base_site_id: effectiveBaseSiteId,
          partner_pharmacy_id: effectivePartnerPharmacyId,
          effective_from: partnershipForm.effective_from,
        }),
      });
      return readApiJson<PharmacyPartnershipRow>(response, {
        fallbackMessage: '薬局間連携の作成に失敗しました',
        schema: pharmacyPartnershipRowSchema,
      });
    },
    onSuccess: async () => {
      toast.success('薬局間連携を作成しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '薬局間連携の作成に失敗しました'));
    },
  });

  const activatePartnershipMutation = useMutation({
    mutationFn: async (id: string) => {
      const approvals = approvalForms[id] ?? { base_approved_by: '', partner_approved_by: '' };
      if (!approvals.base_approved_by.trim() || !approvals.partner_approved_by.trim()) {
        throw new Error('基幹薬局側と協力薬局側の承認記録を入力してください');
      }
      const response = await fetch(`/api/pharmacy-partnerships/${id}/activate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(approvals),
      });
      return readApiJson<PharmacyPartnershipRow>(response, {
        fallbackMessage: '薬局間連携の有効化に失敗しました',
        schema: pharmacyPartnershipRowSchema,
      });
    },
    onSuccess: async () => {
      toast.success('薬局間連携を有効化しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '薬局間連携の有効化に失敗しました'));
    },
  });

  const createContractMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveContractPartnershipId) throw new Error('有効な薬局間連携を選択してください');
      if (contractForm.status === 'active') {
        if (!contractForm.base_approved_by.trim() || !contractForm.partner_approved_by.trim()) {
          throw new Error('有効契約には双方の承認記録が必要です');
        }
      }
      const unitPrice =
        contractForm.billing_model === 'fixed_per_visit'
          ? Number.parseInt(contractForm.unit_price, 10)
          : null;
      const response = await fetch('/api/pharmacy-contracts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          partnership_id: effectiveContractPartnershipId,
          status: contractForm.status,
          effective_from: contractForm.effective_from,
          closing_day: 31,
          ...(contractForm.base_approved_by
            ? { base_approved_by: contractForm.base_approved_by }
            : {}),
          ...(contractForm.partner_approved_by
            ? { partner_approved_by: contractForm.partner_approved_by }
            : {}),
          fee_rule: {
            billing_model: contractForm.billing_model,
            unit_price: unitPrice,
            tax_category: 'tax_pending',
          },
        }),
      });
      return readApiJson<PharmacyContractRow>(response, {
        fallbackMessage: '薬局間契約の登録に失敗しました',
        schema: pharmacyContractRowSchema,
      });
    },
    onSuccess: async () => {
      toast.success('薬局間契約を登録しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '薬局間契約の登録に失敗しました'));
    },
  });

  const previewContractDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveDocumentContractId) throw new Error('契約を選択してください');
      if (!effectiveDocumentTemplateId) throw new Error('契約書テンプレートを選択してください');
      const response = await fetch(
        `/api/pharmacy-contracts/${effectiveDocumentContractId}/documents`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            mode: 'preview',
            template_id: effectiveDocumentTemplateId,
            document_type: documentForm.document_type,
          }),
        },
      );
      return readApiJson<ContractDocumentPreview & { mode: 'preview' }>(response, {
        fallbackMessage: '契約書プレビューに失敗しました',
        schema: contractDocumentPreviewResponseSchema,
      });
    },
    onSuccess: (preview) => {
      setContractDocumentPreview(preview);
      toast.success('契約書プレビューを作成しました');
    },
    onError: (error) => {
      toast.error(messageFromError(error, '契約書プレビューに失敗しました'));
    },
  });

  const saveContractDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveDocumentContractId) throw new Error('契約を選択してください');
      if (!effectiveDocumentTemplateId) throw new Error('契約書テンプレートを選択してください');
      const signedFile = documentForm.signed_file;
      const signedAt = documentForm.signed_at.trim();
      const shouldGeneratePdf = documentForm.generate_pdf && !signedFile;
      const signedFileId = signedFile ? await uploadContractDocumentPdf(orgId, signedFile) : '';
      const response = await fetch(
        `/api/pharmacy-contracts/${effectiveDocumentContractId}/documents`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            mode: 'save',
            template_id: effectiveDocumentTemplateId,
            document_type: documentForm.document_type,
            ...(signedFileId ? { signed_file_id: signedFileId } : {}),
            ...(signedAt ? { signed_at: signedAt } : {}),
            ...(shouldGeneratePdf ? { generate_pdf: true } : {}),
          }),
        },
      );
      return readApiJson<ContractDocumentRow & { preview: ContractDocumentPreview }>(response, {
        fallbackMessage: '契約書の保存に失敗しました',
        schema: savedContractDocumentResponseSchema,
      });
    },
    onSuccess: async (document) => {
      setContractDocumentPreview(document.preview);
      toast.success('契約書を保存しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '契約書の保存に失敗しました'));
    },
  });

  const refetchAll = () => {
    void sitesQuery.refetch();
    void partnersQuery.refetch();
    void partnershipsQuery.refetch();
    void contractsQuery.refetch();
    void contractTemplatesQuery.refetch();
    void contractDocumentsQuery.refetch();
  };

  if (isLoading || isError) {
    return (
      <div className="space-y-4">
        <QueryError
          isLoading={isLoading}
          isError={isError}
          error={
            sitesQuery.error ??
            partnersQuery.error ??
            partnershipsQuery.error ??
            contractsQuery.error ??
            contractTemplatesQuery.error ??
            contractDocumentsQuery.error
          }
          refetch={refetchAll}
        />
      </div>
    );
  }

  return (
    <div
      className="space-y-6 [&_button]:!h-11 [&_button]:!min-h-[44px] [&_input]:!h-11 [&_input]:!min-h-[44px] [&_select]:!h-11 [&_select]:!min-h-[44px]"
      data-testid="pharmacy-cooperation-setup"
    >
      <ContractRenewalAlerts alerts={contractRenewalAlerts} />

      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={refetchAll}>
          <RefreshCw className="size-4" aria-hidden="true" />
          更新
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <p className="text-sm font-semibold text-foreground">協力薬局</p>
          <p className="mt-1 text-[26px] font-bold leading-9 tabular-nums">{partners.length}</p>
          <p className="text-xs text-muted-foreground">
            有効 {partners.filter((p) => p.status === 'active').length} 件
          </p>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <p className="text-sm font-semibold text-foreground">薬局間連携</p>
          <p className="mt-1 text-[26px] font-bold leading-9 tabular-nums">{partnerships.length}</p>
          <p className="text-xs text-muted-foreground">有効 {activePartnerships.length} 件</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <p className="text-sm font-semibold text-foreground">契約</p>
          <p className="mt-1 text-[26px] font-bold leading-9 tabular-nums">{contracts.length}</p>
          <p className="text-xs text-muted-foreground">
            有効 {contracts.filter((c) => c.status === 'active').length} 件
          </p>
        </div>
      </div>

      <SectionShell title="協力薬局登録" description="連携先薬局の基本情報を登録します。">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <label className="grid gap-1.5">
            <FieldLabel>協力薬局名</FieldLabel>
            <Input
              value={partnerForm.name}
              onChange={(event) =>
                setPartnerForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="協力薬局"
              aria-label="協力薬局名"
            />
          </label>
          <label className="grid gap-1.5">
            <FieldLabel>薬局コード</FieldLabel>
            <Input
              value={partnerForm.pharmacy_code}
              onChange={(event) =>
                setPartnerForm((current) => ({ ...current, pharmacy_code: event.target.value }))
              }
              aria-label="薬局コード"
            />
          </label>
          <label className="grid gap-1.5">
            <FieldLabel>電話番号</FieldLabel>
            <Input
              value={partnerForm.tel}
              onChange={(event) =>
                setPartnerForm((current) => ({ ...current, tel: event.target.value }))
              }
              aria-label="電話番号"
            />
          </label>
          <Button
            type="button"
            onClick={() => createPartnerMutation.mutate()}
            disabled={createPartnerMutation.isPending || !partnerForm.name.trim()}
          >
            <Plus className="size-4" aria-hidden="true" />
            登録
          </Button>
        </div>
      </SectionShell>

      <SectionShell title="薬局間連携作成" description="基準薬局と協力薬局を紐づけます。">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_12rem_auto] lg:items-end">
          <NativeSelect
            label="基準薬局"
            value={effectiveBaseSiteId}
            onChange={(value) =>
              setPartnershipForm((current) => ({ ...current, base_site_id: value }))
            }
          >
            <option value="">基準薬局を選択</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            label="協力薬局"
            value={effectivePartnerPharmacyId}
            onChange={(value) =>
              setPartnershipForm((current) => ({ ...current, partner_pharmacy_id: value }))
            }
          >
            <option value="">協力薬局を選択</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </NativeSelect>
          <label className="grid gap-1.5">
            <FieldLabel>開始日</FieldLabel>
            <Input
              type="date"
              value={partnershipForm.effective_from}
              onChange={(event) =>
                setPartnershipForm((current) => ({
                  ...current,
                  effective_from: event.target.value,
                }))
              }
              aria-label="連携開始日"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() => createPartnershipMutation.mutate()}
            disabled={
              createPartnershipMutation.isPending ||
              !effectiveBaseSiteId ||
              !effectivePartnerPharmacyId
            }
          >
            <Handshake className="size-4" aria-hidden="true" />
            連携作成
          </Button>
        </div>
      </SectionShell>

      <SectionShell title="薬局間連携一覧" description="連携状態と承認記録を確認します。">
        {partnerships.length === 0 ? (
          <EmptyState title="薬局間連携はまだありません" />
        ) : (
          <PartnershipTable
            partnerships={partnerships}
            approvalForms={approvalForms}
            setApprovalForms={setApprovalForms}
            isActivating={activatePartnershipMutation.isPending}
            onActivate={(id) => activatePartnershipMutation.mutate(id)}
          />
        )}
      </SectionShell>

      <SectionShell title="契約登録" description="協力訪問の費用条件を登録します。">
        <div className="grid gap-3 xl:grid-cols-[1.2fr_10rem_10rem_10rem_1fr_1fr_auto] xl:items-end">
          <NativeSelect
            label="有効な連携"
            value={effectiveContractPartnershipId}
            onChange={(value) =>
              setContractForm((current) => ({ ...current, partnership_id: value }))
            }
          >
            <option value="">有効な連携を選択</option>
            {activePartnerships.map((partnership) => (
              <option key={partnership.id} value={partnership.id}>
                {partnership.base_site.name} / {partnership.partner_pharmacy.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            label="契約状態"
            value={contractForm.status}
            onChange={(value) =>
              setContractForm((current) => ({
                ...current,
                status: value as ContractForm['status'],
              }))
            }
          >
            <option value="active">有効</option>
            <option value="draft">下書き</option>
          </NativeSelect>
          <label className="grid gap-1.5">
            <FieldLabel>開始日</FieldLabel>
            <Input
              type="date"
              value={contractForm.effective_from}
              onChange={(event) =>
                setContractForm((current) => ({ ...current, effective_from: event.target.value }))
              }
              aria-label="契約開始日"
            />
          </label>
          <NativeSelect
            label="費用区分"
            value={contractForm.billing_model}
            onChange={(value) =>
              setContractForm((current) => ({
                ...current,
                billing_model: value as ContractForm['billing_model'],
              }))
            }
          >
            <option value="fixed_per_visit">有償/定額</option>
            <option value="free">無償</option>
          </NativeSelect>
          <label className="grid gap-1.5">
            <FieldLabel>1訪問単価</FieldLabel>
            <Input
              inputMode="numeric"
              value={contractForm.unit_price}
              onChange={(event) =>
                setContractForm((current) => ({ ...current, unit_price: event.target.value }))
              }
              disabled={contractForm.billing_model === 'free'}
              aria-label="1訪問単価"
            />
          </label>
          <label className="grid gap-1.5">
            <FieldLabel>基幹承認者</FieldLabel>
            <Input
              value={contractForm.base_approved_by}
              onChange={(event) =>
                setContractForm((current) => ({ ...current, base_approved_by: event.target.value }))
              }
              aria-label="契約の基幹承認者"
            />
          </label>
          <label className="grid gap-1.5">
            <FieldLabel>協力承認者</FieldLabel>
            <Input
              value={contractForm.partner_approved_by}
              onChange={(event) =>
                setContractForm((current) => ({
                  ...current,
                  partner_approved_by: event.target.value,
                }))
              }
              aria-label="契約の協力承認者"
            />
          </label>
          <Button
            type="button"
            onClick={() => createContractMutation.mutate()}
            disabled={createContractMutation.isPending || !effectiveContractPartnershipId}
          >
            <Plus className="size-4" aria-hidden="true" />
            契約登録
          </Button>
        </div>
      </SectionShell>

      <SectionShell
        title="契約書作成"
        description="契約テンプレートから契約書と費用条件表を生成します。"
      >
        <div className="grid gap-3 xl:grid-cols-[1.2fr_1.2fr_10rem_1fr_10rem_11rem_auto_auto] xl:items-end">
          <NativeSelect
            label="契約"
            value={effectiveDocumentContractId}
            onChange={(value) => {
              setDocumentForm((current) => ({ ...current, contract_id: value }));
              setContractDocumentPreview(null);
            }}
          >
            <option value="">契約を選択</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.id} / {contract.partnership.partner_pharmacy.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            label="テンプレート"
            value={effectiveDocumentTemplateId}
            onChange={(value) => {
              setDocumentForm((current) => ({ ...current, template_id: value }));
              setContractDocumentPreview(null);
            }}
          >
            <option value="">テンプレートを選択</option>
            {contractTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} v{template.version}
                {template.is_default ? ' / 既定' : ''}
              </option>
            ))}
          </NativeSelect>
          <label className="grid gap-1.5">
            <FieldLabel>文書種別</FieldLabel>
            <Input
              value={documentForm.document_type}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  document_type: event.target.value,
                }))
              }
              aria-label="契約文書種別"
            />
          </label>
          <label className="grid gap-1.5">
            <FieldLabel>署名済みPDF</FieldLabel>
            <Input
              type="file"
              accept="application/pdf"
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  signed_file: event.target.files?.[0] ?? null,
                  generate_pdf: event.target.files?.[0] ? false : current.generate_pdf,
                }))
              }
              aria-label="署名済み契約書PDF"
            />
          </label>
          <label className="grid gap-1.5">
            <FieldLabel>署名日</FieldLabel>
            <Input
              type="date"
              value={documentForm.signed_at}
              onChange={(event) =>
                setDocumentForm((current) => ({ ...current, signed_at: event.target.value }))
              }
              aria-label="契約書署名日"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-border/70 px-3 py-2">
            <Checkbox
              className="size-11 rounded-lg"
              checked={documentForm.generate_pdf && !documentForm.signed_file}
              onCheckedChange={(checked) =>
                setDocumentForm((current) => ({
                  ...current,
                  generate_pdf: Boolean(checked),
                }))
              }
              disabled={Boolean(documentForm.signed_file)}
              aria-label="PDFを生成して保存"
            />
            <span className="text-sm font-medium text-foreground">PDF生成</span>
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() => previewContractDocumentMutation.mutate()}
            disabled={
              previewContractDocumentMutation.isPending ||
              !effectiveDocumentContractId ||
              !effectiveDocumentTemplateId
            }
          >
            <Eye className="size-4" aria-hidden="true" />
            プレビュー
          </Button>
          <Button
            type="button"
            onClick={() => saveContractDocumentMutation.mutate()}
            disabled={
              saveContractDocumentMutation.isPending ||
              !effectiveDocumentContractId ||
              !effectiveDocumentTemplateId
            }
          >
            <Save className="size-4" aria-hidden="true" />
            契約書保存
          </Button>
        </div>

        {contractDocumentPreview ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-[18rem_1fr]">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
              <p className="font-semibold text-foreground">プレビュー</p>
              <dl className="mt-2 grid gap-1 text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <dt>テンプレート</dt>
                  <dd className="text-right text-foreground">
                    {contractDocumentPreview.snapshot.template.name} v
                    {contractDocumentPreview.snapshot.template.version}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>契約版</dt>
                  <dd className="text-right text-foreground">
                    v{contractDocumentPreview.snapshot.version.version_no}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>費用条件</dt>
                  <dd className="text-right text-foreground">
                    {billingModelLabel(contractDocumentPreview.snapshot.fee_schedule.billing_model)}{' '}
                    {formatYen(contractDocumentPreview.snapshot.fee_schedule.unit_price)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>条文</dt>
                  <dd className="text-right text-foreground">
                    {contractDocumentPreview.snapshot.articles.length} 件
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>ハッシュ</dt>
                  <dd className="max-w-36 truncate text-right font-mono text-foreground">
                    {contractDocumentPreview.hash_value}
                  </dd>
                </div>
              </dl>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md border border-border/70 bg-background p-3 text-xs leading-5 text-foreground">
              {contractDocumentPreview.rendered_text}
            </pre>
          </div>
        ) : null}

        <div className="mt-4">
          {effectiveDocumentContractId && contractDocuments.length > 0 ? (
            <ContractDocumentTable documents={contractDocuments} />
          ) : (
            <EmptyState title="保存済み契約書はまだありません" />
          )}
        </div>
      </SectionShell>

      <SectionShell title="契約一覧" description="現在の契約と有効な費用条件を確認します。">
        {contracts.length === 0 ? (
          <EmptyState title="薬局間契約はまだありません" />
        ) : (
          <ContractTable contracts={contracts} />
        )}
      </SectionShell>
    </div>
  );
}
