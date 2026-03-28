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
};

export const SETTING_CATALOG: Record<SettingScope, SettingCatalogItem[]> = {
  system: [
    {
      key: 'session_timeout_minutes',
      label: 'セッションタイムアウト',
      description: '分単位（3省2GL準拠: 最大30分）',
      defaultValue: '30',
      type: 'number',
      storage: 'setting',
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
      description: '日数（最低365日）',
      defaultValue: '365',
      type: 'number',
      storage: 'setting',
    },
    {
      key: 'password_min_length',
      label: 'パスワード最小文字数',
      defaultValue: '12',
      type: 'number',
      storage: 'setting',
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

export const SCOPE_LABELS: Record<SettingScope, { label: string; badge: string }> = {
  system: { label: 'システム', badge: 'bg-red-100 text-red-800 border-red-200' },
  organization: { label: '法人', badge: 'bg-orange-100 text-orange-800 border-orange-200' },
  site: { label: '店舗', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  user: { label: '個人', badge: 'bg-green-100 text-green-800 border-green-200' },
};

export type SettingValueItem = {
  key: string;
  label: string;
  description?: string;
  value: string;
  type: SettingFieldType;
  options?: SettingOption[];
};

export function stringifySettingValue(value: unknown, fallbackValue: string) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallbackValue;
}

export function parseSettingInputValue(type: SettingFieldType, value: string): string | number | boolean {
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (type === 'boolean') {
    return value === 'true';
  }
  return value;
}
