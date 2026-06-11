'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Search,
  Pill,
  AlertTriangle,
  Shield,
  Download,
  Upload,
  History,
  CheckCircle2,
  Building2,
  ClipboardCheck,
  Copy,
  ListChecks,
  FileWarning,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
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
import { PageScaffold } from '@/components/layout/page-scaffold';
import type { DrugMasterImportStatusResponse } from '@/app/api/drug-master-imports/status/route';
import {
  buildBulkPreviewViewModel,
  buildDrugMasterFilterViewModel,
  buildDrugMasterSelectionViewModel,
  buildDrugMasterSiteHeaderViewModel,
  buildFormularyOperationsViewModel,
  formatBulkPreviewStatusLabel,
  formatFormularyRequestActionLabel,
  formatImportStatusLabel,
  formatMasterChangeTypeLabel,
  formatStockHistoryActionLabel,
  type ImpactQueueKey,
} from './drug-master-formulary-view-model';

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
  is_high_risk: boolean;
  outpatient_injection_eligible: boolean;
  outpatient_injection_note: string | null;
  is_lasa_risk: boolean;
  tall_man_name: string | null;
  lasa_group_key: string | null;
  max_administration_days: number | null;
  stock_config: PharmacyDrugStockConfig | null;
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
type FormularyExportPurpose = 'operations' | 'audit' | 'posting' | 'pharmacist_review';

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

type GenericRecommendation = GenericCandidateOption & {
  generic_name: string | null;
  drug_price: number | null;
  unit: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  transitional_expiry_date: string | null;
  price_delta: number | null;
  price_delta_percent: number | null;
  site_stock: {
    drug_master_id: string;
    is_stocked: boolean;
    preferred_generic_id: string | null;
    reorder_point: number | null;
  } | null;
};

type IngredientGroupResponse = {
  site: Pick<PharmacySiteOption, 'id' | 'name'> | null;
  target: Pick<
    DrugMasterRow,
    'id' | 'yj_code' | 'drug_name' | 'generic_name' | 'drug_price' | 'unit' | 'is_generic'
  >;
  generic_name: string | null;
  summary: {
    member_count: number;
    brand_count: number;
    generic_count: number;
    stocked_count: number;
    unstocked_count: number | null;
    lowest_price: number | null;
    highest_price: number | null;
  } | null;
  members: Array<
    Pick<
      DrugMasterRow,
      | 'id'
      | 'yj_code'
      | 'drug_name'
      | 'generic_name'
      | 'drug_price'
      | 'unit'
      | 'manufacturer'
      | 'is_generic'
    > & {
      transitional_expiry_date: string | null;
      site_stock: {
        drug_master_id: string;
        is_stocked: boolean;
        preferred_generic_id: string | null;
        reorder_point: number | null;
        follow_up_status: string | null;
      } | null;
    }
  >;
  reason?: 'generic_name_missing';
};

type PharmacyDrugStockConfig = {
  id: string;
  site_id: string;
  drug_master_id: string;
  is_stocked: boolean;
  stock_qty: number | null;
  reorder_point: number | null;
  preferred_generic_id: string | null;
  adoption_source: string | null;
  adoption_note: string | null;
  last_reviewed_at: string | null;
  reviewed_by_id: string | null;
  follow_up_status: string | null;
  follow_up_reason: string | null;
  follow_up_due_date: string | null;
  follow_up_resolved_at: string | null;
  updated_at: string;
  preferred_generic: PreferredGenericSummary | null;
};

type FormularyStockSummaryRow = PharmacyDrugStockConfig & {
  drug_master: {
    id: string;
    drug_name: string;
    yj_code: string;
    drug_price: number | null;
    unit: string | null;
    is_generic: boolean;
    is_narcotic: boolean;
    is_psychotropic: boolean;
    is_high_risk: boolean;
    is_lasa_risk: boolean;
    transitional_expiry_date: string | null;
  };
};

type FormularyRecentChange = {
  id: string;
  yj_code: string;
  change_type: string;
  previous_value: unknown;
  current_value: unknown;
  created_at: string;
};

type FormularyImpactResponse = {
  recent_changes: FormularyRecentChange[];
  totals: {
    stocked_count: number;
    review_due_count: number;
    missing_reorder_point_count: number;
    safety_flagged_count: number;
    high_risk_count: number;
    lasa_risk_count: number;
    controlled_count: number;
    transitional_expiry_count: number;
    transitional_expiry_within_30_count: number;
    transitional_expiry_within_60_count: number;
    transitional_expiry_within_90_count: number;
    action_required_count: number;
    recent_master_change_count: number;
  };
  selected_queue: {
    key: ImpactQueueKey;
    rows: FormularyStockSummaryRow[];
    total_count: number;
  };
  master_change_report?: {
    cutoff: string;
    total_count: number;
    sampled_count: number;
    is_truncated: boolean;
    change_type_counts: Array<{ change_type: string; count: number }>;
    rows: Array<{
      stock: FormularyStockSummaryRow;
      changes: FormularyRecentChange[];
    }>;
    price_impact?: {
      usage_window_days: number;
      scanned_draft_count: number;
      estimated_total_delta: number;
      rows: Array<{
        stock: FormularyStockSummaryRow;
        previous_price: number | null;
        current_price: number | null;
        unit_price_delta: number | null;
        usage_count: number;
        estimated_total_delta: number | null;
      }>;
    };
  };
  follow_up_summary?: {
    unresolved_count: number;
    overdue_count: number;
    missing_due_date_count: number;
  };
  samples: {
    review_due: FormularyStockSummaryRow[];
    missing_reorder_point: FormularyStockSummaryRow[];
    safety_flagged: FormularyStockSummaryRow[];
    high_risk: FormularyStockSummaryRow[];
    lasa_risk: FormularyStockSummaryRow[];
    controlled: FormularyStockSummaryRow[];
    transitional_expiry: FormularyStockSummaryRow[];
    action_required: FormularyStockSummaryRow[];
    recently_changed: FormularyStockSummaryRow[];
  };
};

type FormularyUsageMismatchResponse = {
  period: {
    since: string;
    until: string;
  };
  thresholds: {
    days: number;
    frequent_threshold: number;
    draft_limit: number;
    limit: number;
  };
  totals: {
    scanned_draft_count: number;
    used_drug_count: number;
    medication_line_count: number;
    matched_drug_count: number;
    unmatched_drug_count: number;
    stocked_count: number;
    frequent_unstocked_count: number;
    unused_stocked_count: number;
    displayed_frequent_unstocked_count: number;
    displayed_unused_stocked_count: number;
  };
  frequent_unstocked: Array<{
    drug_code: string | null;
    drug_name: string | null;
    count: number;
    last_seen_at: string;
    matched_drug: Pick<
      DrugMasterRow,
      'id' | 'yj_code' | 'drug_name' | 'generic_name' | 'drug_price' | 'unit' | 'is_generic'
    > | null;
  }>;
  unused_stocked: Array<
    Pick<PharmacyDrugStockConfig, 'id' | 'drug_master_id' | 'reorder_point' | 'updated_at'> & {
      drug_master: Pick<
        DrugMasterRow,
        'id' | 'yj_code' | 'drug_name' | 'generic_name' | 'drug_price' | 'unit' | 'is_generic'
      >;
    }
  >;
  unmatched_prescribed: Array<{
    drug_code: string | null;
    drug_name: string | null;
    count: number;
    last_seen_at: string;
  }>;
};

type BulkPreviewResponse = {
  importedCount: number;
  unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>;
  invalidRows: Array<{
    rowNumber: number;
    reason: string;
    candidates?: Array<{
      id: string;
      yj_code: string;
      drug_name: string;
      generic_name: string | null;
    }>;
  }>;
  preview: {
    summary: {
      totalRows: number;
      processableRows: number;
      createCount: number;
      updateCount: number;
      deactivateCount: number;
      noChangeCount: number;
      unmatchedCount: number;
      invalidCount: number;
    };
    rows: Array<{
      rowNumber: number;
      status: 'create' | 'update' | 'deactivate' | 'no_change' | 'unmatched' | 'invalid';
      yj_code?: string;
      drug_name?: string;
      reason?: string;
      candidates?: Array<{
        id: string;
        yj_code: string;
        drug_name: string;
        generic_name: string | null;
      }>;
    }>;
  };
};

type FormularyCopyPreviewResponse = {
  sourceCount: number;
  copiedCount: number;
  skippedCount: number;
  overwrite: boolean;
  dryRun: boolean;
  preview: {
    summary: {
      source_count: number;
      create_count: number;
      update_count: number;
      skip_existing_count: number;
      apply_count: number;
    };
    rows: Array<{
      action: 'create' | 'update' | 'skip_existing';
      drug_master_id: string;
      reorder_point: number | null;
      preferred_generic_id: string | null;
      drug_master: {
        id: string;
        yj_code: string;
        drug_name: string;
      };
    }>;
  };
};

type FormularyTemplatePreviewResponse = {
  itemCount: number;
  appliedCount: number;
  skippedCount: number;
  overwrite: boolean;
  dryRun: boolean;
  preview: {
    summary: {
      item_count: number;
      create_count: number;
      update_count: number;
      skip_existing_count: number;
      apply_count: number;
    };
    rows: Array<{
      action: 'create' | 'update' | 'skip_existing';
      drug_master_id: string;
      reorder_point: number | null;
      preferred_generic_id: string | null;
      drug_master: {
        id: string;
        yj_code: string;
        drug_name: string;
      };
    }>;
  };
};

type FormularyTemplateItem = {
  id: string;
  name: string;
  description: string | null;
  source_site_id: string | null;
  item_count: number;
  created_at: string;
};

type PharmacyDrugStockHistoryItem = {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  changes: unknown;
  created_at: string;
};

function readAuditObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type FormularyChangeRequestItem = {
  id: string;
  site_id: string;
  drug_master_id: string;
  status: 'pending' | 'approved' | 'rejected';
  action_type: string;
  requested_payload: unknown;
  reason: string | null;
  created_at: string;
};

type FormularyChangeRequestListResponse = {
  data: FormularyChangeRequestItem[];
  summary: {
    status: 'pending' | 'approved' | 'rejected';
    total_count: number;
    overdue_count: number;
    overdue_days: number;
    oldest_pending_created_at: string | null;
    notification_level: 'clear' | 'pending' | 'overdue';
  };
};

const baseColumns: ColumnDef<DrugMasterRow>[] = [
  {
    id: 'formulary',
    header: '採用',
    cell: ({ row }) =>
      row.original.stock_config?.is_stocked ? (
        <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
          <CheckCircle2 className="size-3" aria-hidden="true" />
          採用
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          未採用
        </Badge>
      ),
  },
  {
    accessorKey: 'drug_name',
    header: '医薬品名',
    cell: ({ row }) => <DrugNameCell drug={row.original} />,
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
    cell: ({ row }) => <span className="text-sm">{row.original.dosage_form ?? '—'}</span>,
  },
  {
    id: 'flags',
    header: '区分',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.is_generic && (
          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">
            後発
          </Badge>
        )}
        {row.original.is_narcotic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
            <AlertTriangle className="size-2.5" aria-hidden="true" />
            麻薬
          </span>
        )}
        {row.original.is_psychotropic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700">
            <Shield className="size-2.5" aria-hidden="true" />
            向精神
          </span>
        )}
        {row.original.is_high_risk && (
          <span className="inline-flex items-center gap-0.5 rounded border border-red-300 bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-700">
            <AlertTriangle className="size-2.5" aria-hidden="true" />
            ハイリスク
          </span>
        )}
        {row.original.outpatient_injection_eligible && (
          <span className="inline-flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-800">
            自己注射
          </span>
        )}
        {row.original.is_lasa_risk && (
          <span className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-800">
            LASA
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
      <span className="text-sm tabular-nums">{row.original.max_administration_days ?? '—'}</span>
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

const IMPORT_LOG_SOURCE_OPTIONS: Array<{
  value: 'all' | DrugMasterImportLog['source'];
  label: string;
}> = [
  { value: 'all', label: 'すべてのソース' },
  { value: 'ssk', label: IMPORT_SOURCE_LABEL.ssk },
  { value: 'mhlw_price', label: IMPORT_SOURCE_LABEL.mhlw_price },
  { value: 'mhlw_generic', label: IMPORT_SOURCE_LABEL.mhlw_generic },
  { value: 'hot', label: IMPORT_SOURCE_LABEL.hot },
  { value: 'pmda', label: IMPORT_SOURCE_LABEL.pmda },
  { value: 'manual_clinical', label: IMPORT_SOURCE_LABEL.manual_clinical },
];

const IMPORT_LOG_STATUS_OPTIONS: Array<{
  value: 'all' | DrugMasterImportLog['status'];
  label: string;
}> = [
  { value: 'all', label: 'すべての状態' },
  { value: 'failed', label: '失敗のみ' },
  { value: 'running', label: '実行中' },
  { value: 'completed', label: '完了' },
  { value: 'pending', label: '待機' },
];

function DrugNameCell({ drug }: { drug: DrugMasterRow }) {
  const displayName = drug.tall_man_name?.trim() || drug.drug_name;
  const hasTallMan = displayName !== drug.drug_name;

  return (
    <div className="min-w-[200px]">
      <div className="flex items-center gap-1.5">
        <Pill className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{displayName}</span>
        {hasTallMan && (
          <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-800">
            Tall Man
          </Badge>
        )}
      </div>
      {hasTallMan && (
        <div className="mt-0.5 text-xs text-muted-foreground">通常表記: {drug.drug_name}</div>
      )}
      {drug.generic_name && (
        <div className="mt-0.5 text-xs text-muted-foreground">一般名: {drug.generic_name}</div>
      )}
      {(drug.is_lasa_risk || drug.lasa_group_key) && (
        <div className="mt-1 text-xs font-medium text-amber-800">
          LASA注意{drug.lasa_group_key ? `: ${drug.lasa_group_key}` : ''}
        </div>
      )}
    </div>
  );
}

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
  const [expiryReferenceTime] = useState(() => Date.now());
  const reorderPointInputRef = useRef<HTMLInputElement | null>(null);

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

  const sites = sitesData?.data ?? [];
  const { effectiveSelectedSiteId, copySourceSites, headerTitle, headerDescription } =
    buildDrugMasterSiteHeaderViewModel({
      variant,
      selectedSiteId,
      sites,
    });

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '50' });
    if (searchQuery) p.set('q', searchQuery);
    if (category) p.set('category', category);
    if (genericOnly) p.set('generic', 'true');
    if (narcoticOnly) p.set('narcotic', 'true');
    if (highRiskOnly) p.set('highRisk', 'true');
    if (lasaOnly) p.set('lasa', 'true');
    if (effectiveSelectedSiteId) p.set('site_id', effectiveSelectedSiteId);
    if (stockedOnly && effectiveSelectedSiteId) p.set('stocked', 'true');
    return p.toString();
  }, [
    searchQuery,
    category,
    genericOnly,
    narcoticOnly,
    highRiskOnly,
    lasaOnly,
    effectiveSelectedSiteId,
    stockedOnly,
  ]);

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

  const { data: masterStatusData } = useQuery({
    queryKey: ['drug-master-status'],
    queryFn: async () => {
      const res = await fetch('/api/drug-master-imports/status', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('マスターステータスの取得に失敗しました');
      return res.json() as Promise<DrugMasterImportStatusResponse>;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const { data: importLogsData, isLoading: isLoadingLogs } = useQuery({
    queryKey: ['drug-master-import-logs', importLogSourceFilter, importLogStatusFilter],
    queryFn: async () => {
      const logParams = new URLSearchParams({ limit: '10' });
      if (importLogSourceFilter !== 'all') logParams.set('source', importLogSourceFilter);
      if (importLogStatusFilter !== 'all') logParams.set('status', importLogStatusFilter);
      const res = await fetch(`/api/drug-master-import-logs?${logParams}`, {
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

  const stockHistoryQuery = useQuery({
    queryKey: ['pharmacy-drug-stock-history', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        drug_master_id: selectedDrugId ?? '',
        limit: '10',
      });
      const res = await fetch(`/api/pharmacy-drug-stocks/history?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用品履歴の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacyDrugStockHistoryItem[] }>;
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
      const res = await fetch(`/api/pharmacy-drug-stocks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用薬レビュー対象の取得に失敗しました');
      return res.json() as Promise<{ data: FormularyStockSummaryRow[] }>;
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
      const res = await fetch(`/api/pharmacy-drug-stocks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('在庫下限未設定の取得に失敗しました');
      return res.json() as Promise<{ data: FormularyStockSummaryRow[] }>;
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
      const res = await fetch(`/api/pharmacy-drug-stocks/impact?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用薬影響レビューの取得に失敗しました');
      return res.json() as Promise<FormularyImpactResponse>;
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
      const res = await fetch(`/api/pharmacy-drug-stocks/usage-mismatch?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('処方・採用品不一致の取得に失敗しました');
      return res.json() as Promise<FormularyUsageMismatchResponse>;
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
      const res = await fetch(`/api/pharmacy-drug-stock-requests?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用品変更申請の取得に失敗しました');
      return res.json() as Promise<FormularyChangeRequestListResponse>;
    },
    enabled: variant === 'formulary' && !!orgId && !!effectiveSelectedSiteId,
    staleTime: 60_000,
  });

  const formularyTemplatesQuery = useQuery({
    queryKey: ['pharmacy-drug-stock-templates', orgId, templateSearchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '50' });
      const query = templateSearchQuery.trim();
      if (query) params.set('q', query);
      const res = await fetch(`/api/pharmacy-drug-stock-templates?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('採用品テンプレートの取得に失敗しました');
      return res.json() as Promise<{ data: FormularyTemplateItem[] }>;
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

  const genericRecommendationsQuery = useQuery({
    queryKey: ['generic-recommendations', orgId, effectiveSelectedSiteId, selectedDrugId],
    queryFn: async () => {
      if (!selectedDrugId) return { recommendations: [] as GenericRecommendation[] };
      const params = new URLSearchParams({ limit: '8' });
      if (effectiveSelectedSiteId) params.set('site_id', effectiveSelectedSiteId);
      const res = await fetch(
        `/api/drug-masters/${selectedDrugId}/generic-recommendations?${params}`,
        {
          headers: { 'x-org-id': orgId },
        },
      );
      if (!res.ok) throw new Error('推奨後発品の取得に失敗しました');
      return res.json() as Promise<{ recommendations: GenericRecommendation[] }>;
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
      const res = await fetch(`/api/drug-masters/${selectedDrugId}/ingredient-group?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('同一成分グループの取得に失敗しました');
      return res.json() as Promise<IngredientGroupResponse>;
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
        `${result.definition.label}が完了しました（${result.response.data.importedCount.toLocaleString()}件）`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-import-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-status'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '医薬品マスタ取込に失敗しました');
    },
  });

  const autoRefreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/jobs/drug-master-auto-refresh', {
        method: 'POST',
        headers: { 'x-org-id': orgId },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? '一括更新の実行に失敗しました');
      }
      return json as { data?: { processedCount?: number } };
    },
    onSuccess: async (result) => {
      const processedCount = result.data?.processedCount;
      toast.success(
        processedCount != null
          ? `フリーマスター一括更新が完了しました（${processedCount.toLocaleString()}件）`
          : 'フリーマスター一括更新が完了しました',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-import-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-master-status'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '一括更新に失敗しました');
    },
  });

  const freshnessCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/jobs/drug-master-freshness-check', {
        method: 'POST',
        headers: { 'x-org-id': orgId },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? 'マスター鮮度チェックに失敗しました');
      }
      return json as { processedCount?: number; errors?: string[] };
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
      toast.error(error instanceof Error ? error.message : 'マスター鮮度チェックに失敗しました');
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
      return json as { site: PharmacySiteOption; data: PharmacyDrugStockConfig };
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
      toast.error(error instanceof Error ? error.message : '採用品設定の保存に失敗しました');
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
      const res = await fetch('/api/pharmacy-drug-stock-requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? '採用品変更申請の作成に失敗しました');
      }
      return json as { data: FormularyChangeRequestItem };
    },
    onSuccess: async () => {
      toast.success('採用品変更申請を作成しました');
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-requests'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '採用品変更申請の作成に失敗しました');
    },
  });

  const stockRequestDecisionMutation = useMutation({
    mutationFn: async (payload: {
      request_id: string;
      decision: 'approve' | 'reject';
      decision_note?: string | null;
    }) => {
      const res = await fetch(`/api/pharmacy-drug-stock-requests/${payload.request_id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          decision: payload.decision,
          decision_note: payload.decision_note ?? null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? '採用品変更申請の決裁に失敗しました');
      }
      return json as { request: FormularyChangeRequestItem; stock: PharmacyDrugStockConfig | null };
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
      toast.error(error instanceof Error ? error.message : '採用品変更申請の決裁に失敗しました');
    },
  });

  const runBulkCsvMutation = async (dryRun: boolean) => {
    if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
    const res = await fetch('/api/pharmacy-drug-stocks/bulk', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({
        site_id: effectiveSelectedSiteId,
        csv: bulkCsv,
        dry_run: dryRun,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(json?.message ?? '採用薬リストの一括登録に失敗しました');
    }
    return json as {
      importedCount: number;
      unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>;
      invalidRows: Array<{ rowNumber: number; reason: string }>;
      preview?: BulkPreviewResponse['preview'];
    };
  };

  const bulkPreviewMutation = useMutation({
    mutationFn: async () => runBulkCsvMutation(true),
    onSuccess: (result) => {
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
      toast.error(error instanceof Error ? error.message : '採用薬CSVの確認に失敗しました');
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
      setBulkCsv('');
      setBulkPreview(null);
      setBulkPreviewExpanded(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
        queryClient.invalidateQueries({ queryKey: ['drug-masters'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '採用薬リストの一括登録に失敗しました');
    },
  });

  const copyFormularyMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      if (!copySourceSiteId) throw new Error('コピー元拠点を選択してください');
      if (!effectiveSelectedSiteId) throw new Error('コピー先拠点を選択してください');
      const res = await fetch('/api/pharmacy-drug-stocks/copy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          source_site_id: copySourceSiteId,
          target_site_id: effectiveSelectedSiteId,
          overwrite: copyOverwrite,
          dry_run: dryRun,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? '採用薬リストのコピーに失敗しました');
      }
      return json as FormularyCopyPreviewResponse;
    },
    onSuccess: async (result) => {
      if (result.dryRun) {
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
      toast.error(error instanceof Error ? error.message : '採用薬リストのコピーに失敗しました');
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const name = templateName.trim();
      if (!name) throw new Error('テンプレート名を入力してください');
      const res = await fetch('/api/pharmacy-drug-stock-templates', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          name,
          source_site_id: effectiveSelectedSiteId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? '採用品テンプレートの作成に失敗しました');
      return json as { data: FormularyTemplateItem };
    },
    onSuccess: async () => {
      toast.success('採用品テンプレートを作成しました');
      setTemplateName('');
      setTemplatePreview(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-templates'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '採用品テンプレートの作成に失敗しました',
      );
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      if (!selectedTemplateId) throw new Error('テンプレートを選択してください');
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const res = await fetch(`/api/pharmacy-drug-stock-templates/${selectedTemplateId}/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          target_site_id: effectiveSelectedSiteId,
          overwrite: copyOverwrite,
          dry_run: dryRun,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? '採用品テンプレートの適用に失敗しました');
      return json as FormularyTemplatePreviewResponse;
    },
    onSuccess: async (result) => {
      if (result.dryRun) {
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
      toast.error(
        error instanceof Error ? error.message : '採用品テンプレートの適用に失敗しました',
      );
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) throw new Error('テンプレートを選択してください');
      const res = await fetch(`/api/pharmacy-drug-stock-templates/${selectedTemplateId}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? '採用品テンプレートの削除に失敗しました');
      return json as { deleted: boolean; data: FormularyTemplateItem };
    },
    onSuccess: async () => {
      toast.success('採用品テンプレートを削除しました');
      setSelectedTemplateId('');
      setTemplatePreview(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-templates'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '採用品テンプレートの削除に失敗しました',
      );
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const res = await fetch('/api/pharmacy-drug-stocks/review', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ site_id: effectiveSelectedSiteId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? '採用薬レビューの記録に失敗しました');
      return json as { reviewedCount: number };
    },
    onSuccess: async (result) => {
      toast.success(`採用薬レビューを記録しました（${result.reviewedCount.toLocaleString()}件）`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stocks'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drug-stock-history'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '採用薬レビューの記録に失敗しました');
    },
  });

  const safetyFollowUpMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const res = await fetch('/api/pharmacy-drug-stocks/safety-follow-up', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          site_id: effectiveSelectedSiteId,
          queue: 'all',
          due_in_days: 30,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? '安全性フォローアップの作成に失敗しました');
      return json as {
        matchedCount: number;
        updatedCount: number;
        skippedUnresolvedCount: number;
      };
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
      toast.error(
        error instanceof Error ? error.message : '安全性フォローアップの作成に失敗しました',
      );
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedSiteId) throw new Error('対象拠点を選択してください');
      const params = new URLSearchParams({
        site_id: effectiveSelectedSiteId,
        purpose: exportPurpose,
      });
      const res = await fetch(`/api/pharmacy-drug-stocks/export?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message ?? '採用薬CSVの出力に失敗しました');
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
      toast.error(error instanceof Error ? error.message : '採用薬CSVの出力に失敗しました');
    },
  });

  const templateMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (effectiveSelectedSiteId) params.set('site_id', effectiveSelectedSiteId);
      const query = params.toString();
      const res = await fetch(`/api/pharmacy-drug-stocks/template${query ? `?${query}` : ''}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message ?? '採用薬CSVテンプレートの取得に失敗しました');
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
      toast.error(
        error instanceof Error ? error.message : '採用薬CSVテンプレートの取得に失敗しました',
      );
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
              className="h-9 gap-1"
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

  const drugs = data?.data ?? [];
  const formularyTemplates = formularyTemplatesQuery.data?.data ?? [];
  const importLogs = importLogsData?.data ?? [];
  const reviewDueStocks = formularyReviewQuery.data?.data ?? [];
  const missingReorderStocks = formularyMissingReorderQuery.data?.data ?? [];
  const formularyImpact = formularyImpactQuery.data;
  const formularyUsageMismatch = formularyUsageMismatchQuery.data;
  const pendingFormularyRequests = formularyRequestsQuery.data?.data ?? [];
  const formularyRequestSummary = formularyRequestsQuery.data?.summary;
  const {
    reviewDueCount,
    missingReorderCount,
    safetyFlaggedCount,
    highRiskAdoptedCount,
    lasaRiskAdoptedCount,
    controlledAdoptedCount,
    transitionalExpiryCount,
    transitionalExpiryWithin30Count,
    transitionalExpiryWithin60Count,
    transitionalExpiryWithin90Count,
    actionRequiredCount,
    recentMasterChangeCount,
    followUpSummary,
    frequentUnstockedMismatchCount,
    unusedStockedMismatchCount,
    recentChangesByYjCode,
    impactQueueRows,
    masterChangeReport,
    impactQueueTotalCount,
  } = buildFormularyOperationsViewModel({
    reviewDueStocks,
    missingReorderStocks,
    formularyImpact,
    formularyUsageMismatch,
    impactQueue,
    expiryReferenceTime,
  });
  const {
    bulkPreviewSummary,
    bulkPreviewBlockingCount,
    bulkPreviewRowsForDisplay,
    visibleBulkPreviewRows,
    canApplyBulkPreview,
  } = buildBulkPreviewViewModel({
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
  const genericRecommendations = genericRecommendationsQuery.data?.recommendations ?? [];
  const ingredientGroup = ingredientGroupQuery.data ?? null;
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
  return (
    <PageScaffold>
      <div className="space-y-4">
        <AdminPageHeader
          title={headerTitle}
          description={headerDescription}
          shortcuts={headerShortcuts}
        />
      </div>

      <PageSection
        title="更新と対象拠点"
        description="マスター取込、採用品設定の拠点、表示対象を先に固定してから採用薬レビューへ進みます。"
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
                onClick={() => importMutation.mutate(action.key)}
                className="gap-1"
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
                    data?.totalCount !== undefined
                      ? `${data.totalCount.toLocaleString()}件`
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
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm sm:h-9"
            >
              <option value="">拠点を選択</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            <label className="mt-2 flex min-h-[44px] items-center gap-1.5 text-xs text-muted-foreground sm:min-h-0">
              <input
                type="checkbox"
                checked={stockedOnly}
                onChange={(event) => setStockedOnly(event.target.checked)}
                className="size-4 rounded border-input"
              />
              採用品のみ表示
            </label>
          </label>
        </div>
      </PageSection>

      {variant === 'formulary' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              採用薬リスト運用
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-6">
              <button
                type="button"
                className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('review_due')}
              >
                <p className="text-xs text-muted-foreground">レビュー期限超過</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {reviewDueCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('missing_reorder_point')}
              >
                <p className="text-xs text-muted-foreground">在庫下限未設定</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {missingReorderCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('safety_flagged')}
              >
                <p className="text-xs text-muted-foreground">安全属性あり</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {safetyFlaggedCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('transitional_expiry')}
              >
                <p className="text-xs text-muted-foreground">経過措置90日以内</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {transitionalExpiryCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('action_required')}
              >
                <p className="text-xs text-muted-foreground">要対応</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {actionRequiredCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('recently_changed')}
              >
                <p className="text-xs text-muted-foreground">30日以内差分</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {recentMasterChangeCount.toLocaleString()}
                </p>
              </button>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ClipboardCheck className="size-4" aria-hidden="true" />
                  採用品変更申請
                </h2>
                <Badge
                  variant={
                    (formularyRequestSummary?.overdue_count ?? 0) > 0
                      ? 'destructive'
                      : pendingFormularyRequests.length > 0
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  未承認{' '}
                  {(
                    formularyRequestSummary?.total_count ?? pendingFormularyRequests.length
                  ).toLocaleString()}
                  件
                </Badge>
              </div>
              {formularyRequestSummary && formularyRequestSummary.total_count > 0 && (
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">未承認</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formularyRequestSummary.total_count.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">7日超過</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formularyRequestSummary.overdue_count.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">最古申請</p>
                    <p className="mt-1 text-sm font-medium">
                      {formularyRequestSummary.oldest_pending_created_at
                        ? new Date(
                            formularyRequestSummary.oldest_pending_created_at,
                          ).toLocaleDateString('ja-JP')
                        : '—'}
                    </p>
                  </div>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {pendingFormularyRequests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">未承認の変更申請はありません。</p>
                ) : (
                  pendingFormularyRequests.slice(0, 3).map((request) => (
                    <div
                      key={request.id}
                      className="rounded-md border border-border/60 bg-background px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setSelectedDrugId(request.drug_master_id);
                            setPreferredGenericId(null);
                          }}
                        >
                          <span className="block text-sm font-medium text-foreground">
                            {formatFormularyRequestActionLabel(request.action_type)}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {new Date(request.created_at).toLocaleDateString('ja-JP')}
                            {request.reason ? ` / ${request.reason}` : ''}
                          </span>
                        </button>
                        <div className="flex flex-wrap gap-2">
                          <LoadingButton
                            type="button"
                            size="sm"
                            loading={
                              stockRequestDecisionMutation.isPending &&
                              stockRequestDecisionMutation.variables?.request_id === request.id &&
                              stockRequestDecisionMutation.variables?.decision === 'approve'
                            }
                            loadingLabel="承認中"
                            onClick={() =>
                              stockRequestDecisionMutation.mutate({
                                request_id: request.id,
                                decision: 'approve',
                              })
                            }
                          >
                            承認
                          </LoadingButton>
                          <LoadingButton
                            type="button"
                            size="sm"
                            variant="outline"
                            loading={
                              stockRequestDecisionMutation.isPending &&
                              stockRequestDecisionMutation.variables?.request_id === request.id &&
                              stockRequestDecisionMutation.variables?.decision === 'reject'
                            }
                            loadingLabel="却下中"
                            onClick={() =>
                              stockRequestDecisionMutation.mutate({
                                request_id: request.id,
                                decision: 'reject',
                                decision_note: '画面から却下',
                              })
                            }
                          >
                            却下
                          </LoadingButton>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileWarning className="size-4" aria-hidden="true" />
                  処方・採用品不一致
                </h2>
                <Badge
                  variant={
                    frequentUnstockedMismatchCount + unusedStockedMismatchCount > 0
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  要確認{' '}
                  {(frequentUnstockedMismatchCount + unusedStockedMismatchCount).toLocaleString()}件
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">90日QR処方行</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {(formularyUsageMismatch?.totals.medication_line_count ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">頻出だが未採用</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {frequentUnstockedMismatchCount.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">採用品だが未使用</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {unusedStockedMismatchCount.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">採用検討候補</p>
                  {(formularyUsageMismatch?.frequent_unstocked ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      頻出している未採用品はありません。
                    </p>
                  ) : (
                    formularyUsageMismatch?.frequent_unstocked.slice(0, 3).map((item) => (
                      <button
                        key={`${item.drug_code ?? item.drug_name}-${item.last_seen_at}`}
                        type="button"
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => {
                          if (!item.matched_drug) return;
                          setSelectedDrugId(item.matched_drug.id);
                          setPreferredGenericId(null);
                        }}
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {item.drug_name ?? item.matched_drug?.drug_name ?? '名称未取得'}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {item.drug_code && <span className="font-mono">{item.drug_code}</span>}
                          <span>{item.count.toLocaleString()}回</span>
                          <span>
                            最終 {new Date(item.last_seen_at).toLocaleDateString('ja-JP')}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">整理検討候補</p>
                  {(formularyUsageMismatch?.unused_stocked ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      直近QR処方で未使用の採用品はありません。
                    </p>
                  ) : (
                    formularyUsageMismatch?.unused_stocked.slice(0, 3).map((stock) => (
                      <button
                        key={stock.id}
                        type="button"
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => {
                          setSelectedDrugId(stock.drug_master_id);
                          setPreferredGenericId(null);
                        }}
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {stock.drug_master.drug_name}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{stock.drug_master.yj_code}</span>
                          {stock.reorder_point != null && (
                            <span>発注点 {stock.reorder_point.toLocaleString()}</span>
                          )}
                          <span>更新 {new Date(stock.updated_at).toLocaleDateString('ja-JP')}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              {formularyUsageMismatch?.totals.unmatched_drug_count ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  マスター未照合の処方候補{' '}
                  {formularyUsageMismatch.totals.unmatched_drug_count.toLocaleString()}件は、
                  名称またはYJコードの確認が必要です。
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ListChecks className="size-4" aria-hidden="true" />
                  影響レビューキュー
                </h2>
                <Badge variant="outline" className="text-[10px]">
                  {impactQueueTotalCount.toLocaleString()}件中
                  {impactQueueRows.length.toLocaleString()}件表示
                </Badge>
              </div>
              {followUpSummary && (
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <button
                    type="button"
                    className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => setImpactQueue('action_required')}
                  >
                    <p className="text-xs text-muted-foreground">未解決フォローアップ</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {followUpSummary.unresolved_count.toLocaleString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => setImpactQueue('action_required')}
                  >
                    <p className="text-xs text-muted-foreground">期限超過</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {followUpSummary.overdue_count.toLocaleString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => setImpactQueue('action_required')}
                  >
                    <p className="text-xs text-muted-foreground">期限未設定</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {followUpSummary.missing_due_date_count.toLocaleString()}
                    </p>
                  </button>
                </div>
              )}
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('high_risk')}
                >
                  <p className="text-xs text-muted-foreground">ハイリスク採用品</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {highRiskAdoptedCount.toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('lasa_risk')}
                >
                  <p className="text-xs text-muted-foreground">LASA注意採用品</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {lasaRiskAdoptedCount.toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('controlled')}
                >
                  <p className="text-xs text-muted-foreground">規制薬採用品</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {controlledAdoptedCount.toLocaleString()}
                  </p>
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  安全属性のある採用品のうち、未解決フォローアップがないものを30日以内の要確認にします。
                </p>
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={safetyFollowUpMutation.isPending}
                  loadingLabel="作成中"
                  disabled={!effectiveSelectedSiteId || safetyFlaggedCount === 0}
                  onClick={() => safetyFollowUpMutation.mutate()}
                >
                  安全性フォローアップ作成
                </LoadingButton>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('transitional_expiry')}
                >
                  <p className="text-xs text-muted-foreground">経過措置30日以内</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {transitionalExpiryWithin30Count.toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('transitional_expiry')}
                >
                  <p className="text-xs text-muted-foreground">経過措置60日以内</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {transitionalExpiryWithin60Count.toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('transitional_expiry')}
                >
                  <p className="text-xs text-muted-foreground">経過措置90日以内</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {transitionalExpiryWithin90Count.toLocaleString()}
                  </p>
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {impactQueueRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">対象の採用薬はありません。</p>
                ) : (
                  impactQueueRows.slice(0, 5).map((stock) => {
                    const recentChange = recentChangesByYjCode.get(stock.drug_master.yj_code);
                    return (
                      <button
                        key={stock.id}
                        type="button"
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => {
                          setSelectedDrugId(stock.drug_master_id);
                          setPreferredGenericId(null);
                        }}
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {stock.drug_master.drug_name}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{stock.drug_master.yj_code}</span>
                          {stock.drug_master.drug_price != null && (
                            <span>
                              ¥{Number(stock.drug_master.drug_price).toFixed(1)}/
                              {stock.drug_master.unit ?? ''}
                            </span>
                          )}
                          {stock.follow_up_status && <span>{stock.follow_up_status}</span>}
                          {stock.drug_master.is_high_risk && <span>ハイリスク</span>}
                          {stock.drug_master.is_lasa_risk && <span>LASA</span>}
                          {(stock.drug_master.is_narcotic || stock.drug_master.is_psychotropic) && (
                            <span>規制薬</span>
                          )}
                          {stock.drug_master.transitional_expiry_date && (
                            <span>
                              経過措置{' '}
                              {new Date(
                                stock.drug_master.transitional_expiry_date,
                              ).toLocaleDateString('ja-JP')}
                            </span>
                          )}
                          {recentChange && <span>差分: {recentChange.change_type}</span>}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            {masterChangeReport && (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <History className="size-4" aria-hidden="true" />
                    薬価改定差分レポート
                  </h2>
                  <Badge variant={masterChangeReport.total_count > 0 ? 'secondary' : 'outline'}>
                    採用品差分 {masterChangeReport.total_count.toLocaleString()}件
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {masterChangeReport.change_type_counts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      直近30日のMHLW薬価マスター差分に該当する採用品はありません。
                    </p>
                  ) : (
                    masterChangeReport.change_type_counts.slice(0, 3).map((item) => (
                      <div
                        key={item.change_type}
                        className="rounded-md border border-border/60 bg-background px-3 py-2"
                      >
                        <p className="text-xs text-muted-foreground">
                          {formatMasterChangeTypeLabel(item.change_type)}
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {item.count.toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                {masterChangeReport.price_impact && (
                  <div className="mt-3 rounded-md border border-border/60 bg-background px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          薬価影響額推計（直近
                          {masterChangeReport.price_impact.usage_window_days.toLocaleString()}日QR）
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {masterChangeReport.price_impact.estimated_total_delta >= 0 ? '+' : ''}¥
                          {masterChangeReport.price_impact.estimated_total_delta.toLocaleString(
                            'ja-JP',
                            {
                              maximumFractionDigits: 2,
                            },
                          )}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        QR {masterChangeReport.price_impact.scanned_draft_count.toLocaleString()}件
                      </Badge>
                    </div>
                    {masterChangeReport.price_impact.rows.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {masterChangeReport.price_impact.rows.slice(0, 3).map((row) => (
                          <button
                            key={row.stock.id}
                            type="button"
                            className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-left text-xs hover:text-primary"
                            onClick={() => {
                              setSelectedDrugId(row.stock.drug_master_id);
                              setPreferredGenericId(null);
                            }}
                          >
                            <span className="min-w-0 font-medium text-foreground">
                              {row.stock.drug_master.drug_name}
                            </span>
                            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                              <span>{row.usage_count.toLocaleString()}回</span>
                              {row.unit_price_delta != null && (
                                <span>
                                  単価差 {row.unit_price_delta >= 0 ? '+' : ''}¥
                                  {row.unit_price_delta.toLocaleString('ja-JP', {
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              )}
                              {row.estimated_total_delta != null && (
                                <span>
                                  推計 {row.estimated_total_delta >= 0 ? '+' : ''}¥
                                  {row.estimated_total_delta.toLocaleString('ja-JP', {
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {masterChangeReport.rows.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {masterChangeReport.rows.slice(0, 5).map((row) => (
                      <button
                        key={row.stock.id}
                        type="button"
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => {
                          setSelectedDrugId(row.stock.drug_master_id);
                          setPreferredGenericId(null);
                        }}
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {row.stock.drug_master.drug_name}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{row.stock.drug_master.yj_code}</span>
                          {row.stock.drug_master.drug_price != null && (
                            <span>
                              ¥{Number(row.stock.drug_master.drug_price).toFixed(1)}/
                              {row.stock.drug_master.unit ?? ''}
                            </span>
                          )}
                          {row.changes.slice(0, 2).map((change) => (
                            <span key={change.id}>
                              {formatMasterChangeTypeLabel(change.change_type)}
                            </span>
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Building2 className="size-4" aria-hidden="true" />
                  拠点間コピー
                </h3>
                <Badge variant="outline" className="text-[10px]">
                  コピー先:{' '}
                  {sites.find((site) => site.id === effectiveSelectedSiteId)?.name ?? '未選択'}
                </Badge>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,260px)_auto_auto] lg:items-end">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">コピー元拠点</span>
                  <select
                    value={copySourceSiteId}
                    onChange={(event) => {
                      setCopySourceSiteId(event.target.value);
                      setCopyPreview(null);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">選択してください</option>
                    {copySourceSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-9 items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={copyOverwrite}
                    onChange={(event) => {
                      setCopyOverwrite(event.target.checked);
                      setCopyPreview(null);
                      setTemplatePreview(null);
                    }}
                    className="size-4 rounded border-input"
                  />
                  既存の採用品設定を上書き
                </label>
                <div className="flex flex-wrap gap-2">
                  <LoadingButton
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={
                      copyFormularyMutation.isPending &&
                      copyFormularyMutation.variables?.dryRun === true
                    }
                    loadingLabel="確認中"
                    disabled={!effectiveSelectedSiteId || !copySourceSiteId}
                    onClick={() => copyFormularyMutation.mutate({ dryRun: true })}
                    className="gap-1"
                  >
                    <ListChecks className="size-3.5" aria-hidden="true" />
                    コピー差分確認
                  </LoadingButton>
                  <LoadingButton
                    type="button"
                    size="sm"
                    loading={
                      copyFormularyMutation.isPending &&
                      copyFormularyMutation.variables?.dryRun === false
                    }
                    loadingLabel="コピー中"
                    disabled={!effectiveSelectedSiteId || !copySourceSiteId}
                    onClick={() => copyFormularyMutation.mutate({ dryRun: false })}
                    className="gap-1"
                  >
                    <ClipboardCheck className="size-3.5" aria-hidden="true" />
                    採用品をコピー
                  </LoadingButton>
                </div>
              </div>
              {copyPreview && (
                <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
                  <div className="grid gap-2 md:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">追加</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {copyPreview.preview.summary.create_count.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">上書き</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {copyPreview.preview.summary.update_count.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">既存スキップ</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {copyPreview.preview.summary.skip_existing_count.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">反映予定</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {copyPreview.preview.summary.apply_count.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    {copyPreview.preview.rows.slice(0, 3).map((row) => (
                      <div
                        key={`${row.action}-${row.drug_master_id}`}
                        className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs"
                      >
                        <span className="min-w-0 font-medium text-foreground">
                          {row.drug_master.drug_name}
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="font-mono">{row.drug_master.yj_code}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {row.action === 'create'
                              ? '追加'
                              : row.action === 'update'
                                ? '上書き'
                                : '既存スキップ'}
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">
                    施設別採用品テンプレート
                  </h4>
                  <Badge variant="outline" className="text-[10px]">
                    {formularyTemplates.length.toLocaleString()}件
                  </Badge>
                </div>
                <div className="mt-3">
                  <Input
                    value={templateSearchQuery}
                    onChange={(event) => {
                      setTemplateSearchQuery(event.target.value);
                      setSelectedTemplateId('');
                      setTemplatePreview(null);
                    }}
                    placeholder="テンプレート名・説明で検索"
                    aria-label="採用品テンプレート検索"
                  />
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(160px,1fr)_auto]">
                  <Input
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="例: 在宅内科 標準セット"
                    aria-label="採用品テンプレート名"
                  />
                  <LoadingButton
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={createTemplateMutation.isPending}
                    loadingLabel="作成中"
                    disabled={!effectiveSelectedSiteId || templateName.trim().length === 0}
                    onClick={() => createTemplateMutation.mutate()}
                  >
                    現在の拠点から作成
                  </LoadingButton>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(160px,1fr)_auto_auto_auto]">
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => {
                      setSelectedTemplateId(event.target.value);
                      setTemplatePreview(null);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    aria-label="適用する採用品テンプレート"
                  >
                    <option value="">テンプレートを選択</option>
                    {formularyTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}（{template.item_count.toLocaleString()}件）
                      </option>
                    ))}
                  </select>
                  <LoadingButton
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={applyTemplateMutation.isPending}
                    loadingLabel="確認中"
                    disabled={!effectiveSelectedSiteId || !selectedTemplateId}
                    onClick={() => applyTemplateMutation.mutate({ dryRun: true })}
                  >
                    適用差分確認
                  </LoadingButton>
                  <LoadingButton
                    type="button"
                    size="sm"
                    loading={applyTemplateMutation.isPending}
                    loadingLabel="適用中"
                    disabled={!effectiveSelectedSiteId || !selectedTemplateId}
                    onClick={() => applyTemplateMutation.mutate({ dryRun: false })}
                  >
                    テンプレートを適用
                  </LoadingButton>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    disabled={!selectedTemplateId || deleteTemplateMutation.isPending}
                    onClick={() => deleteTemplateMutation.mutate()}
                    aria-label="採用品テンプレートを削除"
                    title="採用品テンプレートを削除"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                {templatePreview && (
                  <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
                    <div className="grid gap-2 md:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">追加</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {templatePreview.preview.summary.create_count.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">上書き</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {templatePreview.preview.summary.update_count.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">既存スキップ</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {templatePreview.preview.summary.skip_existing_count.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">反映予定</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {templatePreview.preview.summary.apply_count.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {templatePreview.preview.rows.slice(0, 3).map((row) => (
                        <div
                          key={`${row.action}-${row.drug_master_id}`}
                          className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs"
                        >
                          <span className="min-w-0 font-medium text-foreground">
                            {row.drug_master.drug_name}
                          </span>
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-mono">{row.drug_master.yj_code}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {row.action === 'create'
                                ? '追加'
                                : row.action === 'update'
                                  ? '上書き'
                                  : '既存スキップ'}
                            </Badge>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">CSV一括登録</span>
                <textarea
                  value={bulkCsv}
                  onChange={(event) => {
                    setBulkCsv(event.target.value);
                    setBulkPreview(null);
                  }}
                  placeholder="YJコード,医薬品名,採用,発注点,優先後発品YJコード,メモ"
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={bulkPreviewMutation.isPending}
                  loadingLabel="確認中"
                  disabled={!effectiveSelectedSiteId || bulkCsv.trim().length === 0}
                  onClick={() => bulkPreviewMutation.mutate()}
                  className="gap-1"
                >
                  <ListChecks className="size-3.5" aria-hidden="true" />
                  差分確認
                </LoadingButton>
                <LoadingButton
                  type="button"
                  size="sm"
                  loading={bulkImportMutation.isPending}
                  loadingLabel="登録中"
                  disabled={!canApplyBulkPreview}
                  onClick={() => bulkImportMutation.mutate()}
                  className="gap-1"
                >
                  <Upload className="size-3.5" aria-hidden="true" />
                  一括登録
                </LoadingButton>
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={templateMutation.isPending}
                  loadingLabel="取得中"
                  onClick={() => templateMutation.mutate()}
                  className="gap-1"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  CSVテンプレート
                </LoadingButton>
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  CSV出力用途
                  <select
                    aria-label="CSV出力用途"
                    value={exportPurpose}
                    onChange={(event) =>
                      setExportPurpose(event.target.value as FormularyExportPurpose)
                    }
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="operations">運用台帳</option>
                    <option value="audit">監査</option>
                    <option value="posting">掲示用</option>
                    <option value="pharmacist_review">薬剤師レビュー</option>
                  </select>
                </label>
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={exportMutation.isPending}
                  loadingLabel="出力中"
                  disabled={!effectiveSelectedSiteId}
                  onClick={() => exportMutation.mutate()}
                  className="gap-1"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  CSV出力
                </LoadingButton>
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={reviewMutation.isPending}
                  loadingLabel="記録中"
                  disabled={!effectiveSelectedSiteId || reviewDueCount === 0}
                  onClick={() => reviewMutation.mutate()}
                  className="gap-1"
                >
                  <ClipboardCheck className="size-3.5" aria-hidden="true" />
                  レビュー済み
                </LoadingButton>
              </div>
            </div>
            {bulkPreviewSummary && (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ListChecks className="size-4" aria-hidden="true" />
                    CSV反映前プレビュー
                  </h3>
                  <Badge variant={bulkPreviewBlockingCount > 0 ? 'destructive' : 'outline'}>
                    {bulkPreviewBlockingCount > 0
                      ? `要確認 ${bulkPreviewBlockingCount.toLocaleString()}件`
                      : '反映可能'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">新規採用</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bulkPreviewSummary.createCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">更新</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bulkPreviewSummary.updateCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">採用解除</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bulkPreviewSummary.deactivateCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">変更なし</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bulkPreviewSummary.noChangeCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">未照合</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bulkPreviewSummary.unmatchedCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">無効</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bulkPreviewSummary.invalidCount.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {visibleBulkPreviewRows.map((row) => (
                    <div
                      key={`${row.rowNumber}-${row.status}`}
                      className="rounded-md border border-border/60 bg-background px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {row.drug_name ?? row.yj_code ?? `行 ${row.rowNumber}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            行 {row.rowNumber}
                            {row.yj_code ? ` / ${row.yj_code}` : ''}
                            {row.reason ? ` / ${row.reason}` : ''}
                          </p>
                        </div>
                        <Badge
                          variant={
                            ['invalid', 'unmatched'].includes(row.status)
                              ? 'destructive'
                              : 'outline'
                          }
                        >
                          {formatBulkPreviewStatusLabel(row.status)}
                        </Badge>
                      </div>
                      {row.candidates && row.candidates.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                          {row.candidates.map((candidate) => (
                            <div
                              key={candidate.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <span className="min-w-0 font-medium text-foreground">
                                {candidate.drug_name}
                              </span>
                              <span className="flex items-center gap-2 text-muted-foreground">
                                <span className="font-mono">{candidate.yj_code}</span>
                                {candidate.generic_name && <span>{candidate.generic_name}</span>}
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-7"
                                  aria-label={`${candidate.drug_name}のYJコードをコピー`}
                                  title="YJコードをコピー"
                                  onClick={async () => {
                                    await navigator.clipboard?.writeText(candidate.yj_code);
                                    toast.success('YJコードをコピーしました');
                                  }}
                                >
                                  <Copy className="size-3.5" aria-hidden="true" />
                                </Button>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {bulkPreviewRowsForDisplay.length > 6 && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBulkPreviewExpanded((expanded) => !expanded)}
                    >
                      {bulkPreviewExpanded
                        ? 'プレビューを6件に絞る'
                        : `全${bulkPreviewRowsForDisplay.length.toLocaleString()}件を表示`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
            {masterStatusData.sources.map((source) => (
              <div
                key={source.source}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{source.label}</span>
                    <Badge variant="outline" className="text-[10px]">
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
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {source.recent_runs_30d.total > 0
                        ? `直近30日: ${source.recent_runs_30d.total}回 / 失敗 ${source.recent_runs_30d.failed}回`
                        : '直近30日の実行なし'}
                    </span>
                    {source.recent_runs_30d.latest_status && (
                      <Badge variant="outline" className="text-[10px]">
                        最新実行 {formatImportStatusLabel(source.recent_runs_30d.latest_status)}
                      </Badge>
                    )}
                    {source.recent_runs_30d.failure_streak > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
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
                  className="text-[10px]"
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
            ))}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={importMutation.isPending || autoRefreshMutation.isPending}
              onClick={() => autoRefreshMutation.mutate()}
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
        <div className="space-y-3">
          <FilterSummaryBar
            items={[
              { label: '表示:', value: `${importLogs.length.toLocaleString()}件` },
              { label: 'ソース:', value: selectedImportLogSourceLabel },
              { label: '状態:', value: selectedImportLogStatusLabel },
            ]}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">ソース</span>
              <select
                aria-label="取込履歴ソース"
                value={importLogSourceFilter}
                onChange={(event) =>
                  setImportLogSourceFilter(
                    event.target.value as 'all' | DrugMasterImportLog['source'],
                  )
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {IMPORT_LOG_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">状態</span>
              <select
                aria-label="取込履歴状態"
                value={importLogStatusFilter}
                onChange={(event) =>
                  setImportLogStatusFilter(
                    event.target.value as 'all' | DrugMasterImportLog['status'],
                  )
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {IMPORT_LOG_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
                      {formatImportStatusLabel(log.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.imported_at).toLocaleString('ja-JP')} ・{' '}
                    {log.record_count.toLocaleString()}件
                  </div>
                  {log.error_log && <div className="text-xs text-red-600">{log.error_log}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </PageSection>

      {/* Search & Filters */}
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
                className="absolute left-2.5 top-2 size-4 text-muted-foreground"
                aria-hidden="true"
              />
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
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
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
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={highRiskOnly}
                onChange={(e) => setHighRiskOnly(e.target.checked)}
                className="size-4 rounded border-input"
              />
              ハイリスク薬のみ
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={lasaOnly}
                onChange={(e) => setLasaOnly(e.target.checked)}
                className="size-4 rounded border-input"
              />
              LASA注意のみ
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={stockedOnly}
                onChange={(e) => setStockedOnly(e.target.checked)}
                className="size-4 rounded border-input"
                disabled={!effectiveSelectedSiteId}
              />
              採用品のみ
            </label>
          </div>
        </div>
      </PageSection>

      {/* Table */}
      <DataTable
        columns={tableColumns}
        data={drugs}
        isLoading={isLoading}
        caption="医薬品マスター一覧"
        onRowClick={(index) => {
          setSelectedDrugId(drugs[index]?.id ?? null);
          setPreferredGenericId(null);
        }}
        selectedRowIndex={selectedRowIndex}
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
            <SheetTitle>{detailQuery.data?.drug_name ?? '医薬品詳細'}</SheetTitle>
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
                <PageSection
                  title="採用品設定"
                  description="対象拠点での採用状態、優先後発薬、フォローアップ、在庫下限を確認します。"
                >
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
                            {sites.find((site) => site.id === effectiveSelectedSiteId)?.name ??
                              '対象拠点'}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {stockConfig?.is_stocked
                              ? '採用品として登録済みです。必要に応じて採用後発薬を指定してください。'
                              : 'この薬を採用品として登録できます。'}
                          </p>
                          {selectedPendingRequest && (
                            <p className="mt-1 text-xs font-medium text-amber-700">
                              未承認の変更申請があります。
                            </p>
                          )}
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
                                preferred_generic_id: stockConfig?.is_stocked
                                  ? null
                                  : effectivePreferredGenericId || null,
                                reorder_point: stockConfig?.is_stocked
                                  ? null
                                  : (stockConfig?.reorder_point ?? null),
                              })
                            }
                          >
                            {stockConfig?.is_stocked ? '採用品から外す' : '採用品に登録'}
                          </LoadingButton>
                          <LoadingButton
                            type="button"
                            size="sm"
                            variant="outline"
                            loading={stockRequestMutation.isPending}
                            loadingLabel="申請中"
                            disabled={!effectiveSelectedSiteId || !!selectedPendingRequest}
                            onClick={() =>
                              stockRequestMutation.mutate({
                                site_id: effectiveSelectedSiteId,
                                drug_master_id: detailQuery.data.id,
                                action_type: stockConfig?.is_stocked ? 'deactivate' : 'adopt',
                                requested_payload: {
                                  is_stocked: !(stockConfig?.is_stocked ?? false),
                                  preferred_generic_id: stockConfig?.is_stocked
                                    ? null
                                    : effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.is_stocked
                                    ? null
                                    : (stockConfig?.reorder_point ?? null),
                                  adoption_note: stockConfig?.adoption_note ?? null,
                                },
                                reason: stockConfig?.is_stocked
                                  ? '採用品解除の承認依頼'
                                  : '採用品追加の承認依頼',
                              })
                            }
                          >
                            変更申請
                          </LoadingButton>
                        </div>
                      </div>

                      {(detailQuery.data.generic_name || preferredGenericCandidates.length > 0) && (
                        <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">採用後発薬</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              一般名 {detailQuery.data.generic_name ?? '未設定'}{' '}
                              に対する採用後発薬を設定します。
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
                          {genericRecommendations.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">
                                薬価順の推奨候補
                              </p>
                              <div className="space-y-2">
                                {genericRecommendations.slice(0, 3).map((candidate) => (
                                  <button
                                    key={candidate.id}
                                    type="button"
                                    className="w-full rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
                                    onClick={() => setPreferredGenericId(candidate.id)}
                                  >
                                    <span className="block text-sm font-medium text-foreground">
                                      {candidate.drug_name}
                                    </span>
                                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                      <span>{candidate.yj_code}</span>
                                      <span>
                                        {candidate.drug_price != null
                                          ? `¥${Number(candidate.drug_price).toFixed(1)}/${candidate.unit ?? ''}`
                                          : '薬価未設定'}
                                      </span>
                                      {candidate.price_delta != null && (
                                        <span
                                          className={
                                            candidate.price_delta < 0
                                              ? 'font-medium text-emerald-700'
                                              : 'font-medium text-amber-700'
                                          }
                                        >
                                          {candidate.price_delta < 0 ? '差額' : '増額'} ¥
                                          {Math.abs(candidate.price_delta).toFixed(1)}
                                        </span>
                                      )}
                                      {candidate.site_stock?.is_stocked && (
                                        <span className="font-medium text-emerald-700">
                                          採用済み
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
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

                      {(detailQuery.data.transitional_expiry_date ||
                        stockConfig?.follow_up_status) && (
                        <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              マスター変更フォロー
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              経過措置や薬価改定で採用品の切替・継続確認が必要な場合に状態を残します。
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                stockConfig?.follow_up_status === 'resolved'
                                  ? 'outline'
                                  : detailQuery.data.transitional_expiry_date
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="text-[10px]"
                            >
                              {stockConfig?.follow_up_status === 'resolved'
                                ? '対応済み'
                                : stockConfig?.follow_up_status === 'planned_switch'
                                  ? '切替予定'
                                  : stockConfig?.follow_up_status === 'monitoring'
                                    ? '経過観察'
                                    : '要確認'}
                            </Badge>
                            {detailQuery.data.transitional_expiry_date && (
                              <span className="text-xs text-muted-foreground">
                                経過措置期限:{' '}
                                {new Date(
                                  detailQuery.data.transitional_expiry_date,
                                ).toLocaleDateString('ja-JP')}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <LoadingButton
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={stockMutation.isPending}
                              loadingLabel="記録中"
                              disabled={!effectiveSelectedSiteId}
                              onClick={() =>
                                stockMutation.mutate({
                                  site_id: effectiveSelectedSiteId,
                                  drug_master_id: detailQuery.data.id,
                                  is_stocked: stockConfig?.is_stocked ?? true,
                                  preferred_generic_id: effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.reorder_point ?? null,
                                  follow_up_status: 'planned_switch',
                                  follow_up_reason: '経過措置またはマスター変更に伴う切替予定',
                                  follow_up_due_date:
                                    detailQuery.data.transitional_expiry_date ?? null,
                                })
                              }
                            >
                              切替予定にする
                            </LoadingButton>
                            <LoadingButton
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={stockMutation.isPending}
                              loadingLabel="記録中"
                              disabled={!effectiveSelectedSiteId}
                              onClick={() =>
                                stockMutation.mutate({
                                  site_id: effectiveSelectedSiteId,
                                  drug_master_id: detailQuery.data.id,
                                  is_stocked: stockConfig?.is_stocked ?? true,
                                  preferred_generic_id: effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.reorder_point ?? null,
                                  follow_up_status: 'resolved',
                                  follow_up_reason: '採用薬フォローアップ確認済み',
                                  follow_up_due_date: null,
                                })
                              }
                            >
                              対応済みにする
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
                            <span className="text-xs font-medium text-muted-foreground">
                              下限数量
                            </span>
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
                          現在値:{' '}
                          {stockConfig?.reorder_point != null
                            ? `${stockConfig.reorder_point}単位`
                            : '未設定'}
                        </p>
                      </div>
                    </div>
                  )}
                </PageSection>

                {ingredientGroup?.summary && (
                  <PageSection
                    title="同一成分グループ"
                    description="同一一般名の薬剤、後発品、採用済み数、薬価帯を比較します。"
                  >
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div className="grid gap-2 sm:grid-cols-4">
                        <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                          <p className="text-xs text-muted-foreground">同一一般名</p>
                          <p className="mt-1 text-lg font-semibold tabular-nums">
                            {ingredientGroup.summary.member_count.toLocaleString()}
                          </p>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                          <p className="text-xs text-muted-foreground">後発品</p>
                          <p className="mt-1 text-lg font-semibold tabular-nums">
                            {ingredientGroup.summary.generic_count.toLocaleString()}
                          </p>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                          <p className="text-xs text-muted-foreground">採用済み</p>
                          <p className="mt-1 text-lg font-semibold tabular-nums">
                            {ingredientGroup.summary.stocked_count.toLocaleString()}
                          </p>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                          <p className="text-xs text-muted-foreground">薬価帯</p>
                          <p className="mt-1 text-sm font-semibold">
                            {ingredientGroup.summary.lowest_price != null &&
                            ingredientGroup.summary.highest_price != null
                              ? `¥${ingredientGroup.summary.lowest_price.toFixed(1)}-¥${ingredientGroup.summary.highest_price.toFixed(1)}`
                              : '未設定'}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {ingredientGroup.members.slice(0, 5).map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                            onClick={() => {
                              setSelectedDrugId(member.id);
                              setPreferredGenericId(null);
                            }}
                          >
                            <span className="block text-sm font-medium text-foreground">
                              {member.drug_name}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{member.yj_code}</span>
                              <span>{member.is_generic ? '後発品' : '先発/準先発'}</span>
                              {member.drug_price != null && (
                                <span>
                                  ¥{Number(member.drug_price).toFixed(1)}/{member.unit ?? ''}
                                </span>
                              )}
                              {member.site_stock?.is_stocked ? (
                                <span className="font-medium text-emerald-700">採用済み</span>
                              ) : (
                                <span>未採用</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </PageSection>
                )}

                <PageSection
                  title="採用品変更履歴"
                  description="対象拠点での採用品変更、CSV反映、承認操作の直近履歴を確認します。"
                >
                  {!effectiveSelectedSiteId ? (
                    <p className="text-sm text-muted-foreground">
                      対象拠点を選択すると採用品の変更履歴を確認できます。
                    </p>
                  ) : stockHistoryQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">採用品履歴を読み込み中です…</p>
                  ) : stockHistory.length === 0 ? (
                    <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      この薬剤の採用品変更履歴はまだありません。
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                      {stockHistory.slice(0, 5).map((item) => {
                        const changes = readAuditObject(item.changes);
                        return (
                          <div
                            key={item.id}
                            className="rounded-md border border-border/60 bg-background px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {formatStockHistoryActionLabel(item.action)}
                              </p>
                              <Badge variant="outline" className="text-[10px]">
                                {new Date(item.created_at).toLocaleDateString('ja-JP')}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              操作者: {item.actor_id}
                            </p>
                            {Boolean(changes.row_number || changes.status) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                行 {String(changes.row_number ?? '—')} / 状態{' '}
                                {formatBulkPreviewStatusLabel(
                                  String(
                                    changes.status ?? '',
                                  ) as BulkPreviewResponse['preview']['rows'][number]['status'],
                                )}
                              </p>
                            )}
                            {Boolean(changes.summary) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                反映 {String(readAuditObject(changes.summary).processableRows ?? 0)}
                                件 / 未照合{' '}
                                {String(readAuditObject(changes.summary).unmatchedCount ?? 0)}件 /
                                無効 {String(readAuditObject(changes.summary).invalidCount ?? 0)}件
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </PageSection>

                <PageSection
                  title="薬剤基本情報・安全属性"
                  description="YJ/HOTコード、薬価、経過措置、高リスク・LASA属性を確認します。"
                  tone={
                    detailQuery.data.is_high_risk ||
                    detailQuery.data.outpatient_injection_eligible ||
                    detailQuery.data.is_lasa_risk ||
                    detailQuery.data.is_narcotic
                      ? 'warning'
                      : 'default'
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">YJ {detailQuery.data.yj_code}</Badge>
                    {detailQuery.data.hot_code && (
                      <Badge variant="outline">HOT {detailQuery.data.hot_code}</Badge>
                    )}
                    {detailQuery.data.is_generic && <Badge variant="outline">後発品</Badge>}
                    {detailQuery.data.is_narcotic && <Badge variant="destructive">麻薬</Badge>}
                    {detailQuery.data.is_psychotropic && (
                      <Badge variant="outline" className="border-orange-300 text-orange-700">
                        向精神
                      </Badge>
                    )}
                    {detailQuery.data.is_high_risk && (
                      <Badge variant="destructive">ハイリスク薬</Badge>
                    )}
                    {detailQuery.data.outpatient_injection_eligible && (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-800">
                        外来/在宅自己注射確認済み
                      </Badge>
                    )}
                    {detailQuery.data.is_lasa_risk && (
                      <Badge variant="outline" className="border-amber-300 text-amber-800">
                        LASA注意
                      </Badge>
                    )}
                  </div>
                  {(detailQuery.data.tall_man_name ||
                    detailQuery.data.is_lasa_risk ||
                    detailQuery.data.is_high_risk ||
                    detailQuery.data.outpatient_injection_eligible) && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                      <h2 className="font-semibold">薬剤名・高リスク確認</h2>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-medium text-amber-800">表示名</dt>
                          <dd className="mt-0.5 font-medium">
                            {detailQuery.data.tall_man_name ?? detailQuery.data.drug_name}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-amber-800">通常表記</dt>
                          <dd className="mt-0.5">{detailQuery.data.drug_name}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-amber-800">LASAグループ</dt>
                          <dd className="mt-0.5">{detailQuery.data.lasa_group_key ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-amber-800">安全属性</dt>
                          <dd className="mt-0.5">
                            {[
                              detailQuery.data.is_lasa_risk ? '類似薬剤名注意' : null,
                              detailQuery.data.is_high_risk ? '高リスク薬' : null,
                              detailQuery.data.outpatient_injection_eligible
                                ? '外来/在宅自己注射確認済み'
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' / ') || '—'}
                          </dd>
                        </div>
                        {detailQuery.data.outpatient_injection_note && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-medium text-amber-800">自己注射確認メモ</dt>
                            <dd className="mt-0.5">{detailQuery.data.outpatient_injection_note}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
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
                          ? new Date(detailQuery.data.transitional_expiry_date).toLocaleDateString(
                              'ja-JP',
                            )
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
                </PageSection>

                <PageSection
                  title="添付文書詳細"
                  description="禁忌、重大な副作用、腎機能別用量調整、高齢者への注意を確認します。"
                >
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
                </PageSection>

                <PageSection
                  title="相互作用一覧"
                  description="相互作用の重症度、対象薬剤、機序、臨床影響を確認します。"
                >
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
                </PageSection>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">一覧から医薬品を選択してください。</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </PageScaffold>
  );
}
