'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

  const [desired, setDesired] = React.useState<Record<SignalTuningAlertType, boolean> | null>(
    null,
  );
  // ルール読込ごとに希望状態を現状へ同期(未編集時のみ)
  const [syncedAt, setSyncedAt] = React.useState<unknown>(null);
  if (rulesQuery.data && syncedAt !== rulesQuery.data) {
    setSyncedAt(rulesQuery.data);
    setDesired(
      Object.fromEntries(
        SIGNAL_TUNING_ITEMS.map((item) => [item.alertType, currentState[item.alertType].strong]),
      ) as Record<SignalTuningAlertType, boolean>,
    );
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!desired) return;
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
      await queryClient.invalidateQueries({ queryKey: ['drug-alert-rules', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!desired) return null;

  const strongItems = SIGNAL_TUNING_ITEMS.filter((item) => desired[item.alertType]);

  return (
    <section
      data-testid="signal-tuning-panel"
      aria-label="気になる処方の表示設定"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">表示を強める項目</h2>
        <ul className="mt-3 space-y-2.5" role="list">
          {SIGNAL_TUNING_ITEMS.map((item) => {
            const strong = desired[item.alertType];
            return (
              <li
                key={item.alertType}
                data-testid="signal-tuning-item"
                className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-2.5"
              >
                <span className="text-sm font-medium text-foreground">{item.label}</span>
                <button
                  type="button"
                  aria-pressed={strong}
                  onClick={() =>
                    setDesired((prev) =>
                      prev ? { ...prev, [item.alertType]: !prev[item.alertType] } : prev,
                    )
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
        <h2 className="text-sm font-bold text-foreground">カードでの見え方</h2>
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
          disabled={saveMutation.isPending || rulesQuery.isLoading}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? '保存中...' : '保存する'}
        </Button>
      </div>
    </section>
  );
}
