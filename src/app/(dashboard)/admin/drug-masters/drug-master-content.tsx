'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Search,
  Download,
  CheckCircle2,
  Building2,
  ClipboardCheck,
  ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import {
  buildApprovedServerExportDescriptor,
  getApprovedServerExportDescriptorProblem,
  type ApprovedServerExportSurfaceId,
} from '@/lib/audit/server-export-registry';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import {
  getAdminDrugMasterShortcutLinks,
  getAdminFormularyShortcutLinks,
} from '@/components/features/admin/admin-page-shortcut-presets';
import { PageSection } from '@/components/layout/page-section';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActionRail } from '@/components/ui/action-rail';
import { ErrorState } from '@/components/ui/error-state';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { SkeletonRows } from '@/components/ui/loading';
import { LoadingButton } from '@/components/ui/loading-button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildDrugMasterApiPath,
  buildDrugMasterGenericRecommendationsApiPath,
  buildDrugMasterIngredientGroupApiPath,
  buildDrugMastersApiPath,
} from '@/lib/drug-masters/api-paths';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import {
  buildPharmacyDrugStockBulkApiPath,
  buildPharmacyDrugStockCopyApiPath,
  buildPharmacyDrugStockExportApiPath,
  buildPharmacyDrugStockHistoryApiPath,
  buildPharmacyDrugStockImpactApiPath,
  buildPharmacyDrugStockRequestApiPath,
  buildPharmacyDrugStockRequestsApiPath,
  buildPharmacyDrugStockReviewApiPath,
  buildPharmacyDrugStockSafetyFollowUpApiPath,
  buildPharmacyDrugStocksApiPath,
  buildPharmacyDrugStockTemplateApiPath,
  buildPharmacyDrugStockTemplateApplyApiPath,
  buildPharmacyDrugStockTemplateCsvApiPath,
  buildPharmacyDrugStockTemplatesApiPath,
  buildPharmacyDrugStockUsageMismatchApiPath,
} from '@/lib/pharmacy-drug-stocks/api-paths';
import { PageScaffold } from '@/components/layout/page-scaffold';
import type { DrugMasterImportStatusResponse } from '@/types/drug-master-import-status';
import {
  buildBulkPreviewViewModel,
  buildDrugMasterFilterViewModel,
  buildDrugMasterSelectionViewModel,
  buildDrugMasterSiteHeaderViewModel,
  buildDrugSafetyDisplayViewModel,
  buildFormularyOperationsViewModel,
  formatImportStatusLabel,
  type ImpactQueueKey,
} from './drug-master-formulary-view-model';

import { baseColumns } from './drug-master-content-columns';
import { DrugMasterDetailSheet } from './drug-master-detail-sheet';
import { FormularyOperationsPanel } from './drug-master-formulary-operations-panel';
import {
  CATEGORY_OPTIONS,
  CLIPBOARD_COPY_ERROR_MESSAGE,
  collectOfficialImportPreviewGroups,
  copyTextToClipboard,
  DRUG_MASTER_SEARCH_DEBOUNCE_MS,
  formatFormularyRequestDecisionDescription,
  formatFormularyTemplateSummary,
  formatImportChangeSummary,
  formatImportMode,
  formatImportPublishedAt,
  formatImportSourceHash,
  formatImportSourceUrl,
  formatOfficialImportPreviewRow,
  formatOfficialImportPreviewSummary,
  IMPORT_ACTIONS,
  IMPORT_LOG_SOURCE_OPTIONS,
  IMPORT_LOG_STATUS_OPTIONS,
  IMPORT_SOURCE_LABEL,
  parseReorderPointInput,
} from './drug-master-content-format';
import type {
  BulkPreviewResponse,
  DrugMasterContentProps,
  DrugMasterDetail,
  DrugMasterImportLog,
  DrugMasterRow,
  FormularyChangeRequestItem,
  FormularyChangeRequestListResponse,
  FormularyCopyPreviewResponse,
  FormularyExportPurpose,
  FormularyImpactResponse,
  FormularyRequestDecisionTarget,
  FormularyStockSummaryRow,
  FormularyTemplateItem,
  FormularyTemplatePreviewResponse,
  FormularyUsageMismatchResponse,
  GenericCandidateOption,
  GenericRecommendation,
  ImportAction,
  IngredientGroupResponse,
  OfficialImportPreviewData,
  OfficialImportPreviewState,
  PharmacyDrugStockConfig,
  PharmacyDrugStockHistoryItem,
  PharmacySiteOption,
} from './drug-master-content-types';

// parseReorderPointInput は既存テスト（drug-master-content.test.tsx）が本モジュールから
// import しているため、公開 API 互換のため再エクスポートする（本体でも利用）。
export { parseReorderPointInput };

const FORMULARY_EXPORT_SURFACE_BY_PURPOSE = {
  operations: 'pharmacy_drug_stocks_operations_csv',
  audit: 'pharmacy_drug_stocks_audit_csv',
  posting: 'pharmacy_drug_stocks_posting_csv',
  pharmacist_review: 'pharmacy_drug_stocks_pharmacist_review_csv',
} as const satisfies Record<FormularyExportPurpose, ApprovedServerExportSurfaceId>;

function toApiPath(path: string): `/api/${string}` {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/api/') || trimmed.startsWith('//') || /[\r\n\t]/.test(trimmed)) {
    throw new Error('採用薬CSVの出力URLが安全なアプリ内APIパスではありません');
  }
  return trimmed as `/api/${string}`;
}

function DrugMasterOperationalContent({
  variant = 'master',
}: Pick<DrugMasterContentProps, 'variant'>) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('');
  const [genericOnly, setGenericOnly] = useState(false);
  const [narcoticOnly, setNarcoticOnly] = useState(false);
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [lasaOnly, setLasaOnly] = useState(false);
  const [stockedOnly, setStockedOnly] = useState(variant === 'formulary');
  const [selectedDrugId, setSelectedDrugId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [copySourceSiteId, setCopySourceSiteId] = useState('');
  const [copyOverwrite, setCopyOverwrite] = useState(false);
  const [copyPreview, setCopyPreview] = useState<FormularyCopyPreviewResponse | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [importLogSourceFilter, setImportLogSourceFilter] = useState<
    'all' | DrugMasterImportLog['source']
  >('all');
  const [importLogStatusFilter, setImportLogStatusFilter] = useState<
    'all' | DrugMasterImportLog['status']
  >('all');
  const [templatePreview, setTemplatePreview] = useState<FormularyTemplatePreviewResponse | null>(
    null,
  );
  const [preferredGenericId, setPreferredGenericId] = useState<string | null>(null);
  const [bulkCsv, setBulkCsv] = useState('');
  const [exportPurpose, setExportPurpose] = useState<FormularyExportPurpose>('operations');
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewResponse | null>(null);
  const [bulkPreviewExpanded, setBulkPreviewExpanded] = useState(false);
  const [impactQueue, setImpactQueue] = useState<ImpactQueueKey>('action_required');
  const [formularyRequestDecisionTarget, setFormularyRequestDecisionTarget] =
    useState<FormularyRequestDecisionTarget | null>(null);
  const [deleteTemplateConfirmOpen, setDeleteTemplateConfirmOpen] = useState(false);
  const [pendingImportAction, setPendingImportAction] = useState<ImportAction | null>(null);
  const [officialImportPreview, setOfficialImportPreview] =
    useState<OfficialImportPreviewState | null>(null);
  const [officialImportPreviewError, setOfficialImportPreviewError] = useState<string | null>(null);
  const [officialImportPreviewLoadingAction, setOfficialImportPreviewLoadingAction] =
    useState<ImportAction | null>(null);
  const [autoRefreshConfirmOpen, setAutoRefreshConfirmOpen] = useState(false);
  const [reorderPointError, setReorderPointError] = useState<string | null>(null);
  const [expiryReferenceTime] = useState(() => Date.now());
  const reorderPointInputRef = useRef<HTMLInputElement | null>(null);
  const debouncedSearchQuery = useDebouncedValue(
    searchQuery.trim(),
    DRUG_MASTER_SEARCH_DEBOUNCE_MS,
  );
  const openDrugDetail = (drugId: string | null) => {
    setSelectedDrugId(drugId);
    setPreferredGenericId(null);
    setReorderPointError(null);
  };
  const debouncedTemplateSearchQuery = useDebouncedValue(
    templateSearchQuery.trim(),
    DRUG_MASTER_SEARCH_DEBOUNCE_MS,
  );

  const {
    data: sitesData,
    isError: isSitesError,
    refetch: refetchSites,
  } = useQuery({
    queryKey: ['pharmacy-sites', orgId, 'stock-setup'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy-sites', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: PharmacySiteOption[] }>(res, '拠点一覧の取得に失敗しました');
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const effectiveSelectedSiteId = selectedSiteId || sitesData?.data?.[0]?.id || '';

  // P1 医療安全: in-flight な dry-run/プレビュー応答が解決する前に対象拠点（やコピー元/
  // テンプレート/上書き/CSV）が変わると、古いコンテキストのプレビューを現在の UI に描画して
  // しまい誤った拠点へ適用しうる。リクエスト発行時のコンテキストを各 mutationFn で確定し、
  // onSuccess で「最新値」を保持する ref と一致しない場合はプレビュー反映を破棄する。
  //
  // ref はレースを防ぐため、コンテキストを変更する各イベントハンドラ内で**同期的に**更新する
  // （react-hooks/refs はハンドラ内の ref 書き込みを許容、render 中の書き込みのみ禁止）。
  // 受動的 effect だけだと、コンテキスト変更後・effect flush 前に解決した stale な onSuccess が
  // 旧 ref 値と比較して古いプレビューを復元してしまう。effect は backstop として残す。
  const effectiveSelectedSiteIdRef = useRef(effectiveSelectedSiteId);
  const copySourceSiteIdRef = useRef(copySourceSiteId);
  const selectedTemplateIdRef = useRef(selectedTemplateId);
  const bulkCsvRef = useRef(bulkCsv);
  const overwriteRef = useRef(copyOverwrite);
  useEffect(() => {
    effectiveSelectedSiteIdRef.current = effectiveSelectedSiteId;
    copySourceSiteIdRef.current = copySourceSiteId;
    selectedTemplateIdRef.current = selectedTemplateId;
    bulkCsvRef.current = bulkCsv;
    overwriteRef.current = copyOverwrite;
  }, [effectiveSelectedSiteId, copySourceSiteId, selectedTemplateId, bulkCsv, copyOverwrite]);

  // drift-proof setter helpers: state と stale-guard 用 ref を**原子的に**同期する。これらを
  // 経由しない setSelectedTemplateId/setBulkCsv 直呼びは禁止（reset 経路でも ref を取り残さない）。
  const applySelectedTemplateId = (value: string) => {
    setSelectedTemplateId(value);
    selectedTemplateIdRef.current = value;
  };
  const applyBulkCsv = (value: string) => {
    setBulkCsv(value);
    bulkCsvRef.current = value;
  };

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '50' });
    if (debouncedSearchQuery) p.set('q', debouncedSearchQuery);
    if (category) p.set('category', category);
    if (genericOnly) p.set('generic', 'true');
    if (narcoticOnly) p.set('narcotic', 'true');
    if (highRiskOnly) p.set('highRisk', 'true');
    if (lasaOnly) p.set('lasa', 'true');
    if (effectiveSelectedSiteId) p.set('site_id', effectiveSelectedSiteId);
    if (stockedOnly && effectiveSelectedSiteId) p.set('stocked', 'true');
    return p.toString();
  }, [
    debouncedSearchQuery,
    category,
    genericOnly,
    narcoticOnly,
    highRiskOnly,
    lasaOnly,
    effectiveSelectedSiteId,
    stockedOnly,
  ]);

  const {
    data,
    isLoading,
    isError: isDrugMasterError,
    error: drugMasterError,
    refetch: refetchDrugMasters,
    fetchNextPage: fetchNextDrugMasters,
    hasNextPage: hasMoreDrugMasters,
    isFetchingNextPage: isFetchingMoreDrugMasters,
  } = useInfiniteQuery({
    queryKey: ['drug-masters', orgId, params],
    // cursor pagination: 各ページの nextCursor を次ページの cursor として付与し、行を累積する。
    // これがないと検索/フィルタ結果の 51 件目以降が hasMore で捨てられて表示されない（W2-F2）。
    queryFn: async ({ pageParam }) => {
      const pageParams = new URLSearchParams(params);
      if (pageParam) pageParams.set('cursor', pageParam);
      const res = await fetch(buildDrugMastersApiPath(pageParams.toString()), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{
        data: DrugMasterRow[];
        totalCount: number;
        hasMore: boolean;
        nextCursor?: string;
      }>(res, '医薬品マスターの取得に失敗しました');
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const {
    data: masterStatusData,
    isError: isMasterStatusError,
    refetch: refetchMasterStatus,
  } = useQuery({
    queryKey: ['drug-master-status'],
    queryFn: async () => {
      const res = await fetch('/api/drug-master-imports/status', {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: DrugMasterImportStatusResponse }>(
        res,
        'マスターステータスの取得に失敗しました',
      );
      return payload.data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const {
    data: importLogsData,
    isLoading: isLoadingLogs,
    isError: isImportLogsError,
    refetch: refetchImportLogs,
  } = useQuery({
    queryKey: ['drug-master-import-logs', importLogSourceFilter, importLogStatusFilter],
    queryFn: async () => {
      const logParams = new URLSearchParams({ limit: '10' });
      if (importLogSourceFilter !== 'all') logParams.set('source', importLogSourceFilter);
      if (importLogStatusFilter !== 'all') logParams.set('status', importLogStatusFilter);
      const res = await fetch(`/api/drug-master-import-logs?${logParams}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: DrugMasterImportLog[] }>(res, '取込履歴の取得に失敗しました');
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const detailQuery = useQuery({
    queryKey: ['drug-master-detail', orgId, selectedDrugId],
    queryFn: async () => {
      if (!selectedDrugId) throw new Error('医薬品を選択してください');
      const res = await fetch(buildDrugMasterApiPath(selectedDrugId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<DrugMasterDetail>(res, '医薬品詳細の取得に失敗しました');
    },
    enabled: !!orgId && !!selectedDrugId,
    staleTime: 300_000,
  });

  const stockConfigQuery = useQuery({
    queryKey: ['pharmacy-drug-stock', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        drug_master_id: selectedDrugId ?? '',
      });
      const res = await fetch(buildPharmacyDrugStocksApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: PharmacyDrugStockConfig | null }>(
        res,
        '採用品設定の取得に失敗しました',
      );
    },
    enabled: !!orgId && !!effectiveSelectedSiteId && !!selectedDrugId,
    staleTime: 300_000,
  });

  const stockHistoryQuery = useQuery({
    queryKey: ['pharmacy-drug-stock-history', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        drug_master_id: selectedDrugId ?? '',
        limit: '10',
      });
      const res = await fetch(buildPharmacyDrugStockHistoryApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: PharmacyDrugStockHistoryItem[] }>(
        res,
        '採用品履歴の取得に失敗しました',
      );
    },
    enabled: !!orgId && !!effectiveSelectedSiteId && !!selectedDrugId,
    staleTime: 60_000,
  });

  const formularyReviewQuery = useQuery({
    queryKey: ['pharmacy-drug-stocks', orgId, effectiveSelectedSiteId, 'review-due'],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        review_due: 'true',
        limit: '200',
      });
      const res = await fetch(buildPharmacyDrugStocksApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: FormularyStockSummaryRow[] }>(
        res,
        '採用薬レビュー対象の取得に失敗しました',
      );
    },
    enabled: variant === 'formulary' && !!orgId && !!effectiveSelectedSiteId,
    staleTime: 60_000,
  });

  const formularyMissingReorderQuery = useQuery({
    queryKey: ['pharmacy-drug-stocks', orgId, effectiveSelectedSiteId, 'missing-reorder'],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        missing_reorder_point: 'true',
        limit: '200',
      });
      const res = await fetch(buildPharmacyDrugStocksApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: FormularyStockSummaryRow[] }>(
        res,
        '在庫下限未設定の取得に失敗しました',
      );
    },
    enabled: variant === 'formulary' && !!orgId && !!effectiveSelectedSiteId,
    staleTime: 60_000,
  });

  const formularyImpactQuery = useQuery({
    queryKey: ['pharmacy-drug-stocks-impact', orgId, effectiveSelectedSiteId, impactQueue],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        expiry_within_days: '90',
        review_overdue_days: '180',
        queue: impactQueue,
        queue_limit: '25',
      });
      const res = await fetch(buildPharmacyDrugStockImpactApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<FormularyImpactResponse>(res, '採用薬影響レビューの取得に失敗しました');
    },
    enabled: variant === 'formulary' && !!orgId && !!effectiveSelectedSiteId,
    staleTime: 60_000,
  });

  const formularyUsageMismatchQuery = useQuery({
    queryKey: ['pharmacy-drug-stock-usage-mismatch', orgId, effectiveSelectedSiteId],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        days: '90',
        frequent_threshold: '2',
        limit: '10',
      });
      const res = await fetch(buildPharmacyDrugStockUsageMismatchApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<FormularyUsageMismatchResponse>(
        res,
        '処方・採用品不一致の取得に失敗しました',
      );
    },
    enabled: variant === 'formulary' && !!orgId && !!effectiveSelectedSiteId,
    staleTime: 60_000,
  });

  const formularyRequestsQuery = useQuery({
    queryKey: ['pharmacy-drug-stock-requests', orgId, effectiveSelectedSiteId, 'pending'],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        status: 'pending',
        overdue_days: '7',
        limit: '50',
      });
      const res = await fetch(buildPharmacyDrugStockRequestsApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<FormularyChangeRequestListResponse>(
        res,
        '採用品変更申請の取得に失敗しました',
      );
    },
    enabled: variant === 'formulary' && !!orgId && !!effectiveSelectedSiteId,
    staleTime: 60_000,
  });

  const formularyTemplatesQuery = useQuery({
    queryKey: ['pharmacy-drug-stock-templates', orgId, debouncedTemplateSearchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '50' });
      const query = debouncedTemplateSearchQuery;
      if (query) params.set('q', query);
      const res = await fetch(buildPharmacyDrugStockTemplatesApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: FormularyTemplateItem[] }>(
        res,
        '採用品テンプレートの取得に失敗しました',
      );
    },
    enabled: variant === 'formulary' && !!orgId,
    staleTime: 60_000,
  });

  const preferredGenericCandidatesQuery = useQuery({
    queryKey: [
      'preferred-generic-candidates',
      orgId,
      selectedDrugId,
      detailQuery.data?.generic_name,
    ],
    queryFn: async () => {
      const genericName = detailQuery.data?.generic_name?.trim();
      if (!genericName) return { data: [] as GenericCandidateOption[] };
      const params = new URLSearchParams({
        q: genericName,
        generic: 'true',
        limit: '20',
        includeTotal: 'false',
      });
      const res = await fetch(buildDrugMastersApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: GenericCandidateOption[] }>(
        res,
        '採用後発薬候補の取得に失敗しました',
      );
    },
    enabled: !!orgId && !!selectedDrugId && !!detailQuery.data?.generic_name,
    staleTime: 300_000,
  });

  const genericRecommendationsQuery = useQuery({
    queryKey: ['generic-recommendations', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      if (!selectedDrugId) {
        return { data: { recommendations: [] as GenericRecommendation[] } };
      }
      const params = new URLSearchParams({ limit: '8' });
      if (effectiveSelectedSiteId) params.set('site_id', effectiveSelectedSiteId);
      const res = await fetch(
        buildDrugMasterGenericRecommendationsApiPath(selectedDrugId, params),
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      return readApiJson<{ data: { recommendations: GenericRecommendation[] } }>(
        res,
        '推奨後発品の取得に失敗しました',
      );
    },
    enabled: !!orgId && !!selectedDrugId && !!detailQuery.data?.generic_name,
    staleTime: 300_000,
  });

  const ingredientGroupQuery = useQuery({
    queryKey: ['ingredient-group', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      if (!selectedDrugId) {
        throw new Error('医薬品を選択してください');
      }
      const params = new URLSearchParams({ limit: '50' });
      if (effectiveSelectedSiteId) params.set('site_id', effectiveSelectedSiteId);
      const res = await fetch(buildDrugMasterIngredientGroupApiPath(selectedDrugId, params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<IngredientGroupResponse>(res, '同一成分グループの取得に失敗しました');
    },
    enabled: !!orgId && !!selectedDrugId && !!detailQuery.data?.generic_name,
    staleTime: 300_000,
  });

  const openImportConfirmation = (action: ImportAction) => {
    setPendingImportAction(action);
    setOfficialImportPreview(null);
    setOfficialImportPreviewError(null);
  };

  const runOfficialImportPreview = async (action: ImportAction) => {
    const definition = IMPORT_ACTIONS.find((item) => item.key === action);
    if (!definition) {
      setOfficialImportPreviewError('未対応の取込アクションです');
      return;
    }

    setOfficialImportPreview(null);
    setOfficialImportPreviewError(null);
    setOfficialImportPreviewLoadingAction(action);
    try {
      const res = await fetch(definition.endpoint, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          ...(definition.body ?? {}),
          dryRun: true,
          previewLimit: 5,
        }),
      });
      const json = await readApiJson<{ data?: OfficialImportPreviewData }>(
        res,
        `${definition.label}の差分確認に失敗しました`,
      );

      setOfficialImportPreview({
        action,
        data: (json?.data ?? {}) as OfficialImportPreviewData,
      });
      toast.success(`${definition.label}の差分確認が完了しました`);
    } catch (error) {
      const message = messageFromError(error, `${definition.label}の差分確認に失敗しました`);
      setOfficialImportPreviewError(message);
      toast.error(message);
    } finally {
      setOfficialImportPreviewLoadingAction(null);
    }
  };

  const importMutation = useMutation({
    mutationFn: async (action: ImportAction) => {
      const definition = IMPORT_ACTIONS.find((item) => item.key === action);
      if (!definition) {
        throw new Error('未対応の取込アクションです');
      }

      const res = await fetch(definition.endpoint, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(definition.body ?? {}),
      });
      const json = await readApiJson<{
        data: {
          importedCount: number;
          entryName: string;
        };
      }>(res, `${definition.label}に失敗しました`);
      return {
        action,
        definition,
        response: json,
      };
    },
    onSuccess: async (result) => {
      toast.success(
        `${result.definition.label}が完了しました（${result.response.data.importedCount.toLocaleString()}件）`,
      );
      // P1 医療安全: マスタ取込でプレビュー計算の前提（薬剤本体）が変わるため、取込前に算出した
      // コピー/テンプレート/CSV プレビューを破棄する（古い行・件数で操作させない）。invalidate の
      // await より**前**に同期クリアする — 再フェッチが遅い間に古いプレビューが操作可能なまま
      // 残らないようにする（canApplyBulkPreview はローカル算出）。
      setCopyPreview(null);
      setTemplatePreview(null);
      setBulkPreview(null);
      setBulkPreviewExpanded(false);
      setOfficialImportPreview(null);
      setOfficialImportPreviewError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-import-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-status'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '医薬品マスタ取込に失敗しました'));
    },
  });

  const autoRefreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/jobs/drug-master-auto-refresh', {
        method: 'POST',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ jobType?: string; processedCount?: number; errors?: string[] }>(
        res,
        '一括更新の実行に失敗しました',
      );
    },
    onSuccess: async (result) => {
      const processedCount = result.processedCount;
      toast.success(
        processedCount != null
          ? `フリーマスター一括更新が完了しました（${processedCount.toLocaleString()}件）`
          : 'フリーマスター一括更新が完了しました',
      );
      // P1 医療安全: 一括更新でマスタが変わるため、更新前に算出したプレビューを破棄する。
      // invalidate の await より**前**に同期クリアする（再フェッチ待ちの間も操作させない）。
      setCopyPreview(null);
      setTemplatePreview(null);
      setBulkPreview(null);
      setBulkPreviewExpanded(false);
      setOfficialImportPreview(null);
      setOfficialImportPreviewError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-import-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-status'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '一括更新に失敗しました'));
    },
  });

  const freshnessCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/jobs/drug-master-freshness-check', {
        method: 'POST',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ processedCount?: number; errors?: string[] }>(
        res,
        'マスター鮮度チェックに失敗しました',
      );
    },
    onSuccess: async (result) => {
      toast.success(
        result.processedCount != null
          ? `マスター鮮度チェックが完了しました（${result.processedCount.toLocaleString()}件）`
          : 'マスター鮮度チェックが完了しました',
      );
      await queryClient.invalidateQueries({ queryKey: ['drug-master-status'] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'マスター鮮度チェックに失敗しました'));
    },
  });

  const stockMutation = useMutation({
    mutationFn: async (payload: {
      site_id: string;
      drug_master_id: string;
      is_stocked: boolean;
      preferred_generic_id?: string | null;
      reorder_point?: number | null;
      follow_up_status?:
        | 'active'
        | 'needs_review'
        | 'planned_switch'
        | 'monitoring'
        | 'resolved'
        | null;
      follow_up_reason?: string | null;
      follow_up_due_date?: string | null;
    }) => {
      const res = await fetch(buildPharmacyDrugStocksApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(payload),
      });
      return readApiJson<{ site: PharmacySiteOption; data: PharmacyDrugStockConfig }>(
        res,
        '採用品設定の保存に失敗しました',
      );
    },
    onSuccess: async (result) => {
      toast.success(result.data.is_stocked ? '採用品設定を保存しました' : '採用品から外しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
        queryClient.invalidateQueries({ queryKey: ['generic-recommendations'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用品設定の保存に失敗しました'));
    },
  });

  const stockRequestMutation = useMutation({
    mutationFn: async (payload: {
      site_id: string;
      drug_master_id: string;
      action_type: 'adopt' | 'deactivate' | 'update_settings';
      requested_payload: {
        is_stocked: boolean;
        reorder_point?: number | null;
        preferred_generic_id?: string | null;
        adoption_note?: string | null;
      };
      reason?: string | null;
    }) => {
      const res = await fetch(buildPharmacyDrugStockRequestsApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(payload),
      });
      return readApiJson<{ data: FormularyChangeRequestItem }>(
        res,
        '採用品変更申請の作成に失敗しました',
      );
    },
    onSuccess: async () => {
      toast.success('採用品変更申請を作成しました');
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-requests'] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用品変更申請の作成に失敗しました'));
    },
  });

  const stockRequestDecisionMutation = useMutation({
    mutationFn: async (payload: {
      request_id: string;
      decision: 'approve' | 'reject';
      decision_note?: string | null;
    }) => {
      const res = await fetch(buildPharmacyDrugStockRequestApiPath(payload.request_id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          decision: payload.decision,
          decision_note: payload.decision_note ?? null,
        }),
      });
      return readApiJson<{
        request: FormularyChangeRequestItem;
        stock: PharmacyDrugStockConfig | null;
      }>(res, '採用品変更申請の決裁に失敗しました');
    },
    onSuccess: async (result) => {
      toast.success(
        result.request.status === 'approved'
          ? '採用品変更申請を承認しました'
          : '採用品変更申請を却下しました',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks-impact'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用品変更申請の決裁に失敗しました'));
    },
  });

  const runBulkCsvMutation = async (dryRun: boolean) => {
    if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
    const res = await fetch(buildPharmacyDrugStockBulkApiPath(), {
      method: 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({
        site_id: effectiveSelectedSiteId,
        csv: bulkCsv,
        dry_run: dryRun,
      }),
    });
    return readApiJson<{
      importedCount: number;
      unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>;
      invalidRows: Array<{ rowNumber: number; reason: string }>;
      preview?: BulkPreviewResponse['preview'];
    }>(res, '採用薬リストの一括登録に失敗しました');
  };

  const bulkPreviewMutation = useMutation({
    mutationFn: async () => {
      // リクエスト発行時点の対象拠点・CSV を確定（onSuccess の stale 判定に使用）。
      const requestTargetSiteId = effectiveSelectedSiteId;
      const requestCsv = bulkCsv;
      const result = await runBulkCsvMutation(true);
      return { ...result, requestTargetSiteId, requestCsv };
    },
    onSuccess: (result) => {
      // 対象拠点や CSV が応答中に変わっていたら、古い拠点のプレビューを描画しない。
      if (
        result.requestTargetSiteId !== effectiveSelectedSiteIdRef.current ||
        result.requestCsv !== bulkCsvRef.current
      ) {
        return;
      }
      if (!result.preview) {
        setBulkPreview(null);
        setBulkPreviewExpanded(false);
        toast.warning('プレビュー結果が返りませんでした');
        return;
      }
      const previewResult: BulkPreviewResponse = {
        importedCount: result.importedCount,
        unmatchedRows: result.unmatchedRows,
        invalidRows: result.invalidRows,
        preview: result.preview,
      };
      setBulkPreview(previewResult);
      setBulkPreviewExpanded(false);
      const blockingCount =
        result.preview.summary.unmatchedCount + result.preview.summary.invalidCount;
      toast.success(
        blockingCount > 0
          ? `CSVを確認しました（要確認 ${blockingCount.toLocaleString()}件）`
          : `CSVを確認しました（反映対象 ${result.preview.summary.processableRows.toLocaleString()}件）`,
      );
    },
    onError: (error) => {
      setBulkPreview(null);
      setBulkPreviewExpanded(false);
      toast.error(messageFromError(error, '採用薬CSVの確認に失敗しました'));
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async () => {
      return runBulkCsvMutation(false);
    },
    onSuccess: async (result) => {
      toast.success(`採用薬を一括登録しました（${result.importedCount.toLocaleString()}件）`);
      if (result.unmatchedRows.length > 0) {
        toast.warning(`未照合の行があります（${result.unmatchedRows.length.toLocaleString()}件）`);
      }
      if (result.invalidRows.length > 0) {
        toast.warning(`無効な行があります（${result.invalidRows.length.toLocaleString()}件）`);
      }
      applyBulkCsv('');
      setBulkPreview(null);
      setBulkPreviewExpanded(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用薬リストの一括登録に失敗しました'));
    },
  });

  const copyFormularyMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      if (!copySourceSiteId) throw new Error('コピー元拠点を選択してください');
      if (!effectiveSelectedSiteId) throw new Error('コピー先拠点を選択してください');
      const requestTargetSiteId = effectiveSelectedSiteId;
      const requestSourceSiteId = copySourceSiteId;
      const requestOverwrite = copyOverwrite;
      const res = await fetch(buildPharmacyDrugStockCopyApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          source_site_id: copySourceSiteId,
          target_site_id: effectiveSelectedSiteId,
          overwrite: copyOverwrite,
          dry_run: dryRun,
        }),
      });
      const json = await readApiJson<FormularyCopyPreviewResponse>(
        res,
        '採用薬リストのコピーに失敗しました',
      );
      return {
        ...json,
        requestTargetSiteId,
        requestSourceSiteId,
        requestOverwrite,
      };
    },
    onSuccess: async (result) => {
      if (result.dryRun) {
        // コピー先/コピー元/上書き設定が応答中に変わっていたら、古いプレビューを描画しない。
        if (
          result.requestTargetSiteId !== effectiveSelectedSiteIdRef.current ||
          result.requestSourceSiteId !== copySourceSiteIdRef.current ||
          result.requestOverwrite !== overwriteRef.current
        ) {
          return;
        }
        setCopyPreview(result);
        toast.success(
          `コピー差分を確認しました（反映予定 ${result.preview.summary.apply_count.toLocaleString()}件）`,
        );
        return;
      }
      toast.success(
        `採用薬リストをコピーしました（反映 ${result.copiedCount.toLocaleString()}件 / スキップ ${result.skippedCount.toLocaleString()}件）`,
      );
      setCopyPreview(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks-impact'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用薬リストのコピーに失敗しました'));
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const name = templateName.trim();
      if (!name) throw new Error('テンプレート名を入力してください');
      const res = await fetch(buildPharmacyDrugStockTemplatesApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          name,
          source_site_id: effectiveSelectedSiteId,
        }),
      });
      return readApiJson<{ data: FormularyTemplateItem }>(
        res,
        '採用品テンプレートの作成に失敗しました',
      );
    },
    onSuccess: async () => {
      toast.success('採用品テンプレートを作成しました');
      setTemplateName('');
      setTemplatePreview(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-templates'] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用品テンプレートの作成に失敗しました'));
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      if (!selectedTemplateId) throw new Error('テンプレートを選択してください');
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const requestTargetSiteId = effectiveSelectedSiteId;
      const requestTemplateId = selectedTemplateId;
      const requestOverwrite = copyOverwrite;
      const res = await fetch(buildPharmacyDrugStockTemplateApplyApiPath(selectedTemplateId), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          target_site_id: effectiveSelectedSiteId,
          overwrite: copyOverwrite,
          dry_run: dryRun,
        }),
      });
      const json = await readApiJson<FormularyTemplatePreviewResponse>(
        res,
        '採用品テンプレートの適用に失敗しました',
      );
      return {
        ...json,
        requestTargetSiteId,
        requestTemplateId,
        requestOverwrite,
      };
    },
    onSuccess: async (result) => {
      if (result.dryRun) {
        // 対象拠点/選択テンプレート/上書き設定が応答中に変わっていたら、古いプレビューを描画しない。
        if (
          result.requestTargetSiteId !== effectiveSelectedSiteIdRef.current ||
          result.requestTemplateId !== selectedTemplateIdRef.current ||
          result.requestOverwrite !== overwriteRef.current
        ) {
          return;
        }
        setTemplatePreview(result);
        toast.success(
          `テンプレート差分を確認しました（反映予定 ${result.preview.summary.apply_count.toLocaleString()}件）`,
        );
        return;
      }
      toast.success(
        `採用品テンプレートを適用しました（反映 ${result.appliedCount.toLocaleString()}件 / スキップ ${result.skippedCount.toLocaleString()}件）`,
      );
      setTemplatePreview(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks-impact'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用品テンプレートの適用に失敗しました'));
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) throw new Error('テンプレートを選択してください');
      const res = await fetch(buildPharmacyDrugStockTemplateApiPath(selectedTemplateId), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ deleted: boolean; data: FormularyTemplateItem }>(
        res,
        '採用品テンプレートの削除に失敗しました',
      );
    },
    onSuccess: async () => {
      toast.success('採用品テンプレートを削除しました');
      applySelectedTemplateId('');
      setDeleteTemplateConfirmOpen(false);
      setTemplatePreview(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-templates'] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用品テンプレートの削除に失敗しました'));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const res = await fetch(buildPharmacyDrugStockReviewApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ site_id: effectiveSelectedSiteId }),
      });
      return readApiJson<{ reviewedCount: number }>(res, '採用薬レビューの記録に失敗しました');
    },
    onSuccess: async (result) => {
      toast.success(`採用薬レビューを記録しました（${result.reviewedCount.toLocaleString()}件）`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用薬レビューの記録に失敗しました'));
    },
  });

  const safetyFollowUpMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const res = await fetch(buildPharmacyDrugStockSafetyFollowUpApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          site_id: effectiveSelectedSiteId,
          queue: 'all',
          due_in_days: 30,
        }),
      });
      return readApiJson<{
        matchedCount: number;
        updatedCount: number;
        skippedUnresolvedCount: number;
      }>(res, '安全性フォローアップの作成に失敗しました');
    },
    onSuccess: async (result) => {
      toast.success(
        `安全性フォローアップを作成しました（${result.updatedCount.toLocaleString()}件）`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks-impact'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '安全性フォローアップの作成に失敗しました'));
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        purpose: exportPurpose,
      });
      const endpoint = toApiPath(buildPharmacyDrugStockExportApiPath(params));
      const descriptor = buildApprovedServerExportDescriptor(
        FORMULARY_EXPORT_SURFACE_BY_PURPOSE[exportPurpose],
        endpoint,
        { label: '対象拠点全件CSV出力' },
      );
      const descriptorProblem = getApprovedServerExportDescriptorProblem(descriptor);
      if (descriptorProblem) throw new Error(descriptorProblem);
      const res = await fetch(endpoint, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) {
        await readApiJson<never>(res, '採用薬CSVの出力に失敗しました');
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `formulary-${exportPurpose}-${effectiveSelectedSiteId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('採用薬CSVを出力しました');
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用薬CSVの出力に失敗しました'));
    },
  });

  const templateMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (effectiveSelectedSiteId) params.set('site_id', effectiveSelectedSiteId);
      const query = params.toString();
      const res = await fetch(buildPharmacyDrugStockTemplateCsvApiPath(query || undefined), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) {
        await readApiJson<never>(res, '採用薬CSVテンプレートの取得に失敗しました');
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = effectiveSelectedSiteId
        ? `formulary-template-${effectiveSelectedSiteId}.csv`
        : 'formulary-template.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('採用薬CSVテンプレートを取得しました');
    },
    onError: (error) => {
      toast.error(messageFromError(error, '採用薬CSVテンプレートの取得に失敗しました'));
    },
  });

  const tableColumns = useMemo<ColumnDef<DrugMasterRow>[]>(
    () => [
      ...baseColumns,
      {
        id: 'formulary_action',
        header: '採用品設定',
        cell: ({ row }) => {
          const stockConfig = row.original.stock_config;
          const isStocked = stockConfig?.is_stocked ?? false;
          return (
            <Button
              type="button"
              size="sm"
              variant={isStocked ? 'outline' : 'default'}
              disabled={!effectiveSelectedSiteId || stockMutation.isPending}
              className="min-h-[44px] gap-1 sm:min-h-[44px]"
              onClick={(event) => {
                event.stopPropagation();
                if (!effectiveSelectedSiteId) {
                  toast.error('先に対象拠点を選択してください');
                  return;
                }
                stockMutation.mutate({
                  site_id: effectiveSelectedSiteId,
                  drug_master_id: row.original.id,
                  is_stocked: !isStocked,
                  preferred_generic_id: isStocked
                    ? null
                    : (stockConfig?.preferred_generic_id ?? null),
                  reorder_point: isStocked ? null : (stockConfig?.reorder_point ?? null),
                });
              }}
            >
              {isStocked ? (
                <>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  解除
                </>
              ) : (
                '採用'
              )}
            </Button>
          );
        },
      },
    ],
    [effectiveSelectedSiteId, stockMutation],
  );

  const activeImport = IMPORT_ACTIONS.find((item) => item.key === importMutation.variables);
  const pendingImportDefinition = IMPORT_ACTIONS.find((item) => item.key === pendingImportAction);
  const pendingOfficialImportPreview =
    officialImportPreview?.action === pendingImportAction ? officialImportPreview.data : null;
  const pendingOfficialImportPreviewGroups = collectOfficialImportPreviewGroups(
    pendingOfficialImportPreview,
  );

  // 累積された全ページの行。selectedRowIndex / onRowClick はこの累積配列を基準に整合させる。
  const drugs = data?.pages.flatMap((page) => page.data) ?? [];
  const drugMasterTotalCount = data?.pages[0]?.totalCount;
  const sites = sitesData?.data ?? [];
  const formularyTemplates = formularyTemplatesQuery.data?.data ?? [];
  const selectedTemplate =
    formularyTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const { copySourceSites, headerTitle, headerDescription } = buildDrugMasterSiteHeaderViewModel({
    variant,
    effectiveSelectedSiteId,
    sites,
  });
  const importLogs = importLogsData?.data ?? [];
  const reviewDueStocks = formularyReviewQuery.data?.data ?? [];
  const missingReorderStocks = formularyMissingReorderQuery.data?.data ?? [];
  const formularyImpact = formularyImpactQuery.data;
  const formularyUsageMismatch = formularyUsageMismatchQuery.data;
  const pendingFormularyRequests = formularyRequestsQuery.data?.data ?? [];
  const formularyRequestSummary = formularyRequestsQuery.data?.summary;
  const formularyOps = buildFormularyOperationsViewModel({
    reviewDueStocks,
    missingReorderStocks,
    formularyImpact,
    formularyUsageMismatch,
    impactQueue,
    expiryReferenceTime,
  });
  const bulkPreviewVm = buildBulkPreviewViewModel({
    bulkPreview,
    bulkPreviewExpanded,
    effectiveSelectedSiteId,
    bulkCsv,
  });
  const latestPackageInsert = detailQuery.data?.package_inserts[0] ?? null;
  const stockConfig = stockConfigQuery.data?.data ?? null;
  const stockHistory = stockHistoryQuery.data?.data ?? [];
  const effectivePreferredGenericId = preferredGenericId ?? stockConfig?.preferred_generic_id ?? '';
  const { selectedRowIndex, selectedPendingRequest, relatedInteractions } =
    buildDrugMasterSelectionViewModel({
      drugs,
      selectedDrugId,
      pendingFormularyRequests,
      detail: detailQuery.data,
    });
  const preferredGenericCandidates = preferredGenericCandidatesQuery.data?.data ?? [];
  const selectedPreferredGenericLabel = (() => {
    if (effectivePreferredGenericId === '') {
      return '指定しない';
    }
    const match = preferredGenericCandidates.find((c) => c.id === effectivePreferredGenericId);
    if (match) {
      return `${match.drug_name} (${match.yj_code})`;
    }
    return stockConfig?.preferred_generic?.drug_name ?? '保存済みの採用後発薬を確認してください';
  })();
  const genericRecommendations = genericRecommendationsQuery.data?.data.recommendations ?? [];
  const ingredientGroup = ingredientGroupQuery.data ?? null;
  const drugSafetyDisplay = detailQuery.data
    ? buildDrugSafetyDisplayViewModel(detailQuery.data)
    : null;
  const headerShortcuts =
    variant === 'formulary' ? getAdminFormularyShortcutLinks() : getAdminDrugMasterShortcutLinks();

  const {
    staleSourceCount,
    agingSourceCount,
    selectedImportLogSourceLabel,
    selectedImportLogStatusLabel,
    selectedCategoryLabel,
    activeSafetyFilterCount,
  } = buildDrugMasterFilterViewModel({
    masterStatusSources: masterStatusData?.sources ?? [],
    importLogSourceOptions: IMPORT_LOG_SOURCE_OPTIONS,
    importLogStatusOptions: IMPORT_LOG_STATUS_OPTIONS,
    categoryOptions: CATEGORY_OPTIONS,
    importLogSourceFilter,
    importLogStatusFilter,
    category,
    safetyFilters: [genericOnly, narcoticOnly, highRiskOnly, lasaOnly, stockedOnly],
  });
  const copyCandidateYjCode = async (yjCode: string) => {
    try {
      await copyTextToClipboard(yjCode);
      toast.success('YJコードをコピーしました');
    } catch {
      toast.error(CLIPBOARD_COPY_ERROR_MESSAGE);
    }
  };
  return (
    <PageScaffold>
      <div className="space-y-4">
        <AdminPageHeader
          title={headerTitle}
          description={headerDescription}
          shortcuts={headerShortcuts}
          supportingContent={null}
        />
      </div>

      {variant === 'formulary' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              採用薬リスト運用
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormularyOperationsPanel
              formularyOps={formularyOps}
              bulkPreviewVm={bulkPreviewVm}
              formularyReviewQuery={formularyReviewQuery}
              formularyMissingReorderQuery={formularyMissingReorderQuery}
              formularyImpactQuery={formularyImpactQuery}
              formularyUsageMismatchQuery={formularyUsageMismatchQuery}
              formularyRequestsQuery={formularyRequestsQuery}
              formularyTemplatesQuery={formularyTemplatesQuery}
              pendingFormularyRequests={pendingFormularyRequests}
              formularyRequestSummary={formularyRequestSummary}
              formularyUsageMismatch={formularyUsageMismatch}
              sites={sites}
              copySourceSites={copySourceSites}
              formularyTemplates={formularyTemplates}
              selectedTemplate={selectedTemplate}
              copySourceSiteId={copySourceSiteId}
              copyOverwrite={copyOverwrite}
              copyPreview={copyPreview}
              templateName={templateName}
              templateSearchQuery={templateSearchQuery}
              selectedTemplateId={selectedTemplateId}
              templatePreview={templatePreview}
              bulkCsv={bulkCsv}
              exportPurpose={exportPurpose}
              bulkPreviewExpanded={bulkPreviewExpanded}
              stockRequestDecisionMutation={stockRequestDecisionMutation}
              safetyFollowUpMutation={safetyFollowUpMutation}
              copyFormularyMutation={copyFormularyMutation}
              createTemplateMutation={createTemplateMutation}
              applyTemplateMutation={applyTemplateMutation}
              deleteTemplateMutation={deleteTemplateMutation}
              bulkPreviewMutation={bulkPreviewMutation}
              bulkImportMutation={bulkImportMutation}
              templateMutation={templateMutation}
              exportMutation={exportMutation}
              reviewMutation={reviewMutation}
              copySourceSiteIdRef={copySourceSiteIdRef}
              overwriteRef={overwriteRef}
              effectiveSelectedSiteId={effectiveSelectedSiteId}
              setImpactQueue={setImpactQueue}
              openDrugDetail={openDrugDetail}
              setFormularyRequestDecisionTarget={setFormularyRequestDecisionTarget}
              setCopySourceSiteId={setCopySourceSiteId}
              setCopyOverwrite={setCopyOverwrite}
              setCopyPreview={setCopyPreview}
              setTemplateName={setTemplateName}
              setTemplateSearchQuery={setTemplateSearchQuery}
              applySelectedTemplateId={applySelectedTemplateId}
              setTemplatePreview={setTemplatePreview}
              setDeleteTemplateConfirmOpen={setDeleteTemplateConfirmOpen}
              applyBulkCsv={applyBulkCsv}
              setBulkPreview={setBulkPreview}
              setBulkPreviewExpanded={setBulkPreviewExpanded}
              setExportPurpose={setExportPurpose}
              copyCandidateYjCode={copyCandidateYjCode}
            />
          </CardContent>
        </Card>
      )}

      <PageSection
        title="検索・フィルタ"
        description="一覧に表示する医薬品を名称、薬効分類、安全性属性、採用品状態で絞り込みます。"
      >
        <div className="space-y-3">
          <FilterSummaryBar
            items={[
              { label: '検索:', value: searchQuery.trim() || 'なし' },
              { label: '薬効分類:', value: selectedCategoryLabel },
              { label: '有効フィルタ:', value: `${activeSafetyFilterCount}件` },
              { label: '採用品:', value: stockedOnly ? '採用品のみ' : '条件なし' },
            ]}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="医薬品名・カナ・YJコード・一般名で検索"
                className="h-11 min-h-[44px] w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
                aria-label="医薬品検索"
              />
            </div>
            <Select value={category} onValueChange={(value) => setCategory(value ?? category)}>
              <SelectTrigger
                aria-label="薬効分類フィルタ"
                className="min-h-[44px] min-w-[160px] sm:min-h-[44px]"
              >
                <SelectValue>{selectedCategoryLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="min-h-[44px]">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="relative flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-sm focus-within:ring-2 focus-within:ring-ring">
              <input
                type="checkbox"
                checked={genericOnly}
                onChange={(e) => setGenericOnly(e.target.checked)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded border ${genericOnly ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              />
              後発品のみ
            </label>
            <label className="relative flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-sm focus-within:ring-2 focus-within:ring-ring">
              <input
                type="checkbox"
                checked={narcoticOnly}
                onChange={(e) => setNarcoticOnly(e.target.checked)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded border ${narcoticOnly ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              />
              麻薬のみ
            </label>
            <label className="relative flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-sm focus-within:ring-2 focus-within:ring-ring">
              <input
                type="checkbox"
                checked={highRiskOnly}
                onChange={(e) => setHighRiskOnly(e.target.checked)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded border ${highRiskOnly ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              />
              ハイリスク薬のみ
            </label>
            <label className="relative flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-sm focus-within:ring-2 focus-within:ring-ring">
              <input
                type="checkbox"
                checked={lasaOnly}
                onChange={(e) => setLasaOnly(e.target.checked)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded border ${lasaOnly ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              />
              LASA注意のみ
            </label>
            <label className="relative flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-sm focus-within:ring-2 focus-within:ring-ring">
              <input
                type="checkbox"
                checked={stockedOnly}
                onChange={(e) => setStockedOnly(e.target.checked)}
                className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                disabled={!effectiveSelectedSiteId}
              />
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded border ${stockedOnly ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              />
              採用品のみ
            </label>
          </div>
        </div>
      </PageSection>

      <DataTable
        columns={tableColumns}
        data={drugs}
        isLoading={isLoading || isFetchingMoreDrugMasters}
        hasMore={hasMoreDrugMasters}
        onLoadMore={() => void fetchNextDrugMasters()}
        caption="医薬品マスター一覧"
        onRowClick={(index) => openDrugDetail(drugs[index]?.id ?? null)}
        selectedRowIndex={selectedRowIndex}
        errorMessage={
          isDrugMasterError
            ? drugMasterError instanceof Error
              ? drugMasterError.message
              : '医薬品マスターの取得に失敗しました'
            : undefined
        }
        onRetry={() => void refetchDrugMasters()}
      />

      <PageSection
        title="更新と対象拠点"
        description="マスター取込、採用品設定の拠点、表示対象をここで固定できます。"
        tone="subtle"
        actions={
          <ActionRail>
            {IMPORT_ACTIONS.map((action) => (
              <LoadingButton
                key={action.key}
                type="button"
                size="sm"
                loading={importMutation.isPending && importMutation.variables === action.key}
                loadingLabel={action.loadingLabel}
                onClick={() => openImportConfirmation(action.key)}
                className="min-h-[44px] gap-1 sm:min-h-[44px]"
              >
                <Download className="size-3.5" aria-hidden="true" />
                {action.label}
              </LoadingButton>
            ))}
          </ActionRail>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
          <div className="space-y-3">
            <FilterSummaryBar
              items={[
                {
                  label: '登録件数',
                  value:
                    drugMasterTotalCount !== undefined
                      ? `${drugMasterTotalCount.toLocaleString()}件`
                      : '読込中',
                },
                {
                  label: '対象拠点',
                  value:
                    sites.find((site) => site.id === effectiveSelectedSiteId)?.name ?? '未選択',
                  tone: effectiveSelectedSiteId ? 'default' : 'warning',
                },
                {
                  label: '表示対象',
                  value: stockedOnly ? '採用品のみ' : '全件',
                },
                ...(activeImport && importMutation.isPending
                  ? [{ label: '実行中', value: activeImport.label, tone: 'warning' as const }]
                  : []),
              ]}
            />
            <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
              <p className="text-sm text-muted-foreground">
                HOTコードマスターおよびPMDA添付文書の連携が未設定の場合は、システム管理者に連絡してください。
                PMDA添付文書の取得にはメディナビ/マイ医薬品集の登録が必要です。
              </p>
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground/70 hover:text-muted-foreground">
                  技術詳細を表示
                </summary>
                <p className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                  HOT: <code>HOT_MASTER_URL</code> または明示 URL
                  <br />
                  PMDA: <code>PMDA_PACKAGE_INSERT_FULL_URL</code> /{' '}
                  <code>PMDA_PACKAGE_INSERT_DELTA_URL</code>
                </p>
              </details>
            </div>
          </div>
          <div className="space-y-1">
            <span
              id="drug-master-target-site-label"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
            >
              <Building2 className="size-3.5" aria-hidden="true" />
              採用品設定の対象拠点
            </span>
            <Select
              value={effectiveSelectedSiteId}
              onValueChange={(value) => {
                const next = value ?? '';
                // P1 race guard: 同期的に最新コンテキストを ref へ反映（effect flush を待たない）。
                effectiveSelectedSiteIdRef.current = next || sitesData?.data?.[0]?.id || '';
                copySourceSiteIdRef.current = '';
                setSelectedSiteId(next);
                setPreferredGenericId(null);
                setCopySourceSiteId('');
                setCopyPreview(null);
                setTemplatePreview(null);
                setBulkPreview(null);
                setBulkPreviewExpanded(false);
              }}
            >
              <SelectTrigger
                id="drug-master-target-site"
                aria-labelledby="drug-master-target-site-label"
                className="min-h-[44px] w-full sm:min-h-[44px]"
              >
                <SelectValue placeholder="拠点を選択" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id} className="min-h-[44px]">
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSitesError ? (
              <div className="mt-2">
                <ErrorState
                  variant="server"
                  size="inline"
                  title="拠点一覧を読み込めませんでした"
                  description="「拠点が未登録」ではなく取得エラーです。対象拠点を選べないため、再読み込みしてください。"
                  onRetry={() => void refetchSites()}
                  retryLabel="再読み込み"
                />
              </div>
            ) : null}
            <label className="relative mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:min-h-[44px]">
              <input
                type="checkbox"
                checked={stockedOnly}
                onChange={(event) => setStockedOnly(event.target.checked)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded border ${
                  stockedOnly ? 'border-primary bg-primary' : 'border-input bg-background'
                }`}
              />
              採用品のみ表示
            </label>
          </div>
        </div>
      </PageSection>

      {isMasterStatusError ? (
        // 取得失敗時に section ごと消すと「ステータス未取得」と「データなし」が区別できない。
        <PageSection
          title="マスター更新ステータス"
          description="医薬品マスター、添付文書、相互作用、アラートルールの鮮度を確認します。"
        >
          <ErrorState
            variant="server"
            size="inline"
            title="マスター更新ステータスを読み込めませんでした"
            description="鮮度や取込件数を表示できていません。時間をおいて再読み込みしてください。"
            onRetry={() => void refetchMasterStatus()}
            retryLabel="再読み込み"
          />
        </PageSection>
      ) : null}
      {masterStatusData && (
        <PageSection
          title="マスター更新ステータス"
          description="医薬品マスター、添付文書、相互作用、アラートルールの鮮度を確認します。"
          actions={
            <LoadingButton
              type="button"
              size="sm"
              variant="outline"
              loading={freshnessCheckMutation.isPending}
              loadingLabel="確認中"
              onClick={() => freshnessCheckMutation.mutate()}
              className="min-h-[44px] sm:min-h-[44px]"
            >
              鮮度チェック
            </LoadingButton>
          }
        >
          <div className="space-y-3">
            <FilterSummaryBar
              items={[
                {
                  label: '総品目:',
                  value: `${masterStatusData.totals.drug_master_count.toLocaleString()}件`,
                },
                {
                  label: '包装GTIN:',
                  value: `${masterStatusData.totals.drug_package_count.toLocaleString()}件 / ${masterStatusData.totals.drug_package_coverage}%`,
                },
                {
                  label: '添付文書:',
                  value: `${masterStatusData.totals.package_insert_count.toLocaleString()}件`,
                },
                {
                  label: '相互作用:',
                  value: `${masterStatusData.totals.interaction_count.toLocaleString()}件`,
                },
                {
                  label: 'アラートルール:',
                  value: `${masterStatusData.totals.active_alert_rule_count}件`,
                },
              ]}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={staleSourceCount > 0 ? 'destructive' : 'outline'}>
                  要更新 {staleSourceCount}件
                </Badge>
                <Badge variant={agingSourceCount > 0 ? 'secondary' : 'outline'}>
                  更新推奨 {agingSourceCount}件
                </Badge>
              </div>
            </div>
            {masterStatusData.sources.map((source) => {
              const lastSuccessSummary = source.last_success
                ? formatImportChangeSummary(source.last_success.change_summary)
                : null;
              const hasLastSuccessProvenance = Boolean(
                source.last_success &&
                (source.last_success.source_file_hash ||
                  source.last_success.source_published_at ||
                  source.last_success.import_mode ||
                  lastSuccessSummary),
              );

              return (
                <div
                  key={source.source}
                  className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{source.label}</span>
                      <Badge variant="outline" className="text-xs">
                        {source.is_free ? '標準取込' : '外部設定'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {source.last_success
                        ? `最終取込: ${new Date(source.last_success.imported_at).toLocaleDateString('ja-JP')} (${source.last_success.days_ago}日前) ・ ${source.last_success.record_count.toLocaleString()}件`
                        : '未取込'}
                      {source.last_failure
                        ? ` / 直近失敗: ${source.last_failure.error ?? '詳細なし'}`
                        : ''}
                    </div>
                    {source.last_success && hasLastSuccessProvenance && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {source.last_success.source_file_hash && (
                          <span>
                            sha256: {formatImportSourceHash(source.last_success.source_file_hash)}
                          </span>
                        )}
                        {source.last_success.source_published_at && (
                          <span>
                            published:{' '}
                            {formatImportPublishedAt(source.last_success.source_published_at)}
                          </span>
                        )}
                        {source.last_success.import_mode && (
                          <span>mode: {formatImportMode(source.last_success.import_mode)}</span>
                        )}
                        {lastSuccessSummary && <span>summary: {lastSuccessSummary}</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {source.recent_runs_30d.total > 0
                          ? `直近30日: ${source.recent_runs_30d.total}回 / 失敗 ${source.recent_runs_30d.failed}回`
                          : '直近30日の実行なし'}
                      </span>
                      {source.recent_runs_30d.latest_status && (
                        <Badge variant="outline" className="text-xs">
                          最新実行 {formatImportStatusLabel(source.recent_runs_30d.latest_status)}
                        </Badge>
                      )}
                      {source.recent_runs_30d.failure_streak > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          連続失敗 {source.recent_runs_30d.failure_streak}回
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={
                      source.freshness === 'fresh'
                        ? 'outline'
                        : source.freshness === 'aging'
                          ? 'secondary'
                          : source.freshness === 'stale'
                            ? 'destructive'
                            : 'destructive'
                    }
                    className="text-xs"
                  >
                    {source.freshness === 'fresh'
                      ? '最新'
                      : source.freshness === 'aging'
                        ? '更新推奨'
                        : source.freshness === 'stale'
                          ? '要更新'
                          : '未取込'}
                  </Badge>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-[44px] w-full sm:min-h-[44px]"
              disabled={importMutation.isPending || autoRefreshMutation.isPending}
              onClick={() => setAutoRefreshConfirmOpen(true)}
            >
              {autoRefreshMutation.isPending
                ? 'フリーマスター一括更新中…'
                : 'フリーマスター一括更新（SSK→MHLW）'}
            </Button>
          </div>
        </PageSection>
      )}

      <PageSection
        title="取込履歴"
        description="取込ソースと実行状態を絞り込み、直近のマスター更新結果を確認します。"
      >
        <div
          className="space-y-3"
          data-ready={!isLoadingLogs}
          data-testid="drug-master-import-history"
        >
          <FilterSummaryBar
            items={[
              {
                label: '表示:',
                // 取得失敗時は importLogs=[] による false-zero(0件)を出さず「取得失敗」と明示する。
                value: isImportLogsError ? '取得失敗' : `${importLogs.length.toLocaleString()}件`,
              },
              { label: 'ソース:', value: selectedImportLogSourceLabel },
              { label: '状態:', value: selectedImportLogStatusLabel },
            ]}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">ソース</span>
              <Select
                value={importLogSourceFilter}
                onValueChange={(value) =>
                  setImportLogSourceFilter(
                    (value ?? importLogSourceFilter) as 'all' | DrugMasterImportLog['source'],
                  )
                }
              >
                <SelectTrigger
                  aria-label="取込履歴ソース"
                  className="min-h-[44px] w-full sm:min-h-[44px]"
                >
                  <SelectValue>{selectedImportLogSourceLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_LOG_SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="min-h-[44px]">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">状態</span>
              <Select
                value={importLogStatusFilter}
                onValueChange={(value) =>
                  setImportLogStatusFilter(
                    (value ?? importLogStatusFilter) as 'all' | DrugMasterImportLog['status'],
                  )
                }
              >
                <SelectTrigger
                  aria-label="取込履歴状態"
                  className="min-h-[44px] w-full sm:min-h-[44px]"
                >
                  <SelectValue>{selectedImportLogStatusLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_LOG_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="min-h-[44px]">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {isLoadingLogs ? (
            <div role="status" aria-label="取込履歴を読み込み中" aria-live="polite">
              <SkeletonRows rows={3} cols={3} status={false} />
            </div>
          ) : isImportLogsError ? (
            // 監査文脈: 取得失敗を「履歴なし」に潰すと取込が無かったと誤読される。
            <ErrorState
              variant="server"
              size="inline"
              title="取込履歴を読み込めませんでした"
              description="「取込履歴なし」ではなく取得エラーです。監査確認のため再読み込みしてください。"
              onRetry={() => void refetchImportLogs()}
              retryLabel="再読み込み"
            />
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
                      className="text-xs"
                    >
                      {formatImportStatusLabel(log.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.imported_at).toLocaleString('ja-JP')} ・{' '}
                    {log.record_count.toLocaleString()}件
                  </div>
                  {Boolean(
                    log.source_published_at ||
                    log.import_mode ||
                    formatImportChangeSummary(log.change_summary),
                  ) && (
                    <div className="flex max-w-full flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {log.source_published_at && (
                        <span>published: {formatImportPublishedAt(log.source_published_at)}</span>
                      )}
                      {log.import_mode && <span>mode: {formatImportMode(log.import_mode)}</span>}
                      {formatImportChangeSummary(log.change_summary) && (
                        <span>summary: {formatImportChangeSummary(log.change_summary)}</span>
                      )}
                    </div>
                  )}
                  {(log.source_url || log.source_file_hash) && (
                    <div className="flex max-w-full flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {log.source_url && (
                        <span className="max-w-full truncate" title={log.source_url}>
                          source: {formatImportSourceUrl(log.source_url)}
                        </span>
                      )}
                      {log.source_file_hash && (
                        <span className="font-mono" title={log.source_file_hash}>
                          sha256: {formatImportSourceHash(log.source_file_hash)}
                        </span>
                      )}
                    </div>
                  )}
                  {log.error_log && (
                    <div className="text-xs text-state-blocked">{log.error_log}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </PageSection>

      <ConfirmDialog
        open={pendingImportAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingImportAction(null);
            setOfficialImportPreview(null);
            setOfficialImportPreviewError(null);
          }
        }}
        title={`${pendingImportDefinition?.label ?? 'マスター取込'}を実行しますか`}
        description="公式マスター取込は薬剤コード、安全情報、採用品プレビューの前提を更新します。取込ソースと実行内容を確認してから実行してください。"
        confirmLabel={importMutation.isPending ? '取込中...' : '取込実行'}
        cancelLabel="戻る"
        requiredConfirmText="取込実行"
        confirmDisabled={!pendingImportAction || importMutation.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (!pendingImportAction) return;
          importMutation.mutate(pendingImportAction);
          setPendingImportAction(null);
          setOfficialImportPreview(null);
          setOfficialImportPreviewError(null);
        }}
      >
        {pendingImportDefinition ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <LoadingButton
                type="button"
                size="sm"
                variant="outline"
                loading={officialImportPreviewLoadingAction === pendingImportDefinition.key}
                loadingLabel="確認中"
                onClick={() => void runOfficialImportPreview(pendingImportDefinition.key)}
                className="min-h-[44px] gap-1 sm:min-h-[44px]"
              >
                <ListChecks className="size-3.5" aria-hidden="true" />
                差分確認
              </LoadingButton>
              {pendingOfficialImportPreview?.sourceFileHash ? (
                <span className="font-mono text-xs text-muted-foreground">
                  sha256: {formatImportSourceHash(pendingOfficialImportPreview.sourceFileHash)}
                </span>
              ) : null}
            </div>
            {officialImportPreviewError ? (
              <p role="alert" className="text-sm text-state-blocked">
                {officialImportPreviewError}
              </p>
            ) : null}
            {pendingOfficialImportPreviewGroups.length > 0 ? (
              <div
                className="space-y-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3"
                data-testid="official-import-preview"
              >
                {pendingOfficialImportPreviewGroups.map((group) => (
                  <div
                    key={group.key}
                    className="grid gap-1 border-b border-border/50 pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[120px_minmax(0,1fr)]"
                  >
                    <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
                    <span className="text-sm text-foreground">
                      {formatOfficialImportPreviewSummary(group.summary)}
                    </span>
                    {group.rows.length > 0 ? (
                      <ul className="space-y-1 sm:col-start-2">
                        {group.rows.slice(0, 3).map((row, index) => (
                          <li
                            key={`${group.key}-${index}`}
                            className="rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground"
                          >
                            {formatOfficialImportPreviewRow(row)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={autoRefreshConfirmOpen}
        onOpenChange={setAutoRefreshConfirmOpen}
        title="フリーマスター一括更新を実行しますか"
        description="SSKと厚労省系の標準マスターをまとめて更新します。取込後は採用品コピー、テンプレート、CSV反映の既存プレビューを破棄します。"
        confirmLabel={autoRefreshMutation.isPending ? '一括更新中...' : '一括更新'}
        cancelLabel="戻る"
        requiredConfirmText="一括更新"
        confirmDisabled={autoRefreshMutation.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          autoRefreshMutation.mutate();
          setAutoRefreshConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={formularyRequestDecisionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormularyRequestDecisionTarget(null);
        }}
        title={
          formularyRequestDecisionTarget?.decision === 'reject'
            ? '採用品変更申請を却下します'
            : '採用品変更申請を承認します'
        }
        description={
          formularyRequestDecisionTarget
            ? formatFormularyRequestDecisionDescription(formularyRequestDecisionTarget)
            : ''
        }
        confirmLabel={formularyRequestDecisionTarget?.decision === 'reject' ? '却下' : '承認'}
        cancelLabel="戻る"
        variant={formularyRequestDecisionTarget?.decision === 'reject' ? 'destructive' : 'default'}
        requiredConfirmText={
          formularyRequestDecisionTarget?.decision === 'reject' ? '却下' : undefined
        }
        onConfirm={() => {
          if (!formularyRequestDecisionTarget) return;
          stockRequestDecisionMutation.mutate({
            request_id: formularyRequestDecisionTarget.request.id,
            decision: formularyRequestDecisionTarget.decision,
            decision_note:
              formularyRequestDecisionTarget.decision === 'reject'
                ? '申請内容を確認して却下'
                : null,
          });
        }}
      />

      <ConfirmDialog
        open={deleteTemplateConfirmOpen}
        onOpenChange={setDeleteTemplateConfirmOpen}
        title="採用品テンプレートを削除しますか"
        description={`${formatFormularyTemplateSummary(
          selectedTemplate,
        )} を削除します。この操作は取り消せません。拠点への適用やコピー前にテンプレート内容を確認してください。`}
        confirmLabel={deleteTemplateMutation.isPending ? '削除中...' : '削除する'}
        confirmDisabled={!selectedTemplateId || deleteTemplateMutation.isPending}
        closeOnConfirm={false}
        variant="destructive"
        onConfirm={() => {
          if (!selectedTemplateId) return;
          deleteTemplateMutation.mutate();
        }}
      />

      <DrugMasterDetailSheet
        selectedDrugId={selectedDrugId}
        openDrugDetail={openDrugDetail}
        detailQuery={detailQuery}
        effectiveSelectedSiteId={effectiveSelectedSiteId}
        sites={sites}
        stockConfig={stockConfig}
        stockConfigQuery={stockConfigQuery}
        selectedPendingRequest={selectedPendingRequest}
        stockMutation={stockMutation}
        stockRequestMutation={stockRequestMutation}
        effectivePreferredGenericId={effectivePreferredGenericId}
        setPreferredGenericId={setPreferredGenericId}
        selectedPreferredGenericLabel={selectedPreferredGenericLabel}
        preferredGenericCandidates={preferredGenericCandidates}
        preferredGenericCandidatesQuery={preferredGenericCandidatesQuery}
        genericRecommendations={genericRecommendations}
        genericRecommendationsQuery={genericRecommendationsQuery}
        reorderPointInputRef={reorderPointInputRef}
        reorderPointError={reorderPointError}
        setReorderPointError={setReorderPointError}
        ingredientGroup={ingredientGroup}
        ingredientGroupQuery={ingredientGroupQuery}
        stockHistory={stockHistory}
        stockHistoryQuery={stockHistoryQuery}
        drugSafetyDisplay={drugSafetyDisplay}
        latestPackageInsert={latestPackageInsert}
        relatedInteractions={relatedInteractions}
      />
    </PageScaffold>
  );
}

export function DrugMasterContent({ variant = 'master' }: DrugMasterContentProps) {
  return <DrugMasterOperationalContent variant={variant} />;
}
