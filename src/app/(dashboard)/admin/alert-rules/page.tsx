'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminAlertRulesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { parseJsonObjectText } from '@/lib/admin/json-editor';

type DrugAlertRule = {
  id: string;
  org_id: string | null;
  alert_type: string;
  condition: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  is_active: boolean;
  updated_at: string;
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  interaction: '相互作用',
  duplicate: '重複投薬',
  allergy_cross: 'アレルギー交差',
  renal_dose: '腎機能用量',
  pim_elderly: '高齢者 PIM',
  high_risk: 'ハイリスク薬',
  narcotic: '麻薬・向精神薬',
  max_days: '投与日数上限',
};

export default function AlertRulesPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    id: '',
    alert_type: 'interaction',
    severity: 'warning',
    is_active: true,
    message: '',
    conditionText: '{}',
  });
  const [testCycleId, setTestCycleId] = useState('');

  const rulesQuery = useQuery({
    queryKey: ['drug-alert-rules', orgId],
    queryFn: async () => {
      const res = await fetch('/api/drug-alert-rules', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('処方安全アラートルールの取得に失敗しました');
      return res.json() as Promise<{ data: DrugAlertRule[] }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedCondition = parseJsonObjectText(
        form.conditionText,
        '条件(JSON) の形式が不正です',
      );

      const res = await fetch(
        form.id ? `/api/drug-alert-rules/${form.id}` : '/api/drug-alert-rules',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            alert_type: form.alert_type,
            severity: form.severity,
            is_active: form.is_active,
            message: form.message,
            condition: parsedCondition,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '処方安全アラートルールの保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success(
        form.id ? '処方安全アラートルールを更新しました' : '処方安全アラートルールを登録しました',
      );
      setForm({
        id: '',
        alert_type: 'interaction',
        severity: 'warning',
        is_active: true,
        message: '',
        conditionText: '{}',
      });
      await queryClient.invalidateQueries({ queryKey: ['drug-alert-rules', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/drug-alert-rules/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('削除に失敗しました');
    },
    onSuccess: async () => {
      toast.success('処方安全アラートルールを削除しました');
      await queryClient.invalidateQueries({ queryKey: ['drug-alert-rules', orgId] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/cds/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ cycleId: testCycleId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '処方安全チェックの実行に失敗しました',
        );
      }
      return payload as { alerts: Array<{ message: string; severity: string }> };
    },
    onSuccess: (payload) => {
      toast.success(`テスト実行完了: ${payload.alerts.length}件のアラート`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'テスト実行に失敗しました');
    },
  });

  const rules = rulesQuery.data?.data ?? [];

  return (
    <PageScaffold>
      <AdminPageHeader
        title="処方安全アラートルール"
        description="相互作用、重複、高齢者 PIM などのルールを ON/OFF と条件 JSON で管理します。"
        shortcuts={getAdminAlertRulesShortcutLinks()}
      />

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <PageSection
          title={form.id ? 'ルールを編集' : 'ルールを登録'}
          description="空条件 `{}` でも種別単位の ON/OFF ルールとして利用できます。"
          contentClassName="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="alert_type">アラート種別</Label>
            <select
              id="alert_type"
              value={form.alert_type}
              onChange={(event) =>
                setForm((current) => ({ ...current, alert_type: event.target.value }))
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="severity">重要度</Label>
            <select
              id="severity"
              value={form.severity}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  severity: event.target.value as 'critical' | 'warning' | 'info',
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="critical">critical</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <Label htmlFor="alert-rule-active" className="text-sm font-medium">
                有効化
              </Label>
              <p className="text-xs text-muted-foreground">
                OFF にするとこのルールは実行対象から外れます
              </p>
            </div>
            <Switch
              id="alert-rule-active"
              checked={form.is_active}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, is_active: checked }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">表示メッセージ</Label>
            <Input
              id="message"
              value={form.message}
              onChange={(event) =>
                setForm((current) => ({ ...current, message: event.target.value }))
              }
              placeholder="例: 併用禁忌候補を再確認してください"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="condition">条件(JSON)</Label>
            <Textarea
              id="condition"
              rows={8}
              className="font-mono text-xs"
              value={form.conditionText}
              onChange={(event) =>
                setForm((current) => ({ ...current, conditionText: event.target.value }))
              }
            />
          </div>

          <ActionRail align="start">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? '保存中...' : form.id ? '更新する' : '登録する'}
            </Button>
            {form.id ? (
              <Button
                variant="outline"
                onClick={() =>
                  setForm({
                    id: '',
                    alert_type: 'interaction',
                    severity: 'warning',
                    is_active: true,
                    message: '',
                    conditionText: '{}',
                  })
                }
              >
                キャンセル
              </Button>
            ) : null}
          </ActionRail>
        </PageSection>

        <div className="space-y-6">
          <PageSection
            title="テスト実行"
            description="既存の処方サイクル ID を指定すると処方安全チェックを即時実行します。"
            contentClassName="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-2">
              <Label htmlFor="test-cycle-id">サイクル ID</Label>
              <Input
                id="test-cycle-id"
                value={testCycleId}
                onChange={(event) => setTestCycleId(event.target.value)}
                placeholder="cycle_xxx"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={!testCycleId || testMutation.isPending}
            >
              {testMutation.isPending ? '実行中...' : 'テスト実行'}
            </Button>
          </PageSection>

          <PageSection title="登録済みルール" contentClassName="space-y-3">
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                まだ処方安全アラートルールはありません。
              </p>
            ) : (
              rules.map((rule) => {
                const canMutateRule = rule.org_id === orgId;
                return (
                  <div key={rule.id} className="rounded-lg border border-border/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">
                          {ALERT_TYPE_LABELS[rule.alert_type] ?? rule.alert_type}
                        </p>
                        <Badge variant={rule.is_active ? 'default' : 'outline'}>
                          {rule.is_active ? '有効' : '停止'}
                        </Badge>
                        <Badge variant="outline">{rule.severity}</Badge>
                        <Badge variant="secondary">{canMutateRule ? '組織' : '共通'}</Badge>
                      </div>
                      {canMutateRule ? (
                        <ActionRail>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setForm({
                                id: rule.id,
                                alert_type: rule.alert_type,
                                severity: rule.severity,
                                is_active: rule.is_active,
                                message: rule.message,
                                conditionText: JSON.stringify(rule.condition ?? {}, null, 2),
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
                        </ActionRail>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{rule.message}</p>
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-5 text-foreground">
                      {JSON.stringify(rule.condition ?? {}, null, 2)}
                    </pre>
                  </div>
                );
              })
            )}
          </PageSection>
        </div>
      </div>
    </PageScaffold>
  );
}
