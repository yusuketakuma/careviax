'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';

type DeliveryChannel = 'email' | 'fax' | 'mcs';

type DocumentDeliveryRuleRow = {
  id: string;
  document_type: string;
  target_role: string;
  channel: DeliveryChannel;
  fallback_channels: string[] | null;
  is_active: boolean;
};

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'care_report', label: '報告書' },
  { value: 'tracing_report', label: 'トレーシングレポート' },
  { value: 'management_plan', label: '計画書' },
  { value: 'contract_document', label: '契約書' },
  { value: 'important_matters', label: '重要事項説明書' },
  { value: 'privacy_consent', label: '個人情報同意書' },
  { value: 'consent_form', label: '同意書' },
] as const;

const TARGET_ROLE_OPTIONS = [
  { value: 'physician', label: '医師' },
  { value: 'care_manager', label: 'ケアマネ' },
  { value: 'facility_staff', label: '施設職員' },
  { value: 'nurse', label: '訪看/看護師' },
  { value: 'family', label: '家族' },
  { value: 'patient_family', label: '本人/家族' },
  { value: 'other', label: 'その他' },
] as const;

const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  email: 'メール',
  fax: 'FAX',
  mcs: 'MCS',
};

const EMPTY_FORM = {
  id: '',
  documentType: 'care_report',
  targetRole: 'physician',
  channel: 'fax' as DeliveryChannel,
  fallbackChannelsText: 'email',
  isActive: true,
};

function normalizeFallbackChannels(input: string, primaryChannel: DeliveryChannel) {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(
          (value): value is DeliveryChannel =>
            value === 'email' || value === 'fax' || value === 'mcs',
        )
        .filter((value) => value !== primaryChannel),
    ),
  );
}

export function DocumentDeliveryRuleManager() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);

  const rulesQuery = useQuery({
    queryKey: ['document-delivery-rules', orgId],
    queryFn: async () => {
      const res = await fetch('/api/document-delivery-rules', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('文書送達ルールの取得に失敗しました');
      }
      return res.json() as Promise<{ data: DocumentDeliveryRuleRow[] }>;
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fallbackChannels = normalizeFallbackChannels(form.fallbackChannelsText, form.channel);
      const res = await fetch(
        form.id ? `/api/document-delivery-rules/${form.id}` : '/api/document-delivery-rules',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            document_type: form.documentType,
            target_role: form.targetRole,
            channel: form.channel,
            fallback_channels: fallbackChannels,
            is_active: form.isActive,
          }),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '文書送達ルールの保存に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success(form.id ? '文書送達ルールを更新しました' : '文書送達ルールを登録しました');
      setForm(EMPTY_FORM);
      await queryClient.invalidateQueries({ queryKey: ['document-delivery-rules', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '文書送達ルールの保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetch(`/api/document-delivery-rules/${ruleId}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('文書送達ルールの削除に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success('文書送達ルールを削除しました');
      if (form.id) {
        setForm(EMPTY_FORM);
      }
      await queryClient.invalidateQueries({ queryKey: ['document-delivery-rules', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '文書送達ルールの削除に失敗しました');
    },
  });

  const rules = rulesQuery.data?.data ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? '送達ルールを編集' : '送達ルールを登録'}
          </CardTitle>
          <CardDescription>
            文書種別と相手ロールごとに、既定チャネルとフォールバック順を定義します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delivery-document-type">文書種別</Label>
            <Select
              value={form.documentType}
              onValueChange={(value) =>
                value && setForm((current) => ({ ...current, documentType: value }))
              }
            >
              <SelectTrigger id="delivery-document-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivery-target-role">送達先ロール</Label>
            <Select
              value={form.targetRole}
              onValueChange={(value) =>
                value && setForm((current) => ({ ...current, targetRole: value }))
              }
            >
              <SelectTrigger id="delivery-target-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivery-channel">既定チャネル</Label>
            <Select
              value={form.channel}
              onValueChange={(value) =>
                value && setForm((current) => ({ ...current, channel: value as DeliveryChannel }))
              }
            >
              <SelectTrigger id="delivery-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivery-fallback">フォールバック順</Label>
            <Input
              id="delivery-fallback"
              value={form.fallbackChannelsText}
              onChange={(event) =>
                setForm((current) => ({ ...current, fallbackChannelsText: event.target.value }))
              }
              placeholder="email,mcs"
            />
            <p className="text-xs text-muted-foreground">
              `email,fax,mcs` をカンマ区切りで入力します。既定チャネルは自動除外されます。
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">有効化</p>
              <p className="text-xs text-muted-foreground">
                無効にするとこの組み合わせでは自動提案しません
              </p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, isActive: checked }))
              }
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? '保存中...' : form.id ? '更新する' : '登録する'}
            </Button>
            {form.id ? (
              <Button variant="outline" onClick={() => setForm(EMPTY_FORM)}>
                キャンセル
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">送達ルール一覧</CardTitle>
          <CardDescription>
            報告書詳細画面では、この設定を優先して送達チャネル候補を並べます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">文書送達ルールはまだありません。</p>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-border/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {DOCUMENT_TYPE_OPTIONS.find((option) => option.value === rule.document_type)
                        ?.label ?? rule.document_type}
                    </p>
                    <Badge variant="outline">
                      {TARGET_ROLE_OPTIONS.find((option) => option.value === rule.target_role)
                        ?.label ?? rule.target_role}
                    </Badge>
                    <Badge>{CHANNEL_LABELS[rule.channel] ?? rule.channel}</Badge>
                    <Badge variant={rule.is_active ? 'default' : 'outline'}>
                      {rule.is_active ? '有効' : '停止'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          id: rule.id,
                          documentType: rule.document_type,
                          targetRole: rule.target_role,
                          channel: rule.channel,
                          fallbackChannelsText: (rule.fallback_channels ?? []).join(','),
                          isActive: rule.is_active,
                        })
                      }
                    >
                      編集
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      disabled={deleteMutation.isPending}
                    >
                      削除
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  フォールバック:{' '}
                  {(rule.fallback_channels ?? []).length > 0
                    ? (rule.fallback_channels ?? []).join(' → ')
                    : 'なし'}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
