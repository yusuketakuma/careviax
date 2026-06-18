'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SAVED_VIEW_CONDITIONS,
  SAVED_VIEW_PRESETS,
  buildSavedViewApplyHref,
  formatConditionChipLabel,
  parseSavedView,
  type SavedViewCondition,
  type SavedViewRecord,
} from '@/lib/views/saved-filter-views';

/** /views の名前付き保存ビューが対象とする一覧画面(スケジュール絞り込み)。 */
const VIEWS_PAGE_SCOPE = 'schedules' as const;

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

type SavedViewsApiResponse = { data: SavedViewRecord[] };

async function fetchSavedViews(orgId: string): Promise<SavedViewRecord[]> {
  const res = await fetch(`/api/saved-views?scope=${VIEWS_PAGE_SCOPE}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('保存ビューの取得に失敗しました');
  const json = (await res.json()) as Partial<SavedViewsApiResponse>;
  // 配列以外(想定外の応答)は空一覧として扱い、描画を壊さない。
  return Array.isArray(json.data) ? json.data : [];
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => ({}))) as { message?: string };
  return payload.message ?? fallback;
}

/**
 * 名前付き保存ビュー(SavedView)。現在ユーザーのビュー + org 共有ビューを
 * チップ一覧で表示し、現在の絞り込み条件に名前を付けて保存・呼び出し(適用)・
 * 改名・共有切替・削除を行う。/api/saved-views に直結する。
 */
function NamedSavedViewsCard({
  orgId,
  currentConditions,
}: {
  orgId: string;
  currentConditions: SavedViewCondition[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryKey = ['saved-views', orgId, VIEWS_PAGE_SCOPE];
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SavedViewRecord | null>(null);

  const viewsQuery = useQuery({
    queryKey,
    queryFn: () => fetchSavedViews(orgId),
    staleTime: 30_000,
    enabled: Boolean(orgId),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey });
  }

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          name,
          scope: VIEWS_PAGE_SCOPE,
          filters: { conditions: currentConditions },
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, '保存ビューの作成に失敗しました'));
    },
    onSuccess: () => {
      setNewName('');
      invalidate();
      toast.success('保存ビューを作成しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存ビューの作成に失敗しました');
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await fetch(`/api/saved-views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, '名前の変更に失敗しました'));
    },
    onSuccess: () => {
      setRenamingId(null);
      setRenameValue('');
      invalidate();
      toast.success('名前を変更しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '名前の変更に失敗しました');
    },
  });

  const shareMutation = useMutation({
    mutationFn: async ({ id, isShared }: { id: string; isShared: boolean }) => {
      const res = await fetch(`/api/saved-views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ is_shared: isShared }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, '共有設定の変更に失敗しました'));
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '共有設定の変更に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/saved-views/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, '削除に失敗しました'));
    },
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
      toast.success('保存ビューを削除しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  /** 呼び出し(適用): 保存した条件を現在の絞り込みに反映する。 */
  function recallView(view: SavedViewRecord) {
    const filterConditions = parseSavedView(view.filters)?.conditions ?? [];
    const summary = filterConditions.length > 0 ? `(${filterConditions.length}件の条件)` : '';
    router.push(buildSavedViewApplyHref(filterConditions));
    toast.success(`「${view.name}」を適用しました${summary}`);
  }

  const isLoading = !orgId || viewsQuery.isLoading;
  const views = viewsQuery.data ?? [];

  return (
    <section
      aria-labelledby="named-views-heading"
      className="rounded-xl border border-border/70 bg-card p-5 shadow-sm"
      data-testid="named-views-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="named-views-heading" className="text-base font-bold text-foreground">
            保存したビュー
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            名前を付けて保存し、ワンタップで呼び出せます。共有すると同じ薬局のメンバーにも表示されます。
          </p>
        </div>
      </div>

      {/* 現在の条件に名前を付けて保存 */}
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          createMutation.mutate(name);
        }}
        data-testid="named-view-create-form"
      >
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="ビュー名(例: 今日の未確認のみ)"
          maxLength={100}
          aria-label="保存ビュー名"
          className="min-h-11 w-full max-w-xs"
          data-testid="named-view-name-input"
        />
        <Button
          type="submit"
          variant="outline"
          className="min-h-11"
          disabled={createMutation.isPending || newName.trim().length === 0}
          data-testid="named-view-create"
        >
          {createMutation.isPending ? '保存中…' : '今の条件を名前を付けて保存'}
        </Button>
      </form>

      {isLoading ? (
        <div className="mt-5 flex flex-wrap gap-3" role="status" aria-label="保存ビュー読み込み中">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-44 rounded-lg" />
          ))}
        </div>
      ) : viewsQuery.isError ? (
        <p className="mt-5 text-sm text-muted-foreground">保存ビューを取得できませんでした。</p>
      ) : views.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="保存したビューはありません"
            description="今の絞り込み条件に名前を付けて保存すると、ここに表示されます。"
          />
        </div>
      ) : (
        <ul
          className="mt-5 flex flex-col gap-2"
          aria-label="保存したビュー"
          data-testid="named-view-list"
        >
          {views.map((view) => (
            <li
              key={view.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
              data-testid="named-view-item"
            >
              {renamingId === view.id ? (
                <form
                  className="flex flex-1 flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = renameValue.trim();
                    if (!name) return;
                    renameMutation.mutate({ id: view.id, name });
                  }}
                >
                  <Input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    maxLength={100}
                    aria-label="新しいビュー名"
                    className="min-h-10 w-full max-w-xs"
                    autoFocus
                    data-testid="named-view-rename-input"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="min-h-10"
                    disabled={renameMutation.isPending || renameValue.trim().length === 0}
                  >
                    保存
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-10"
                    onClick={() => {
                      setRenamingId(null);
                      setRenameValue('');
                    }}
                  >
                    取消
                  </Button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="flex-1 truncate text-left text-sm font-medium text-primary hover:underline"
                    onClick={() => recallView(view)}
                    data-testid="named-view-recall"
                  >
                    {view.name}
                  </button>
                  {!view.isOwner ? (
                    <span
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      data-testid="named-view-shared-tag"
                    >
                      共有
                    </span>
                  ) : (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                          checked={view.isShared}
                          onCheckedChange={(next) =>
                            shareMutation.mutate({ id: view.id, isShared: next })
                          }
                          aria-label={`${view.name}を共有`}
                          data-testid="named-view-share-toggle"
                        />
                        共有
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-10"
                        onClick={() => {
                          setRenamingId(view.id);
                          setRenameValue(view.name);
                        }}
                        data-testid="named-view-rename"
                      >
                        名前変更
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-10 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(view)}
                        data-testid="named-view-delete"
                      >
                        削除
                      </Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="保存ビューを削除"
        description={
          deleteTarget ? `「${deleteTarget.name}」を削除します。この操作は取り消せません。` : ''
        }
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </section>
  );
}

export function SavedViewsContent() {
  const orgId = useOrgId();

  // 「今の絞り込み条件」と同じ preferences クエリを共有し(React Query が重複排除)、
  // 名前付き保存ビューの「今の条件を保存」に渡す現在条件を導出する。
  const preferencesQuery = useQuery({
    queryKey: ['me-preferences', orgId],
    queryFn: () => fetchPreferences(orgId),
    staleTime: 30_000,
    enabled: Boolean(orgId),
  });
  const currentConditions: SavedViewCondition[] =
    parseSavedView(preferencesQuery.data?.saved_view)?.conditions ?? DEFAULT_SAVED_VIEW_CONDITIONS;

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

      <NamedSavedViewsCard orgId={orgId} currentConditions={currentConditions} />
    </div>
  );
}
