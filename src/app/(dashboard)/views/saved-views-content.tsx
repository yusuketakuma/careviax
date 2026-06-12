'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SAVED_VIEW_CONDITIONS,
  SAVED_VIEW_PRESETS,
  formatConditionChipLabel,
  parseSavedView,
  type SavedViewCondition,
} from '@/lib/views/saved-filter-views';

/**
 * p1_01「よく使う絞り込み」(/views)。
 * 構成: 見出し → プリセットカード 4 枚(2×2) → 「今の絞り込み条件」カード
 * (条件チップ+保存)。条件は me/preferences の saved_view に保存し、
 * 未保存時は target と同じ初期 5 チップを表示する。
 */

type PreferencesValue = Record<string, unknown>;

async function fetchPreferences(orgId: string): Promise<PreferencesValue> {
  const res = await fetch('/api/me/preferences', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('保存済み条件の取得に失敗しました');
  const json = await res.json();
  return (json.data ?? {}) as PreferencesValue;
}

function PresetCard({
  title,
  conditionSummary,
  href,
}: {
  title: string;
  conditionSummary: string;
  href: string;
}) {
  return (
    <article
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-5 shadow-sm"
      data-testid="saved-view-preset-card"
    >
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{conditionSummary}</p>
      <div className="mt-auto flex justify-end">
        <Link
          href={href}
          className={cn(buttonVariants(), 'min-h-11 min-w-28')}
          data-testid="saved-view-preset-use"
        >
          使う
        </Link>
      </div>
    </article>
  );
}

/** 保存日時 → 「6/13 09:30 保存」。不正な日時は非表示にする。 */
function formatSavedAtLabel(savedAt: string | undefined): string | null {
  if (!savedAt) return null;
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${format(date, 'M/d HH:mm')} 保存`;
}

function CurrentFilterCard({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: ['me-preferences', orgId],
    queryFn: () => fetchPreferences(orgId),
    staleTime: 30_000,
    enabled: Boolean(orgId),
  });

  const savedView = parseSavedView(preferencesQuery.data?.saved_view);
  const conditions: SavedViewCondition[] = savedView?.conditions ?? DEFAULT_SAVED_VIEW_CONDITIONS;
  const savedAtLabel = formatSavedAtLabel(savedView?.savedAt);

  const saveMutation = useMutation({
    mutationFn: async (next: SavedViewCondition[]) => {
      const res = await fetch('/api/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          saved_view: { conditions: next, saved_at: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? '絞り込み条件の保存に失敗しました');
      }
      const json = await res.json();
      return (json.data ?? {}) as PreferencesValue;
    },
    onSuccess: (updated) => {
      // PATCH 応答のマージ済み preferences をそのままキャッシュへ反映(再取得なしで保存済み表示にする)
      queryClient.setQueryData(['me-preferences', orgId], updated);
      toast.success('絞り込み条件を保存しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '絞り込み条件の保存に失敗しました');
    },
  });

  const isLoading = !orgId || preferencesQuery.isLoading;

  return (
    <section
      aria-labelledby="current-filter-heading"
      className="min-h-[320px] rounded-xl border border-border/70 bg-card p-5 shadow-sm"
      data-testid="current-filter-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="current-filter-heading" className="text-base font-bold text-foreground">
          今の絞り込み条件
        </h2>
        {savedView ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
            data-testid="current-filter-saved-badge"
          >
            保存済み
            {savedAtLabel ? <span className="font-normal">({savedAtLabel})</span> : null}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div
          className="mt-4 flex flex-wrap gap-3"
          role="status"
          aria-label="保存済み条件読み込み中"
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-36 rounded-full" />
          ))}
        </div>
      ) : (
        <>
          {preferencesQuery.isError ? (
            <p className="mt-2 text-xs text-muted-foreground">
              保存済み条件を取得できなかったため、初期条件を表示しています。
            </p>
          ) : null}
          <ul className="mt-4 flex flex-wrap gap-3" aria-label="絞り込み条件">
            {conditions.map((condition) => (
              <li key={`${condition.field}:${condition.value}`}>
                <span
                  className="inline-flex min-h-9 items-center rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary"
                  data-testid="current-filter-chip"
                >
                  {formatConditionChipLabel(condition)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Button
              type="button"
              className="min-h-11 min-w-44"
              onClick={() => saveMutation.mutate(conditions)}
              disabled={saveMutation.isPending}
              data-testid="save-current-filter"
            >
              {saveMutation.isPending ? '保存中…' : 'この条件を保存'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function SavedViewsContent() {
  const orgId = useOrgId();

  return (
    <div className="max-w-5xl space-y-6" data-testid="saved-views-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">よく使う絞り込み</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          朝の確認・施設別・自分の担当などをすぐ呼び出します。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6" data-testid="saved-view-preset-grid">
        {SAVED_VIEW_PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            title={preset.title}
            conditionSummary={preset.conditionSummary}
            href={preset.href}
          />
        ))}
      </div>

      <CurrentFilterCard orgId={orgId} />
    </div>
  );
}
