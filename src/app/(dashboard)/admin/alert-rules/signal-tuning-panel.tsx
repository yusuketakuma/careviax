'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  buildSignalTuningState,
  diffSignalTuning,
  SIGNAL_TUNING_ITEMS,
  type SignalTuningAlertType,
  type SignalTuningRule,
} from './signal-tuning.shared';

/**
 * p1_14「気になる処方の表示設定」: 項目ごとに「強く表示/標準」を切り替え、
 * 患者カードでの見え方をプレビューしてから保存する。
 * 強く表示 = その alert_type の critical ルールを有効化(無ければ作成)。
 */

const TAG_TONE_CLASSES: Record<string, string> = {
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-300 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
};

export function SignalTuningPanel() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    queryKey: ['drug-alert-rules', orgId],
    queryFn: async () => {
      const res = await fetch('/api/drug-alert-rules', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('アラートルールの取得に失敗しました');
      const json = await res.json();
      return (json.data ?? []) as SignalTuningRule[];
    },
    enabled: !!orgId,
  });

  const currentState = React.useMemo(
    () => buildSignalTuningState(rulesQuery.data ?? []),
    [rulesQuery.data],
  );

  const baseDesired = React.useMemo(
    () =>
      Object.fromEntries(
        SIGNAL_TUNING_ITEMS.map((item) => [item.alertType, currentState[item.alertType].strong]),
      ) as Record<SignalTuningAlertType, boolean>,
    [currentState],
  );
  const [desiredOverrides, setDesiredOverrides] = React.useState<
    Partial<Record<SignalTuningAlertType, boolean>>
  >({});
  const desired = React.useMemo(
    () => ({ ...baseDesired, ...desiredOverrides }),
    [baseDesired, desiredOverrides],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const diff = diffSignalTuning(currentState, desired);
      const headers = { 'Content-Type': 'application/json', 'x-org-id': orgId };

      for (const alertType of diff.create) {
        const item = SIGNAL_TUNING_ITEMS.find((entry) => entry.alertType === alertType);
        const res = await fetch('/api/drug-alert-rules', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            alert_type: alertType,
            severity: 'critical',
            message: `${item?.label ?? alertType}を強く表示します`,
            condition: { source: 'signal_tuning' },
            is_active: true,
          }),
        });
        if (!res.ok) throw new Error('表示設定の保存に失敗しました');
      }
      for (const ruleId of diff.activate) {
        const res = await fetch(`/api/drug-alert-rules/${ruleId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ is_active: true }),
        });
        if (!res.ok) throw new Error('表示設定の保存に失敗しました');
      }
      for (const ruleId of diff.deactivate) {
        const res = await fetch(`/api/drug-alert-rules/${ruleId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ is_active: false }),
        });
        if (!res.ok) throw new Error('表示設定の保存に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success('表示設定を保存しました');
      setDesiredOverrides({});
      await queryClient.invalidateQueries({ queryKey: ['drug-alert-rules', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const strongItems = SIGNAL_TUNING_ITEMS.filter((item) => desired[item.alertType]);
  const diff = diffSignalTuning(currentState, desired);
  const changedCount = diff.create.length + diff.activate.length + diff.deactivate.length;

  return (
    <section
      data-testid="signal-tuning-panel"
      aria-label="気になる処方の表示設定"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
          <div>
            <h2 className="text-sm font-bold text-foreground">表示を強める項目</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              患者カードで先に目に入れる安全シグナルを選びます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">強調 {strongItems.length}件</Badge>
            {changedCount > 0 ? (
              <Badge variant="outline">未保存 {changedCount}件</Badge>
            ) : (
              <Badge variant="outline">保存済み</Badge>
            )}
          </div>
        </div>
        <ul className="mt-3 space-y-2.5" role="list">
          {SIGNAL_TUNING_ITEMS.map((item) => {
            const strong = desired[item.alertType];
            const changed = currentState[item.alertType].strong !== strong;
            return (
              <li
                key={item.alertType}
                data-testid="signal-tuning-item"
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2.5',
                  changed ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-background',
                )}
              >
                <span>
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  {changed ? (
                    <span className="mt-0.5 block text-xs text-primary">変更あり</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-pressed={strong}
                  onClick={() =>
                    setDesiredOverrides((prev) => ({
                      ...prev,
                      [item.alertType]: !desired[item.alertType],
                    }))
                  }
                  className={cn(
                    'inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-xs font-semibold',
                    strong
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground',
                  )}
                >
                  {strong ? '強く表示' : '標準'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">カードでの見え方</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              保存後、患者カードにはこの順で安全タグが表示されます。
            </p>
          </div>
          <Badge variant={changedCount > 0 ? 'default' : 'outline'}>
            {changedCount > 0 ? '保存待ち' : '反映済み'}
          </Badge>
        </div>
        <div className="mt-3 rounded-lg border border-border/70 bg-background p-4">
          <p className="text-base font-bold text-foreground">田中 一郎 様</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {strongItems.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                強く表示する項目はありません(標準表示)
              </span>
            ) : (
              strongItems.map((item) => (
                <span
                  key={item.alertType}
                  className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                    TAG_TONE_CLASSES[item.tone],
                  )}
                >
                  {item.tagLabel}
                </span>
              ))
            )}
          </div>
        </div>
        <Button
          type="button"
          className="mt-5 min-h-11 w-full sm:w-48"
          disabled={saveMutation.isPending || rulesQuery.isLoading || changedCount === 0}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending
            ? '保存中...'
            : changedCount > 0
              ? `${changedCount}件の変更を保存`
              : '変更はありません'}
        </Button>
      </div>
    </section>
  );
}
