export type SettingFieldType = 'text' | 'number' | 'select' | 'boolean';

export type SettingOption = {
  value: string;
  label: string;
};

export type SettingScope = 'system' | 'organization' | 'site' | 'user';

export type SettingCatalogItem = {
  key: string;
  label: string;
  description?: string;
  defaultValue: string;
  type: SettingFieldType;
  options?: SettingOption[];
  storage: 'setting' | 'organization' | 'site';
  /** type: 'number' のみ有効。コンプライアンス上の下限（3省2GL等）。 */
  min?: number;
  /** type: 'number' のみ有効。コンプライアンス上の上限（3省2GL等）。 */
  max?: number;
};

export const SETTING_CATALOG: Record<SettingScope, SettingCatalogItem[]> = {
  system: [
    {
      key: 'session_timeout_minutes',
      label: 'セッションタイムアウト',
      description: '分単位（3省2GL準拠: 5〜30分）',
      defaultValue: '30',
      type: 'number',
      storage: 'setting',
      min: 5,
      max: 30,
    },
    {
      key: 'mfa_required',
      label: 'MFA強制',
      description: 'ログイン時の多要素認証',
      defaultValue: 'true',
      type: 'boolean',
      storage: 'setting',
      options: [
        { value: 'true', label: '必須' },
        { value: 'false', label: '任意' },
      ],
    },
    {
      key: 'audit_log_retention_days',
      label: '監査ログ保持期間',
      description: '日数（3省2GL準拠: 365〜3650日）',
      defaultValue: '365',
      type: 'number',
      storage: 'setting',
      min: 365,
      max: 3650,
    },
    {
      key: 'password_min_length',
      label: 'パスワード最小文字数',
      description: '文字数（3省2GL準拠: 12〜128文字）',
      defaultValue: '12',
      type: 'number',
      storage: 'setting',
      min: 12,
      max: 128,
    },
  ],
  organization: [
    {
      key: 'org_name',
      label: '法人名',
      defaultValue: '',
      type: 'text',
      storage: 'organization',
    },
    {
      key: 'corporate_number',
      label: '法人番号',
      defaultValue: '',
      type: 'text',
      storage: 'organization',
    },
    {
      key: 'default_billing_rule',
      label: 'デフォルト算定ルール',
      defaultValue: 'medical',
      type: 'select',
      storage: 'setting',
      options: [
        { value: 'medical', label: '医療保険' },
        { value: 'care', label: '介護保険' },
      ],
    },
    {
      key: 'notification_email',
      label: '通知先メールアドレス',
      defaultValue: '',
      type: 'text',
      storage: 'setting',
    },
  ],
  site: [
    {
      key: 'site_name',
      label: '店舗名',
      defaultValue: '',
      type: 'text',
      storage: 'site',
    },
    {
      key: 'opening_hours',
      label: '営業時間',
      defaultValue: '09:00-19:00',
      type: 'text',
      storage: 'setting',
    },
    {
      key: 'dispensing_fee_category',
      label: '調剤基本料区分',
      defaultValue: '1',
      type: 'select',
      storage: 'site',
      options: [
        { value: '1', label: '調剤基本料1' },
        { value: '3', label: '調剤基本料3' },
      ],
    },
    {
      key: 'is_health_support_pharmacy',
      label: '健康サポート薬局',
      defaultValue: 'false',
      type: 'boolean',
      storage: 'site',
      options: [
        { value: 'true', label: '届出あり' },
        { value: 'false', label: '届出なし' },
      ],
    },
  ],
  user: [
    {
      key: 'display_language',
      label: '表示言語',
      defaultValue: 'ja',
      type: 'select',
      storage: 'setting',
      options: [{ value: 'ja', label: '日本語' }],
    },
    {
      key: 'notification_email_enabled',
      label: 'メール通知',
      defaultValue: 'true',
      type: 'boolean',
      storage: 'setting',
      options: [
        { value: 'true', label: '有効' },
        { value: 'false', label: '無効' },
      ],
    },
    {
      key: 'default_page',
      label: 'ログイン後の初期ページ',
      defaultValue: '/today',
      type: 'text',
      storage: 'setting',
    },
    {
      key: 'rows_per_page',
      label: '一覧の表示件数',
      defaultValue: '50',
      type: 'number',
      storage: 'setting',
    },
  ],
};

// 設定スコープは「状態」ではなく識別メタ情報。警告色(赤/橙)を非警告に流用しないよう中立トークンで統一し、
// スコープの区別はラベル(システム/法人/店舗/個人)で担う(SSOT §2: 状態色は状態にのみ、生 Tailwind 状態色禁止)。
const SCOPE_BADGE_NEUTRAL = 'bg-muted text-muted-foreground border-border';
export const SCOPE_LABELS: Record<SettingScope, { label: string; badge: string }> = {
  system: { label: 'システム', badge: SCOPE_BADGE_NEUTRAL },
  organization: { label: '法人', badge: SCOPE_BADGE_NEUTRAL },
  site: { label: '店舗', badge: SCOPE_BADGE_NEUTRAL },
  user: { label: '個人', badge: SCOPE_BADGE_NEUTRAL },
};

export type SettingValueItem = {
  key: string;
  label: string;
  description?: string;
  value: string;
  type: SettingFieldType;
  options?: SettingOption[];
  min?: number;
  max?: number;
};

export function stringifySettingValue(value: unknown, fallbackValue: string) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallbackValue;
}

export function parseSettingInputValue(
  type: SettingFieldType,
  value: string,
): string | number | boolean {
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (type === 'boolean') {
    return value === 'true';
  }
  return value;
}

/**
 * コンプライアンス上の min/max レンジを持つ数値設定を検証する。
 * server(API保存時の拒否)・client(入力中のインライン表示)の両方から共用する SSOT。
 * type !== 'number' または min/max 未定義の項目は常に null（対象外）を返す。
 * 既存値の読み取り（GET）はこの関数を通さないため、レンジ外の保存済み値も表示は許容される。
 */
export function getSettingRangeError(
  item: Pick<SettingCatalogItem, 'type' | 'min' | 'max' | 'label'>,
  rawValue: string,
): string | null {
  if (item.type !== 'number') return null;
  if (item.min === undefined && item.max === undefined) return null;

  const parsed = Number(rawValue);
  if (rawValue.trim() === '' || !Number.isFinite(parsed)) {
    return `${item.label}は数値で入力してください`;
  }
  if (item.min !== undefined && parsed < item.min) {
    return `${item.label}は${item.min}以上で入力してください`;
  }
  if (item.max !== undefined && parsed > item.max) {
    return `${item.label}は${item.max}以下で入力してください`;
  }
  return null;
}
