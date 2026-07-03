import { formatFormularyRequestActionLabel } from './drug-master-formulary-view-model';
import type {
  DrugMasterDetail,
  DrugMasterImportLog,
  FormularyExportPurpose,
  FormularyRequestDecisionTarget,
  FormularyTemplateItem,
  ImportAction,
  OfficialImportPreviewData,
} from './drug-master-content-types';

export const DRUG_MASTER_SEARCH_DEBOUNCE_MS = 250;

export const EXPORT_PURPOSE_LABELS: Record<FormularyExportPurpose, string> = {
  operations: '運用台帳',
  audit: '監査',
  posting: '掲示用',
  pharmacist_review: '薬剤師レビュー',
};

export function formatFormularyTemplateSummary(template: FormularyTemplateItem | null) {
  if (!template) return '選択中の採用品テンプレート';
  return `${template.name}（${template.item_count.toLocaleString()}件）`;
}

export function readAuditObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formatFormularyRequestDecisionDescription(
  target: FormularyRequestDecisionTarget,
): string {
  const request = target.request;
  const actionLabel = formatFormularyRequestActionLabel(request.action_type);
  const payloadText = JSON.stringify(request.requested_payload, null, 2) ?? 'null';
  const decisionLabel = target.decision === 'approve' ? '承認' : '却下';

  return [
    `${actionLabel}申請を${decisionLabel}します。`,
    `薬剤ID: ${request.drug_master_id}`,
    `拠点ID: ${request.site_id}`,
    `申請日: ${new Date(request.created_at).toLocaleDateString('ja-JP')}`,
    `理由: ${request.reason ?? '未入力'}`,
    `申請内容: ${payloadText}`,
  ].join('\n');
}

export const CATEGORY_OPTIONS = [
  { value: '', label: '全薬効分類' },
  { value: '1', label: '1: 神経系及び感覚器官用医薬品' },
  { value: '2', label: '2: 個々の器官系用医薬品' },
  { value: '3', label: '3: 代謝性医薬品' },
  { value: '4', label: '4: 組織細胞機能用医薬品' },
  { value: '5', label: '5: 生薬及び漢方処方に基づく医薬品' },
  { value: '6', label: '6: 病原生物に対する医薬品' },
  { value: '7', label: '7: 治療を主目的としない医薬品' },
] as const;

export const REORDER_POINT_ERROR_MESSAGE = '在庫下限は 0 以上の整数で入力してください';
export const REORDER_POINT_HELP_ID = 'drug-master-reorder-point-help';
export const REORDER_POINT_ERROR_ID = 'drug-master-reorder-point-error';
export const CLIPBOARD_COPY_ERROR_MESSAGE = 'クリップボードにコピーできませんでした';

export type ParsedReorderPointInput =
  | {
      ok: true;
      value: number | null;
    }
  | {
      ok: false;
    };

export function parseReorderPointInput(rawValue: string): ParsedReorderPointInput {
  const value = rawValue.trim();
  if (!value) {
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(value)) {
    return { ok: false };
  }
  const parsedValue = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsedValue) ? { ok: true, value: parsedValue } : { ok: false };
}

export async function copyTextToClipboard(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error(CLIPBOARD_COPY_ERROR_MESSAGE);
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    throw new Error(CLIPBOARD_COPY_ERROR_MESSAGE);
  }
}

export const INTERACTION_SEVERITY_LABEL: Record<
  DrugMasterDetail['interactions_as_a'][number]['severity'],
  string
> = {
  contraindicated: '併用禁忌',
  caution: '併用注意',
  minor: '参考',
};

export const IMPORT_ACTIONS: Array<{
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

export const IMPORT_SOURCE_LABEL: Record<DrugMasterImportLog['source'], string> = {
  ssk: 'SSK',
  pmda: 'PMDA',
  mhlw_price: 'MHLW薬価',
  mhlw_generic: '一般名/後発',
  hot: 'HOT',
  manual_clinical: '手動臨床ルール',
};

export const IMPORT_LOG_SOURCE_OPTIONS: Array<{
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

export const IMPORT_LOG_STATUS_OPTIONS: Array<{
  value: 'all' | DrugMasterImportLog['status'];
  label: string;
}> = [
  { value: 'all', label: 'すべての状態' },
  { value: 'failed', label: '失敗のみ' },
  { value: 'running', label: '実行中' },
  { value: 'completed', label: '完了' },
  { value: 'pending', label: '待機' },
];

export function formatImportSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

export function formatImportSourceHash(value: string) {
  return value.length > 12 ? value.slice(0, 12) : value;
}

export function formatImportPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ja-JP');
}

export function formatImportMode(value: string) {
  if (value === 'full') return '全件';
  if (value === 'delta') return '差分';
  if (value === 'manual') return '手動';
  return value;
}

export function readImportSummaryNumber(summary: unknown, key: string) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const value = (summary as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatImportChangeSummary(summary: unknown) {
  const parsed = readImportSummaryNumber(summary, 'parsed_records');
  const imported = readImportSummaryNumber(summary, 'imported_records');
  const changes = readImportSummaryNumber(summary, 'change_event_count');
  const skippedMissingYj = readImportSummaryNumber(summary, 'skipped_missing_yj');
  const skippedUnmatchedPrimary = readImportSummaryNumber(
    summary,
    'skipped_unmatched_primary_records',
  );
  const workbookCount = readImportSummaryNumber(summary, 'workbook_count');
  const parts: string[] = [];

  if (workbookCount != null) parts.push(`file ${workbookCount.toLocaleString()}件`);
  if (parsed != null) parts.push(`解析 ${parsed.toLocaleString()}件`);
  if (imported != null) parts.push(`反映 ${imported.toLocaleString()}件`);
  if (changes != null) parts.push(`差分 ${changes.toLocaleString()}件`);
  const skipped = (skippedMissingYj ?? 0) + (skippedUnmatchedPrimary ?? 0);
  if (skipped > 0) parts.push(`skip ${skipped.toLocaleString()}件`);

  return parts.length > 0 ? parts.join(' / ') : null;
}

export function pushOfficialPreviewCountPart(
  parts: string[],
  summary: unknown,
  key: string,
  label: string,
) {
  const value = readImportSummaryNumber(summary, key);
  if (value != null && value > 0) parts.push(`${label} ${value.toLocaleString()}件`);
}

export function formatOfficialImportPreviewSummary(summary: unknown) {
  const parts: string[] = [];

  pushOfficialPreviewCountPart(parts, summary, 'workbook_count', 'file');
  pushOfficialPreviewCountPart(parts, summary, 'parsed_records', '解析');
  pushOfficialPreviewCountPart(parts, summary, 'drug_master_upsert_count', 'DrugMaster');
  pushOfficialPreviewCountPart(parts, summary, 'package_upsert_count', '包装');
  pushOfficialPreviewCountPart(parts, summary, 'create_count', '作成');
  pushOfficialPreviewCountPart(parts, summary, 'update_count', '更新');
  pushOfficialPreviewCountPart(parts, summary, 'unchanged_count', '変更なし');
  pushOfficialPreviewCountPart(parts, summary, 'generic_mapping_replace_count', 'mapping');
  pushOfficialPreviewCountPart(parts, summary, 'brand_candidate_count', '候補');
  pushOfficialPreviewCountPart(parts, summary, 'changed_flag_count', 'フラグ変更');
  pushOfficialPreviewCountPart(parts, summary, 'change_event_count', '差分');
  pushOfficialPreviewCountPart(parts, summary, 'matched_interaction_pair_count', '相互作用');
  pushOfficialPreviewCountPart(parts, summary, 'skipped_invalid_yj', 'invalid YJ');
  pushOfficialPreviewCountPart(parts, summary, 'skipped_missing_yj', 'YJ欠損');
  pushOfficialPreviewCountPart(parts, summary, 'skipped_package_conflict_count', '包装競合');
  pushOfficialPreviewCountPart(parts, summary, 'skipped_unmatched_primary_records', '未照合');
  pushOfficialPreviewCountPart(parts, summary, 'sampled_rows', 'sample');

  return parts.length > 0 ? parts.join(' / ') : '差分なし';
}

export function readPreviewRowField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

export function formatOfficialImportPreviewRow(row: unknown) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return String(row);
  const record = row as Record<string, unknown>;
  const parts = [
    ['action', 'action'],
    ['yj_code', 'YJ'],
    ['drug_name', '薬品'],
    ['generic_name', '一般名'],
    ['standard_name', '標準名'],
    ['brand_candidate_count', '候補'],
  ]
    .map(([key, label]) => {
      const value = readPreviewRowField(record, key);
      return value ? `${label} ${value}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(' / ') : JSON.stringify(row);
}

export function collectOfficialImportPreviewGroups(preview: OfficialImportPreviewData | null) {
  if (!preview) return [];

  const groups: Array<{ key: string; label: string; summary: unknown; rows: unknown[] }> = [];
  if (preview.preview?.summary) {
    groups.push({
      key: 'main',
      label: '取込プレビュー',
      summary: preview.preview.summary,
      rows: preview.preview.rows ?? [],
    });
  }
  if (preview.flags?.preview?.summary) {
    groups.push({
      key: 'flags',
      label: '後発フラグ',
      summary: preview.flags.preview.summary,
      rows: preview.flags.preview.rows ?? [],
    });
  }
  if (preview.mappings?.preview?.summary) {
    groups.push({
      key: 'mappings',
      label: '一般名mapping',
      summary: preview.mappings.preview.summary,
      rows: preview.mappings.preview.rows ?? [],
    });
  }

  return groups;
}
