'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, Pill, AlertTriangle, Shield, Database, Download, History, CheckCircle2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import {
  getAdminDrugMasterShortcutLinks,
  getAdminFormularyShortcutLinks,
} from '@/components/features/admin/admin-page-shortcut-presets';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useOrgId } from '@/lib/hooks/use-org-id';

type DrugMasterRow = {
  id: string;
  yj_code: string;
  receipt_code: string | null;
  jan_code: string | null;
  drug_name: string;
  drug_name_kana: string | null;
  generic_name: string | null;
  drug_price: number | null;
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  max_administration_days: number | null;
};

type DrugMasterImportLog = {
  id: string;
  source: 'ssk' | 'pmda' | 'mhlw_price' | 'mhlw_generic' | 'hot' | 'manual_clinical';
  imported_at: string;
  record_count: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_log: string | null;
};

type ImportAction = 'ssk' | 'mhlw-price' | 'mhlw-generic' | 'hot' | 'pmda';

type DrugMasterDetail = DrugMasterRow & {
  hot_code: string | null;
  transitional_expiry_date: string | null;
  package_inserts: Array<{
    id: string;
    contraindications: unknown;
    interactions: unknown;
    adverse_effects: unknown;
    dosage_adjustment_renal: unknown;
    precautions_elderly: unknown;
    document_version: string | null;
    revised_at: string | null;
  }>;
  interactions_as_a: Array<{
    id: string;
    severity: 'contraindicated' | 'caution' | 'minor';
    mechanism: string | null;
    clinical_effect: string | null;
    source: 'pmda_xml' | 'kegg' | 'manual';
    drug_b: { id: string; drug_name: string; yj_code: string };
  }>;
  interactions_as_b: Array<{
    id: string;
    severity: 'contraindicated' | 'caution' | 'minor';
    mechanism: string | null;
    clinical_effect: string | null;
    source: 'pmda_xml' | 'kegg' | 'manual';
    drug_a: { id: string; drug_name: string; yj_code: string };
  }>;
};

type PharmacySiteOption = {
  id: string;
  name: string;
  address: string;
};

type PreferredGenericSummary = {
  id: string;
  drug_name: string;
  yj_code: string;
};

type GenericCandidateOption = {
  id: string;
  yj_code: string;
  drug_name: string;
};

type PharmacyDrugStockConfig = {
  id: string;
  site_id: string;
  drug_master_id: string;
  is_stocked: boolean;
  stock_qty: number | null;
  reorder_point: number | null;
  preferred_generic_id: string | null;
  updated_at: string;
  preferred_generic: PreferredGenericSummary | null;
};

const columns: ColumnDef<DrugMasterRow>[] = [
  {
    accessorKey: 'drug_name',
    header: '医薬品名',
    cell: ({ row }) => (
      <div className="min-w-[200px]">
        <div className="flex items-center gap-1.5">
          <Pill className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">{row.original.drug_name}</span>
        </div>
        {row.original.generic_name && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            一般名: {row.original.generic_name}
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'yj_code',
    header: 'YJコード',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.yj_code}
      </span>
    ),
  },
  {
    accessorKey: 'dosage_form',
    header: '剤形',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.dosage_form ?? '—'}</span>
    ),
  },
  {
    id: 'flags',
    header: '区分',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.is_generic && (
          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">後発</Badge>
        )}
        {row.original.is_narcotic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
            <AlertTriangle className="size-2.5" aria-hidden="true" />麻薬
          </span>
        )}
        {row.original.is_psychotropic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700">
            <Shield className="size-2.5" aria-hidden="true" />向精神
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'drug_price',
    header: '薬価',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.drug_price != null
          ? `¥${Number(row.original.drug_price).toFixed(1)}/${row.original.unit ?? ''}`
          : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'manufacturer',
    header: '製造元',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.manufacturer ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'max_administration_days',
    header: '最大日数',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.max_administration_days ?? '—'}
      </span>
    ),
  },
];

const CATEGORY_OPTIONS = [
  { value: '', label: '全薬効分類' },
  { value: '1', label: '1: 神経系及び感覚器官用医薬品' },
  { value: '2', label: '2: 個々の器官系用医薬品' },
  { value: '3', label: '3: 代謝性医薬品' },
  { value: '4', label: '4: 組織細胞機能用医薬品' },
  { value: '5', label: '5: 生薬及び漢方処方に基づく医薬品' },
  { value: '6', label: '6: 病原生物に対する医薬品' },
  { value: '7', label: '7: 治療を主目的としない医薬品' },
] as const;

const INTERACTION_SEVERITY_LABEL: Record<
  DrugMasterDetail['interactions_as_a'][number]['severity'],
  string
> = {
  contraindicated: '併用禁忌',
  caution: '併用注意',
  minor: '参考',
};

const IMPORT_ACTIONS: Array<{
  key: ImportAction;
  label: string;
  loadingLabel: string;
  endpoint: string;
  body?: Record<string, unknown>;
}> = [
  {
    key: 'ssk',
    label: 'SSK全件取込',
    loadingLabel: 'SSK取込中',
    endpoint: '/api/drug-master-imports/ssk',
  },
  {
    key: 'mhlw-price',
    label: '薬価更新',
    loadingLabel: '薬価更新中',
    endpoint: '/api/drug-master-imports/mhlw-price',
  },
  {
    key: 'mhlw-generic',
    label: '一般名/後発更新',
    loadingLabel: '一般名/後発更新中',
    endpoint: '/api/drug-master-imports/mhlw-generic',
    body: { mode: 'all' },
  },
  {
    key: 'hot',
    label: 'HOT取込',
    loadingLabel: 'HOT取込中',
    endpoint: '/api/drug-master-imports/hot',
  },
  {
    key: 'pmda',
    label: 'PMDA取込',
    loadingLabel: 'PMDA取込中',
    endpoint: '/api/drug-master-imports/pmda',
    body: { mode: 'delta' },
  },
];

const IMPORT_SOURCE_LABEL: Record<DrugMasterImportLog['source'], string> = {
  ssk: 'SSK',
  pmda: 'PMDA',
  mhlw_price: 'MHLW薬価',
  mhlw_generic: '一般名/後発',
  hot: 'HOT',
  manual_clinical: '手動臨床ルール',
};

function StructuredPayload({ value }: { value: unknown }) {
  if (value == null) {
    return <p className="text-sm text-muted-foreground">情報はまだ登録されていません。</p>;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm leading-6 text-foreground">{String(value)}</p>;
  }

  if (Array.isArray(value) && value.every((item) => typeof item !== 'object')) {
    return (
      <ul className="space-y-1 text-sm text-foreground">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`} className="rounded-md bg-muted/40 px-2 py-1">
            {String(item)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-5 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

type DrugMasterContentProps = {
  variant?: 'master' | 'formulary';
};

export function DrugMasterContent({ variant = 'master' }: DrugMasterContentProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('');
  const [genericOnly, setGenericOnly] = useState(false);
  const [narcoticOnly, setNarcoticOnly] = useState(false);
  const [selectedDrugId, setSelectedDrugId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [preferredGenericId, setPreferredGenericId] = useState<string | null>(null);
  const reorderPointInputRef = useRef<HTMLInputElement | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '50' });
    if (searchQuery) p.set('q', searchQuery);
    if (category) p.set('category', category);
    if (genericOnly) p.set('generic', 'true');
    if (narcoticOnly) p.set('narcotic', 'true');
    return p.toString();
  }, [searchQuery, category, genericOnly, narcoticOnly]);

  const { data, isLoading } = useQuery({
    queryKey: ['drug-masters', orgId, params],
    queryFn: async () => {
      const res = await fetch(`/api/drug-masters?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('医薬品マスターの取得に失敗しました');
      return res.json() as Promise<{
        data: DrugMasterRow[];
        totalCount: number;
        hasMore: boolean;
      }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const { data: sitesData } = useQuery({
    queryKey: ['pharmacy-sites', orgId, 'stock-setup'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy-sites', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('拠点一覧の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacySiteOption[] }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const { data: importLogsData, isLoading: isLoadingLogs } = useQuery({
    queryKey: ['drug-master-import-logs'],
    queryFn: async () => {
      const res = await fetch('/api/drug-master-import-logs?limit=5', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('取込履歴の取得に失敗しました');
      return res.json() as Promise<{ data: DrugMasterImportLog[] }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const detailQuery = useQuery({
    queryKey: ['drug-master-detail', orgId, selectedDrugId],
    queryFn: async () => {
      const res = await fetch(`/api/drug-masters/${selectedDrugId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('医薬品詳細の取得に失敗しました');
      }
      return res.json() as Promise<DrugMasterDetail>;
    },
    enabled: !!orgId && !!selectedDrugId,
    staleTime: 300_000,
  });

  const effectiveSelectedSiteId = selectedSiteId || sitesData?.data?.[0]?.id || '';

  const stockConfigQuery = useQuery({
    queryKey: ['pharmacy-drug-stock', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        drug_master_id: selectedDrugId ?? '',
      });
      const res = await fetch(`/api/pharmacy-drug-stocks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用品設定の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacyDrugStockConfig | null }>;
    },
    enabled: !!orgId && !!effectiveSelectedSiteId && !!selectedDrugId,
    staleTime: 300_000,
  });

  const preferredGenericCandidatesQuery = useQuery({
    queryKey: ['preferred-generic-candidates', orgId, selectedDrugId, detailQuery.data?.generic_name],
    queryFn: async () => {
      const genericName = detailQuery.data?.generic_name?.trim();
      if (!genericName) return { data: [] as GenericCandidateOption[] };
      const params = new URLSearchParams({
        q: genericName,
        generic: 'true',
        limit: '20',
      });
      const res = await fetch(`/api/drug-masters?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用後発薬候補の取得に失敗しました');
      return res.json() as Promise<{ data: GenericCandidateOption[] }>;
    },
    enabled: !!orgId && !!selectedDrugId && !!detailQuery.data?.generic_name,
    staleTime: 300_000,
  });

  const importMutation = useMutation({
    mutationFn: async (action: ImportAction) => {
      const definition = IMPORT_ACTIONS.find((item) => item.key === action);
      if (!definition) {
        throw new Error('未対応の取込アクションです');
      }

      const res = await fetch(definition.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(definition.body ?? {}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? `${definition.label}に失敗しました`);
      }
      return {
        action,
        definition,
        response: json as {
          data: {
            importedCount: number;
            entryName: string;
          };
        },
      };
    },
    onSuccess: async (result) => {
      toast.success(
        `${result.definition.label}が完了しました（${result.response.data.importedCount.toLocaleString()}件）`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-import-logs'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '医薬品マスタ取込に失敗しました');
    },
  });

  const stockMutation = useMutation({
    mutationFn: async (payload: {
      site_id: string;
      drug_master_id: string;
      is_stocked: boolean;
      preferred_generic_id?: string | null;
      reorder_point?: number | null;
    }) => {
      const res = await fetch('/api/pharmacy-drug-stocks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? '採用品設定の保存に失敗しました');
      }
      return json as { data: PharmacyDrugStockConfig };
    },
    onSuccess: async (result) => {
      toast.success(
        result.data.is_stocked
          ? '採用品設定を保存しました'
          : '採用品から外しました'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '採用品設定の保存に失敗しました');
    },
  });

  const activeImport = IMPORT_ACTIONS.find((item) => item.key === importMutation.variables);

  const drugs = data?.data ?? [];
  const sites = sitesData?.data ?? [];
  const importLogs = importLogsData?.data ?? [];
  const selectedRowIndex = selectedDrugId
    ? drugs.findIndex((drug) => drug.id === selectedDrugId)
    : undefined;
  const latestPackageInsert = detailQuery.data?.package_inserts[0] ?? null;
  const stockConfig = stockConfigQuery.data?.data ?? null;
  const effectivePreferredGenericId = preferredGenericId ?? stockConfig?.preferred_generic_id ?? '';
  const relatedInteractions = detailQuery.data
    ? [
        ...detailQuery.data.interactions_as_a.map((interaction) => ({
          id: interaction.id,
          severity: interaction.severity,
          mechanism: interaction.mechanism,
          clinical_effect: interaction.clinical_effect,
          source: interaction.source,
          counterpart: interaction.drug_b,
        })),
        ...detailQuery.data.interactions_as_b.map((interaction) => ({
          id: interaction.id,
          severity: interaction.severity,
          mechanism: interaction.mechanism,
          clinical_effect: interaction.clinical_effect,
          source: interaction.source,
          counterpart: interaction.drug_a,
        })),
      ]
    : [];
  const preferredGenericCandidates = preferredGenericCandidatesQuery.data?.data ?? [];
  const headerTitle = variant === 'formulary' ? '採用薬マスター' : '医薬品マスター';
  const headerDescription =
    variant === 'formulary'
      ? '拠点ごとの採用品設定と優先後発品を確認し、処方受付で使う採用薬候補を整備します。'
      : 'SSK基本マスター・PMDA添付文書データベースの管理';
  const headerShortcuts =
    variant === 'formulary'
      ? getAdminFormularyShortcutLinks()
      : getAdminDrugMasterShortcutLinks();

  const statusLabel = (status: DrugMasterImportLog['status']) => {
    switch (status) {
      case 'completed':
        return '完了';
      case 'failed':
        return '失敗';
      case 'running':
        return '実行中';
      default:
        return '待機';
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-4">
        <AdminPageHeader
          title={headerTitle}
          description={headerDescription}
          shortcuts={headerShortcuts}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {data?.totalCount !== undefined && (
            <Badge variant="outline" className="gap-1">
              <Database className="size-3" aria-hidden="true" />
              {data.totalCount.toLocaleString()}件
            </Badge>
          )}
          {IMPORT_ACTIONS.map((action) => (
            <LoadingButton
              key={action.key}
              type="button"
              size="sm"
              loading={importMutation.isPending && importMutation.variables === action.key}
              loadingLabel={action.loadingLabel}
              onClick={() => importMutation.mutate(action.key)}
              className="gap-1"
            >
              <Download className="size-3.5" aria-hidden="true" />
              {action.label}
            </LoadingButton>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
            <p className="text-sm text-muted-foreground">
              HOT は `HOT_MASTER_URL` または明示 URL、PMDA は `PMDA_PACKAGE_INSERT_FULL_URL` /
              `PMDA_PACKAGE_INSERT_DELTA_URL` を使います。PMDA 実ファイルの取得自体は
              メディナビ/マイ医薬品集の登録が前提です。
            </p>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Building2 className="size-3.5" aria-hidden="true" />
                採用品設定の対象拠点
              </span>
              <select
                value={effectiveSelectedSiteId}
                onChange={(event) => {
                  setSelectedSiteId(event.target.value);
                  setPreferredGenericId(null);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">拠点を選択</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {activeImport && importMutation.isPending && (
            <p className="mt-2 text-xs text-muted-foreground">
              実行中: {activeImport.label}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" aria-hidden="true" />
            取込履歴
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoadingLogs ? (
            <p className="text-sm text-muted-foreground">履歴を読み込み中です…</p>
          ) : importLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ取込履歴はありません。</p>
          ) : (
            importLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium uppercase">
                      {IMPORT_SOURCE_LABEL[log.source]}
                    </span>
                    <Badge
                      variant={log.status === 'failed' ? 'destructive' : 'outline'}
                      className="text-[10px]"
                    >
                      {statusLabel(log.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.imported_at).toLocaleString('ja-JP')} ・ {log.record_count.toLocaleString()}件
                  </div>
                  {log.error_log && (
                    <div className="text-xs text-red-600">{log.error_log}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Search & Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">検索・フィルタ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="医薬品名・カナ・YJコード・一般名で検索"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
                aria-label="医薬品検索"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="薬効分類フィルタ"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={genericOnly}
                onChange={(e) => setGenericOnly(e.target.checked)}
                className="size-4 rounded border-input"
              />
              後発品のみ
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={narcoticOnly}
                onChange={(e) => setNarcoticOnly(e.target.checked)}
                className="size-4 rounded border-input"
              />
              麻薬のみ
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <DataTable
        columns={columns}
        data={drugs}
        isLoading={isLoading}
        caption="医薬品マスター一覧"
        onRowClick={(index) => {
          setSelectedDrugId(drugs[index]?.id ?? null);
          setPreferredGenericId(null);
        }}
        selectedRowIndex={selectedRowIndex !== -1 ? selectedRowIndex : undefined}
      />

      <Sheet
        open={selectedDrugId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDrugId(null);
            setPreferredGenericId(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="border-b border-border/60">
            <SheetTitle>
              {detailQuery.data?.drug_name ?? '医薬品詳細'}
            </SheetTitle>
            <SheetDescription>
              行を選択すると最新の添付文書要約と相互作用を確認できます。
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 p-4">
            {detailQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">医薬品詳細を読み込み中です…</p>
            ) : detailQuery.isError ? (
              <p className="text-sm text-red-600">
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : '医薬品詳細の取得に失敗しました'}
              </p>
            ) : detailQuery.data ? (
              <>
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-foreground">採用品設定</h2>
                  {!effectiveSelectedSiteId ? (
                    <p className="text-sm text-muted-foreground">
                      先に対象拠点を選択してください。
                    </p>
                  ) : stockConfigQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">採用品設定を読み込み中です…</p>
                  ) : (
                    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {sites.find((site) => site.id === effectiveSelectedSiteId)?.name ?? '対象拠点'}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {stockConfig?.is_stocked
                              ? '採用品として登録済みです。必要に応じて採用後発薬を指定してください。'
                              : 'この薬を採用品として登録できます。'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {stockConfig?.is_stocked ? (
                            <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                              <CheckCircle2 className="size-3.5" aria-hidden="true" />
                              採用品
                            </Badge>
                          ) : (
                            <Badge variant="outline">未登録</Badge>
                          )}
                          <LoadingButton
                            type="button"
                            size="sm"
                            loading={stockMutation.isPending}
                            loadingLabel="保存中"
                            onClick={() =>
                              stockMutation.mutate({
                                site_id: effectiveSelectedSiteId,
                                drug_master_id: detailQuery.data.id,
                                is_stocked: !(stockConfig?.is_stocked ?? false),
                                preferred_generic_id:
                                  stockConfig?.is_stocked
                                    ? null
                                    : effectivePreferredGenericId || null,
                                reorder_point:
                                  stockConfig?.is_stocked
                                    ? null
                                    : stockConfig?.reorder_point ?? null,
                              })
                            }
                          >
                            {stockConfig?.is_stocked ? '採用品から外す' : '採用品に登録'}
                          </LoadingButton>
                        </div>
                      </div>

                      {(detailQuery.data.generic_name || preferredGenericCandidates.length > 0) && (
                        <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">採用後発薬</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              一般名 {detailQuery.data.generic_name ?? '未設定'} に対する採用後発薬を設定します。
                            </p>
                          </div>
                          <select
                            value={effectivePreferredGenericId}
                            onChange={(event) => setPreferredGenericId(event.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">指定しない</option>
                            {preferredGenericCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.drug_name} ({candidate.yj_code})
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              現在: {stockConfig?.preferred_generic?.drug_name ?? '未設定'}
                            </p>
                            <LoadingButton
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={stockMutation.isPending}
                              loadingLabel="保存中"
                              disabled={!effectiveSelectedSiteId}
                              onClick={() =>
                                stockMutation.mutate({
                                  site_id: effectiveSelectedSiteId,
                                  drug_master_id: detailQuery.data.id,
                                  is_stocked: true,
                                  preferred_generic_id: effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.reorder_point ?? null,
                                })
                              }
                            >
                              後発薬設定を保存
                            </LoadingButton>
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">在庫下限アラート</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            下限数量を下回った場合の補充アラート閾値を設定します。
                          </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">下限数量</span>
                            <Input
                              ref={reorderPointInputRef}
                              type="number"
                              min={0}
                              defaultValue={stockConfig?.reorder_point ?? ''}
                              placeholder="例: 10"
                              className="w-32"
                            />
                          </label>
                          <LoadingButton
                            type="button"
                            size="sm"
                            variant="outline"
                            loading={stockMutation.isPending}
                            loadingLabel="保存中"
                            disabled={!effectiveSelectedSiteId}
                            onClick={() => {
                              const rawValue = reorderPointInputRef.current?.value?.trim() ?? '';
                              const parsedValue =
                                rawValue.length === 0 ? null : Number.parseInt(rawValue, 10);
                              if (rawValue.length > 0 && Number.isNaN(parsedValue)) {
                                toast.error('在庫下限は 0 以上の整数で入力してください');
                                return;
                              }

                              stockMutation.mutate({
                                site_id: effectiveSelectedSiteId,
                                drug_master_id: detailQuery.data.id,
                                is_stocked: stockConfig?.is_stocked ?? true,
                                preferred_generic_id: effectivePreferredGenericId || null,
                                reorder_point: parsedValue,
                              });
                            }}
                          >
                            アラート閾値を保存
                          </LoadingButton>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          現在値: {stockConfig?.reorder_point != null ? `${stockConfig.reorder_point}単位` : '未設定'}
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">YJ {detailQuery.data.yj_code}</Badge>
                    {detailQuery.data.hot_code && (
                      <Badge variant="outline">HOT {detailQuery.data.hot_code}</Badge>
                    )}
                    {detailQuery.data.is_generic && <Badge variant="outline">後発品</Badge>}
                    {detailQuery.data.is_narcotic && (
                      <Badge variant="destructive">麻薬</Badge>
                    )}
                    {detailQuery.data.is_psychotropic && (
                      <Badge variant="outline" className="border-orange-300 text-orange-700">
                        向精神
                      </Badge>
                    )}
                  </div>
                  <dl className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        一般名
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {detailQuery.data.generic_name ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        薬効分類
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {detailQuery.data.therapeutic_category ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        薬価
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {detailQuery.data.drug_price != null
                          ? `¥${Number(detailQuery.data.drug_price).toFixed(1)}/${detailQuery.data.unit ?? ''}`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        最大投与日数
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {detailQuery.data.max_administration_days ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        経過措置期限
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {detailQuery.data.transitional_expiry_date
                          ? new Date(detailQuery.data.transitional_expiry_date).toLocaleDateString('ja-JP')
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        最新改訂
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {latestPackageInsert?.revised_at
                          ? new Date(latestPackageInsert.revised_at).toLocaleDateString('ja-JP')
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-foreground">添付文書詳細</h2>
                  <div className="grid gap-4">
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">禁忌</h3>
                      <StructuredPayload value={latestPackageInsert?.contraindications} />
                    </div>
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">重大な副作用</h3>
                      <StructuredPayload value={latestPackageInsert?.adverse_effects} />
                    </div>
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">腎機能別用量調整</h3>
                      <StructuredPayload value={latestPackageInsert?.dosage_adjustment_renal} />
                    </div>
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">高齢者への注意</h3>
                      <StructuredPayload value={latestPackageInsert?.precautions_elderly} />
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-foreground">相互作用一覧</h2>
                  {relatedInteractions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      直近の相互作用データはまだ登録されていません。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {relatedInteractions.map((interaction) => (
                        <div
                          key={interaction.id}
                          className="rounded-lg border border-border/60 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                interaction.severity === 'contraindicated'
                                  ? 'destructive'
                                  : 'outline'
                              }
                            >
                              {INTERACTION_SEVERITY_LABEL[interaction.severity]}
                            </Badge>
                            <span className="text-sm font-medium text-foreground">
                              {interaction.counterpart.drug_name}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {interaction.counterpart.yj_code}
                            </span>
                          </div>
                          {interaction.mechanism && (
                            <p className="mt-2 text-sm text-muted-foreground">
                              機序: {interaction.mechanism}
                            </p>
                          )}
                          {interaction.clinical_effect && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              臨床影響: {interaction.clinical_effect}
                            </p>
                          )}
                          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                            source: {interaction.source}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                一覧から医薬品を選択してください。
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
