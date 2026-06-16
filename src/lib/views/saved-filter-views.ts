import { buildMyDayHref } from '@/lib/dashboard/home-link-builders';

/**
 * p1_01「よく使う絞り込み」(/views)のプリセット定義と、
 * me/preferences の saved_view(保存された絞り込み条件)の読み取り・表示射影。
 * プリセットは「実在する一覧ページ+クエリ」への遷移として純データで定義する(新 API なし)。
 */

/** saved_view 条件のフィールド一覧(API の zod スキーマと共有する SSOT)。 */
export const SAVED_VIEW_CONDITION_FIELDS = [
  'visit_date',
  'assignee',
  'supply_runout',
  'prescription_change',
  'schedule',
] as const;

export type SavedViewConditionField = (typeof SAVED_VIEW_CONDITION_FIELDS)[number];

export type SavedViewCondition = {
  field: SavedViewConditionField;
  value: string;
};

export type SavedView = {
  conditions: SavedViewCondition[];
  /** 保存日時(ISO 8601)。旧データには無い場合がある。 */
  savedAt?: string;
};

/** 条件チップの左側(「訪問日:」など)の表示名。 */
const CONDITION_FIELD_LABELS: Record<SavedViewConditionField, string> = {
  visit_date: '訪問日',
  assignee: '担当',
  supply_runout: '薬切れ',
  prescription_change: '処方変更',
  schedule: '予定',
};

/** 既知の条件値の表示名。未知の値は値をそのまま表示する(保存データの後方互換)。 */
const CONDITION_VALUE_LABELS: Partial<
  Record<SavedViewConditionField, Record<string, string>>
> = {
  visit_date: {
    today: '今日',
    today_to_this_week: '今日〜今週',
    this_week: '今週',
  },
  assignee: {
    me: '自分',
    all: '全員',
  },
  supply_runout: {
    within_3_days: '3日以内',
    within_7_days: '7日以内',
  },
  prescription_change: {
    changed: 'あり',
    none: 'なし',
  },
  schedule: {
    include_patient_confirmation: '患者確認待ちを含む',
  },
};

/** 条件 → チップ表示「訪問日:今日〜今週」への射影(区切りは全角コロン)。 */
export function formatConditionChipLabel(condition: SavedViewCondition): string {
  const fieldLabel = CONDITION_FIELD_LABELS[condition.field];
  const valueLabel =
    CONDITION_VALUE_LABELS[condition.field]?.[condition.value] ?? condition.value;
  return `${fieldLabel}:${valueLabel}`;
}

/** 保存済み条件が無いときに表示する初期条件(target p1_01 と同じ 5 チップ)。 */
export const DEFAULT_SAVED_VIEW_CONDITIONS: SavedViewCondition[] = [
  { field: 'visit_date', value: 'today_to_this_week' },
  { field: 'assignee', value: 'me' },
  { field: 'supply_runout', value: 'within_3_days' },
  { field: 'prescription_change', value: 'changed' },
  { field: 'schedule', value: 'include_patient_confirmation' },
];

function isConditionField(value: unknown): value is SavedViewConditionField {
  return (
    typeof value === 'string' &&
    (SAVED_VIEW_CONDITION_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * me/preferences の saved_view(JSON)を安全に読み取る。
 * 形が不正・既知の条件が 1 件も無いときは null(=未保存扱い)を返す。
 */
export function parseSavedView(raw: unknown): SavedView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.conditions)) return null;

  const conditions: SavedViewCondition[] = [];
  for (const item of record.conditions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    if (!isConditionField(candidate.field)) continue;
    if (typeof candidate.value !== 'string' || candidate.value.length === 0) continue;
    conditions.push({ field: candidate.field, value: candidate.value });
  }
  if (conditions.length === 0) return null;

  return {
    conditions,
    savedAt: typeof record.saved_at === 'string' ? record.saved_at : undefined,
  };
}

/* -------------------------------------------------------------------------- *
 * 名前付き保存ビュー (SavedView モデル) — W-CB-SAVED-VIEWS-MODEL (p1_01)
 *
 * me/preferences の単一 saved_view(「今の絞り込み条件」のクイック保存)とは別に、
 * ユーザーが任意の名前を付けて複数の絞り込み組合せを保存・呼び出し・共有できる。
 * filters/sort は「画面側が解釈する不透明な構造」(SavedView.filters Json)で、
 * ここでは API と FE が共有する型と (de)serialize のみを定義する。
 * -------------------------------------------------------------------------- */

/** 保存ビューの適用先(リスト/画面)。API の zod スキーマと共有する SSOT。 */
export const SAVED_VIEW_SCOPES = [
  'patients',
  'schedules',
  'notifications',
  'reports',
  'handoffs',
  'dispense',
] as const;

export type SavedViewScope = (typeof SAVED_VIEW_SCOPES)[number];

/** scope → 表示名(チップのグルーピング見出しや空状態の文言に使う)。 */
export const SAVED_VIEW_SCOPE_LABELS: Record<SavedViewScope, string> = {
  patients: '患者',
  schedules: 'スケジュール',
  notifications: '通知',
  reports: 'レポート',
  handoffs: '相談・引き継ぎ',
  dispense: '調剤',
};

export function isSavedViewScope(value: unknown): value is SavedViewScope {
  return (
    typeof value === 'string' && (SAVED_VIEW_SCOPES as readonly string[]).includes(value)
  );
}

/** filters/sort の不透明な構造。画面側が解釈するため任意の JSON を許容する。 */
export type SavedViewFilters = Record<string, unknown>;
export type SavedViewSort = Record<string, unknown> | null;

/** API 応答(GET/POST/PATCH)で受け取る保存ビュー 1 件の表示射影。 */
export type SavedViewRecord = {
  id: string;
  name: string;
  scope: SavedViewScope;
  filters: SavedViewFilters;
  sort: SavedViewSort;
  isShared: boolean;
  sortOrder: number;
  /** 自分のビューか(false = org 共有された他メンバーのビュー)。 */
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * filters の不透明 JSON を安全な plain object に正規化する。
 * 配列・スカラー・null は「フィルタなし」として空オブジェクトに落とす。
 */
export function normalizeSavedViewFilters(raw: unknown): SavedViewFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as SavedViewFilters) };
}

/** sort の不透明 JSON を正規化する。未設定・不正な形は null。 */
export function normalizeSavedViewSort(raw: unknown): SavedViewSort {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return { ...(raw as Record<string, unknown>) };
}

type SavedViewModelRow = {
  id: string;
  user_id: string;
  name: string;
  scope: string;
  filters: unknown;
  sort: unknown;
  is_shared: boolean;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * SavedView の Prisma 行 → API 応答用の表示射影。
 * 未知 scope はそのまま文字列として返す(後方互換: 画面側が無視できる)。
 */
export function toSavedViewRecord(
  row: SavedViewModelRow,
  currentUserId: string,
): SavedViewRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as SavedViewScope,
    filters: normalizeSavedViewFilters(row.filters),
    sort: normalizeSavedViewSort(row.sort),
    isShared: row.is_shared,
    sortOrder: row.sort_order,
    isOwner: row.user_id === currentUserId,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export type SavedViewPresetId = 'morning_check' | 'set_team' | 'clerk_check' | 'manager';

export type SavedViewPreset = {
  id: SavedViewPresetId;
  /** カード見出し(「朝の確認」など)。 */
  title: string;
  /** カード内の条件サマリ(「本日訪問 / 未完了 / 薬切れ近い」)。 */
  conditionSummary: string;
  /** 「使う」の遷移先(実在する一覧ルート+クエリ)。 */
  href: string;
};

/**
 * プリセット 4 枚(target p1_01 の 2×2 グリッド)。
 * 遷移先はクエリ対応を調査のうえ最も近い実在一覧へ割り当てる:
 * - 朝の確認 → /my-day(私の今日): focus=visits & visit_filter=unprepared
 *   (担当=自分の本日訪問+準備未完了。「薬切れ近い」は既存一覧に
 *    対応するクエリが無いため未反映 = known difference)
 * - セット担当 → /set(セット準備ワークスペース+鑑査待ち一覧が同一ページ)
 * - 事務で確認 → /clerk-support(KPI: 日程確認=患者確認待ち相当 / 送付先未設定)
 * - 管理者用 → /dashboard(コックピット: 工程の今=滞留 / 止まっている理由=ブロッカー /
 *   チームの余白=負荷)
 */
export const SAVED_VIEW_PRESETS: SavedViewPreset[] = [
  {
    id: 'morning_check',
    title: '朝の確認',
    conditionSummary: '本日訪問 / 未完了 / 薬切れ近い',
    href: buildMyDayHref({ focus: 'visits', visitFilter: 'unprepared' }),
  },
  {
    id: 'set_team',
    title: 'セット担当',
    conditionSummary: 'セット準備 / セット監査待ち',
    href: '/set',
  },
  {
    id: 'clerk_check',
    title: '事務で確認',
    conditionSummary: '患者確認待ち / 送付先未設定',
    href: '/clerk-support',
  },
  {
    id: 'manager',
    title: '管理者用',
    conditionSummary: '滞留 / ブロッカーあり / 負荷高い',
    href: '/dashboard',
  },
];
