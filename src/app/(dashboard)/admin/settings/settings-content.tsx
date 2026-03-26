'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// --- Types ---

type SettingItem = {
  key: string;
  label: string;
  description?: string;
  value: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  options?: { value: string; label: string }[];
};

type SettingScope = 'system' | 'organization' | 'site' | 'user';

// --- Sample settings ---

const SETTINGS: Record<SettingScope, SettingItem[]> = {
  system: [
    { key: 'session_timeout_minutes', label: 'セッションタイムアウト', description: '分単位（3省2GL準拠: 最大30分）', value: '30', type: 'number' },
    { key: 'mfa_required', label: 'MFA強制', description: 'ログイン時の多要素認証', value: 'true', type: 'boolean', options: [{ value: 'true', label: '必須' }, { value: 'false', label: '任意' }] },
    { key: 'audit_log_retention_days', label: '監査ログ保持期間', description: '日数（最低365日）', value: '365', type: 'number' },
    { key: 'password_min_length', label: 'パスワード最小文字数', value: '12', type: 'number' },
  ],
  organization: [
    { key: 'org_name', label: '法人名', value: '株式会社CareViaX薬局', type: 'text' },
    { key: 'corporate_number', label: '法人番号', value: '1234567890123', type: 'text' },
    { key: 'default_billing_rule', label: 'デフォルト算定ルール', value: 'medical', type: 'select', options: [{ value: 'medical', label: '医療保険' }, { value: 'care', label: '介護保険' }] },
    { key: 'notification_email', label: '通知先メールアドレス', value: 'admin@careviax.example', type: 'text' },
  ],
  site: [
    { key: 'site_name', label: '店舗名', value: 'CareViaX薬局 本店', type: 'text' },
    { key: 'opening_hours', label: '営業時間', value: '09:00-19:00', type: 'text' },
    { key: 'dispensing_fee_category', label: '調剤基本料区分', value: '1', type: 'select', options: [{ value: '1', label: '調剤基本料1' }, { value: '3', label: '調剤基本料3' }] },
    { key: 'is_health_support_pharmacy', label: '健康サポート薬局', value: 'true', type: 'boolean', options: [{ value: 'true', label: '届出あり' }, { value: 'false', label: '届出なし' }] },
  ],
  user: [
    { key: 'display_language', label: '表示言語', value: 'ja', type: 'select', options: [{ value: 'ja', label: '日本語' }] },
    { key: 'notification_email_enabled', label: 'メール通知', value: 'true', type: 'boolean', options: [{ value: 'true', label: '有効' }, { value: 'false', label: '無効' }] },
    { key: 'default_page', label: 'ログイン後の初期ページ', value: '/today', type: 'text' },
    { key: 'rows_per_page', label: '一覧の表示件数', value: '50', type: 'number' },
  ],
};

const SCOPE_LABELS: Record<SettingScope, { label: string; badge: string }> = {
  system: { label: 'システム', badge: 'bg-red-100 text-red-800 border-red-200' },
  organization: { label: '法人', badge: 'bg-orange-100 text-orange-800 border-orange-200' },
  site: { label: '店舗', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  user: { label: '個人', badge: 'bg-green-100 text-green-800 border-green-200' },
};

// --- Components ---

function SettingRow({
  item,
  onChange,
}: {
  item: SettingItem;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-border py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <Label htmlFor={`setting-${item.key}`} className="text-sm font-medium">
          {item.label}
        </Label>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        )}
        <p className="mt-0.5 font-mono text-xs text-muted-foreground/60">{item.key}</p>
      </div>
      <div className="w-48 shrink-0">
        {item.type === 'select' || item.type === 'boolean' ? (
          <Select
            value={item.value}
            onValueChange={(v) => onChange(item.key, v ?? item.value)}
          >
            <SelectTrigger id={`setting-${item.key}`} className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(item.options ?? []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={`setting-${item.key}`}
            type={item.type === 'number' ? 'number' : 'text'}
            value={item.value}
            onChange={(e) => onChange(item.key, e.target.value)}
            className="h-8 text-sm"
          />
        )}
      </div>
    </div>
  );
}

function ScopePanel({ scope, items }: { scope: SettingScope; items: SettingItem[] }) {
  const [localItems, setLocalItems] = useState<SettingItem[]>(items);
  const [dirty, setDirty] = useState(false);

  function handleChange(key: string, value: string) {
    setLocalItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, value } : item))
    );
    setDirty(true);
  }

  function handleSave() {
    setDirty(false);
    toast.success(`${SCOPE_LABELS[scope].label}設定を保存しました`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className={`text-xs ${SCOPE_LABELS[scope].badge}`}>
          {SCOPE_LABELS[scope].label}
        </Badge>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty}
        >
          <Save className="mr-1.5 size-3.5" aria-hidden="true" />
          保存
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 px-4">
          {localItems.map((item) => (
            <SettingRow key={item.key} item={item} onChange={handleChange} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main ---

export function SettingsContent() {
  return (
    <Tabs defaultValue="system">
      <TabsList className="mb-4">
        {(Object.keys(SETTINGS) as SettingScope[]).map((scope) => (
          <TabsTrigger key={scope} value={scope}>
            {SCOPE_LABELS[scope].label}
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.entries(SETTINGS) as [SettingScope, SettingItem[]][]).map(([scope, items]) => (
        <TabsContent key={scope} value={scope}>
          <ScopePanel scope={scope} items={items} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
