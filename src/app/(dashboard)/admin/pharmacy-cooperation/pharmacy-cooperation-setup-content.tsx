'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Handshake, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';

type CursorPage<T> = {
  data: T[];
};

type PharmacySiteRow = {
  id: string;
  name: string;
  address?: string | null;
};

type PartnerPharmacyRow = {
  id: string;
  pharmacy_code: string | null;
  name: string;
  tel: string | null;
  status: string;
  updated_at?: string;
};

type PharmacyPartnershipRow = {
  id: string;
  status: string;
  base_site_id: string;
  partner_pharmacy_id: string;
  effective_from: string | null;
  effective_to: string | null;
  base_site: { id: string; name: string };
  partner_pharmacy: { id: string; name: string; status: string };
};

type PharmacyContractRow = {
  id: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  partnership: {
    id: string;
    status: string;
    base_site: { id: string; name: string };
    partner_pharmacy: { id: string; name: string; status: string };
  };
  latest_version: {
    version_no: number;
    status: string;
    active_fee_rule: {
      billing_model: string;
      unit_price: number | null;
      tax_category: string;
    } | null;
  } | null;
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

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
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

async function fetchPharmacySites(orgId: string) {
  const response = await fetch('/api/pharmacy-sites', { headers: { 'x-org-id': orgId } });
  return readApiJson<{ data: PharmacySiteRow[] }>(response);
}

async function fetchPartnerPharmacies(orgId: string) {
  const response = await fetch('/api/partner-pharmacies?limit=20', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPage<PartnerPharmacyRow>>(response);
}

async function fetchPartnerships(orgId: string) {
  const response = await fetch('/api/pharmacy-partnerships?limit=20', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPage<PharmacyPartnershipRow>>(response);
}

async function fetchContracts(orgId: string) {
  const response = await fetch('/api/pharmacy-contracts?limit=20', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPage<PharmacyContractRow>>(response);
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

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return value.slice(0, 10);
}

function formatYen(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value).toLocaleString('ja-JP')}円`;
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
        className="min-h-[44px] rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8 sm:min-h-0"
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
      action={{ label: '再試行', onClick: refetch }}
    />
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

  const sites = sitesQuery.data?.data ?? [];
  const partners = partnersQuery.data?.data ?? [];
  const partnerships = partnershipsQuery.data?.data ?? [];
  const contracts = contractsQuery.data?.data ?? [];
  const activePartnerships = partnerships.filter((partnership) => partnership.status === 'active');
  const effectiveBaseSiteId = partnershipForm.base_site_id || sites[0]?.id || '';
  const effectivePartnerPharmacyId = partnershipForm.partner_pharmacy_id || partners[0]?.id || '';
  const effectiveContractPartnershipId =
    contractForm.partnership_id || activePartnerships[0]?.id || '';
  const isLoading =
    sitesQuery.isLoading ||
    partnersQuery.isLoading ||
    partnershipsQuery.isLoading ||
    contractsQuery.isLoading;
  const isError =
    sitesQuery.isError ||
    partnersQuery.isError ||
    partnershipsQuery.isError ||
    contractsQuery.isError;

  const invalidateSetup = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-setup-partners', orgId] }),
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-cooperation-setup-partnerships', orgId],
      }),
      queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-setup-contracts', orgId] }),
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
      return readApiJson<PartnerPharmacyRow>(response);
    },
    onSuccess: async () => {
      toast.success('協力薬局を登録しました');
      setPartnerForm({ name: '', pharmacy_code: '', tel: '' });
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '協力薬局の登録に失敗しました');
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
      return readApiJson<PharmacyPartnershipRow>(response);
    },
    onSuccess: async () => {
      toast.success('薬局間連携を作成しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬局間連携の作成に失敗しました');
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
      return readApiJson<PharmacyPartnershipRow>(response);
    },
    onSuccess: async () => {
      toast.success('薬局間連携を有効化しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬局間連携の有効化に失敗しました');
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
      return readApiJson<PharmacyContractRow>(response);
    },
    onSuccess: async () => {
      toast.success('薬局間契約を登録しました');
      await invalidateSetup();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬局間契約の登録に失敗しました');
    },
  });

  const refetchAll = () => {
    void sitesQuery.refetch();
    void partnersQuery.refetch();
    void partnershipsQuery.refetch();
    void contractsQuery.refetch();
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
            contractsQuery.error
          }
          refetch={refetchAll}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="pharmacy-cooperation-setup">
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
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-full text-sm" aria-label="薬局間連携一覧">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    連携
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    協力薬局
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    有効期間
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    承認
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {partnerships.map((partnership) => {
                  const approvals = approvalForms[partnership.id] ?? {
                    base_approved_by: '',
                    partner_approved_by: '',
                  };
                  return (
                    <tr key={partnership.id} className="border-t border-border/70">
                      <td className="px-3 py-2">
                        <div className="font-medium">{partnership.id}</div>
                        <Badge className="mt-1" variant={statusVariant(partnership.status)}>
                          {statusLabel(partnership.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {partnership.base_site.name} / {partnership.partner_pharmacy.name}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDate(partnership.effective_from)} -{' '}
                        {formatDate(partnership.effective_to)}
                      </td>
                      <td className="min-w-72 px-3 py-2">
                        {partnership.status === 'active' ? (
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
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            activatePartnershipMutation.isPending || partnership.status === 'active'
                          }
                          onClick={() => activatePartnershipMutation.mutate(partnership.id)}
                        >
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          有効化
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      <SectionShell title="契約一覧" description="現在の契約と有効な費用条件を確認します。">
        {contracts.length === 0 ? (
          <EmptyState title="薬局間契約はまだありません" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-full text-sm" aria-label="薬局間契約一覧">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    契約
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    連携
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    期間
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    費用条件
                  </th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => (
                  <tr key={contract.id} className="border-t border-border/70">
                    <td className="px-3 py-2">
                      <div className="font-medium">{contract.id}</div>
                      <Badge className="mt-1" variant={statusVariant(contract.status)}>
                        {statusLabel(contract.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {contract.partnership.base_site.name} /{' '}
                      {contract.partnership.partner_pharmacy.name}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDate(contract.effective_from)} - {formatDate(contract.effective_to)}
                    </td>
                    <td className="px-3 py-2">
                      {billingModelLabel(contract.latest_version?.active_fee_rule?.billing_model)}
                      <span className="ml-2 tabular-nums text-muted-foreground">
                        {formatYen(contract.latest_version?.active_fee_rule?.unit_price)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>
    </div>
  );
}
