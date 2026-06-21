'use client';

/**
 * F-009 グローバル検索コマンドパレット。
 *
 * - 開閉は useCommandPaletteStore(AppShell から1箇所だけ描画。自身は trigger を持たない)。
 * - 6 text カテゴリを横断検索(use-global-search)。完全網羅は主張せず、
 *   権限のないカテゴリは fetch せず非表示、部分失敗は当該グループのみ alert で告知。
 * - WAI-ARIA APG の combobox + listbox パターン。見出しは option ナビから skip し、
 *   ArrowUp/Down はフラット化した可視 option 間のみ移動する。
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useCommandPaletteStore } from '@/lib/stores/command-palette-store';
import { cn } from '@/lib/utils';
import { ACTIVE_PALETTE_CATEGORIES } from '@/lib/search/categories';
import { useGlobalSearch } from './use-global-search';

// 可視コピーは「実際に検索される(active)カテゴリ」だけを案内する。active ラベルは確定列挙
// (deferred は無いため「など」は付けない — facility/薬切れ等の除外カテゴリも検索できると誤認させない)。
// active が1カテゴリのみのときは「横断検索」を使わない
// (薬剤しか検索できないのに患者名等の PHI を入力してよいと誤認させないため)。
const ACTIVE_LABELS = ACTIVE_PALETTE_CATEGORIES.map((c) => c.label).join('・');
const ACTIVE_IS_MULTI = ACTIVE_PALETTE_CATEGORIES.length > 1;
const SEARCH_ARIA_LABEL = ACTIVE_IS_MULTI ? `${ACTIVE_LABELS}を横断検索` : `${ACTIVE_LABELS}を検索`;
const SEARCH_INTRO = ACTIVE_IS_MULTI
  ? `2文字以上のキーワードで${ACTIVE_LABELS}を横断検索します。`
  : `2文字以上のキーワードで${ACTIVE_LABELS}を検索します。`;

type FlatOption = {
  optionId: string;
  href: string;
  /** スクリーンリーダ向けの完全な読み上げ名(カテゴリ + title + subtitle)。 */
  accessibleName: string;
};

export function CommandPalette() {
  const router = useRouter();
  const orgId = useOrgId();
  const role = useAuthStore((state) => state.currentUser.role);

  const open = useCommandPaletteStore((state) => state.open);
  const focusNonce = useCommandPaletteStore((state) => state.focusNonce);
  const restoreEl = useCommandPaletteStore((state) => state.restoreEl);
  const closePalette = useCommandPaletteStore((state) => state.closePalette);

  const [query, setQuery] = useState('');
  // ユーザーが明示選択した option id(矢印/ホバー)。実際の active は flatOptions から導出する。
  const [userActiveId, setUserActiveId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // close 時の復帰先。store がイベントハンドラ内で捕捉した要素を ref に同期する
  // (render 中の ref アクセスを避けるため effect で反映)。
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const hintId = `${baseId}-hint`;

  const { results, pending, hasQuery } = useGlobalSearch(query, role, orgId);

  // 露出/操作可能なのは「現 query が有効(>=2字)かつ pending でない」ときだけ。
  // query が 2 文字未満に落ちた瞬間(hasQuery=false, pending=false)も古い結果を露出/遷移させない。
  const actionable = hasQuery && !pending;
  const visibleResults = useMemo(() => (actionable ? results : []), [actionable, results]);

  // 可視 option をフラット化(見出しは含めない=ナビから skip)。
  const flatOptions = useMemo<FlatOption[]>(() => {
    const flat: FlatOption[] = [];
    for (const group of visibleResults) {
      if (group.status !== 'ok') continue;
      for (const row of group.rows) {
        const optionId = `${baseId}-opt-${group.category}-${row.id}`;
        const subtitle = row.subtitle ? ` ${row.subtitle}` : '';
        const note = group.bestEffort && group.bestEffortNote ? ` ${group.bestEffortNote}` : '';
        flat.push({
          optionId,
          href: row.href,
          accessibleName: `${group.label} ${row.title}${subtitle}${note}`.trim(),
        });
      }
    }
    return flat;
  }, [visibleResults, baseId]);

  // active option を render 中に導出(effect での setState を避ける)。
  // ユーザー選択 id が現在の候補に残っていればそれを、無ければ先頭を active にする。
  const activeOptionId = useMemo(() => {
    if (userActiveId && flatOptions.some((option) => option.optionId === userActiveId)) {
      return userActiveId;
    }
    return flatOptions[0]?.optionId ?? null;
  }, [userActiveId, flatOptions]);

  // open 時に input へフォーカス、focusNonce 変化(再オープン)でも再フォーカス。
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open, focusNonce]);

  const handleClose = useCallback(() => {
    setQuery('');
    setUserActiveId(null);
    closePalette();
  }, [closePalette]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) handleClose();
    },
    [handleClose],
  );

  const navigateActive = useCallback(() => {
    // 現 query が無効(<2字)or pending(stale/loading)中は遷移しない。
    // 古い query の行へ誤って飛ぶのを防ぐ(2文字未満に落ちた瞬間も含む)。
    if (!actionable) return;
    const target = flatOptions.find((option) => option.optionId === activeOptionId);
    if (!target) return;
    handleClose();
    router.push(target.href);
  }, [actionable, activeOptionId, flatOptions, handleClose, router]);

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (flatOptions.length === 0) return;
      const currentIndex = flatOptions.findIndex((option) => option.optionId === activeOptionId);
      const nextIndex =
        currentIndex < 0
          ? delta === 1
            ? 0
            : flatOptions.length - 1
          : (currentIndex + delta + flatOptions.length) % flatOptions.length;
      setUserActiveId(flatOptions[nextIndex].optionId);
    },
    [activeOptionId, flatOptions],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveActive(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveActive(-1);
          break;
        case 'Enter':
          event.preventDefault();
          navigateActive();
          break;
        case 'Escape':
          event.preventDefault();
          handleClose();
          break;
        default:
          break;
      }
    },
    [moveActive, navigateActive, handleClose],
  );

  // store がイベントハンドラ内で捕捉した「open 直前のフォーカス要素」を ref へ同期する。
  // close 時に DialogContent の finalFocus がここへフォーカスを戻す。
  useEffect(() => {
    restoreFocusRef.current = restoreEl;
  }, [restoreEl]);

  // 表示は現入力に対応する結果(visibleResults)のみ。pending 中は failed/ok とも空。
  const failedGroups = visibleResults.filter((group) => group.status === 'failed');
  const okGroups = visibleResults.filter((group) => group.status === 'ok');
  const totalRows = flatOptions.length;
  // empty は『現 query の検索が完了して 0 件』のときだけ(pending 中は出さない)。
  const showEmpty = hasQuery && !pending && totalRows === 0 && failedGroups.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="xl"
        showCloseButton={false}
        className="top-[12%] translate-y-0 gap-0 p-0"
        initialFocus={inputRef}
        finalFocus={restoreFocusRef}
        aria-label="グローバル検索"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">グローバル検索</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={SEARCH_ARIA_LABEL}
            aria-expanded={totalRows > 0}
            // listbox は totalRows>0 のときだけ描画されるため、存在しない id を指さないよう条件付き。
            aria-controls={totalRows > 0 ? listboxId : undefined}
            aria-activedescendant={activeOptionId ?? undefined}
            aria-autocomplete="list"
            aria-describedby={hintId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={`${ACTIVE_LABELS}を検索`}
            className="min-h-[44px] w-full bg-transparent py-3 text-base text-foreground outline-none placeholder:text-muted-foreground"
            data-testid="command-palette-input"
          />
          {/* タッチ/SR/モバイル向けの明示的な閉じる導線(44px)。Escape/outside に加えて常設。 */}
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px] shrink-0"
                aria-label="閉じる"
                data-testid="command-palette-close"
              />
            }
          >
            <X className="size-4" aria-hidden="true" />
          </DialogClose>
        </div>

        {/* aria-live: 件数/ローディングは polite に告知 */}
        <p id={hintId} role="status" aria-live="polite" className="sr-only">
          {!hasQuery
            ? '2文字以上入力すると検索します'
            : pending
              ? '検索中'
              : `${totalRows}件の候補`}
        </p>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!hasQuery ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{SEARCH_INTRO}</p>
          ) : pending ? (
            // 現 query の検索が完了するまでは可視ローディングを表示(空状態や古い結果を出さない)。
            <div
              className="flex items-center justify-center gap-2 px-2 py-8 text-sm text-muted-foreground"
              data-testid="command-palette-loading"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>検索中…</span>
            </div>
          ) : (
            <>
              {/* カテゴリ部分失敗は alert で静的文言(raw error / PHI は出さない) */}
              {failedGroups.map((group) => (
                <div
                  key={`failed-${group.category}`}
                  role="alert"
                  className="mb-1 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{group.label}の取得に失敗しました</span>
                </div>
              ))}

              {totalRows > 0 ? (
                <ul role="listbox" id={listboxId} aria-label="検索結果">
                  {okGroups.map((group) =>
                    group.rows.length === 0 ? null : (
                      <li key={group.category} role="presentation">
                        <div
                          role="presentation"
                          className="flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground"
                        >
                          <span>{group.label}</span>
                          {group.bestEffort && group.bestEffortNote ? (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                              {group.bestEffortNote}
                            </span>
                          ) : null}
                        </div>
                        <ul role="presentation">
                          {group.rows.map((row) => (
                            <PaletteOption
                              key={row.id}
                              optionId={`${baseId}-opt-${group.category}-${row.id}`}
                              active={
                                activeOptionId === `${baseId}-opt-${group.category}-${row.id}`
                              }
                              badgeLabel={row.badgeLabel}
                              badgeClassName={row.badgeClassName}
                              title={row.title}
                              subtitle={row.subtitle}
                              groupLabel={group.label}
                              bestEffortNote={group.bestEffort ? group.bestEffortNote : undefined}
                              onActivate={() =>
                                setUserActiveId(`${baseId}-opt-${group.category}-${row.id}`)
                              }
                              onSelect={() => {
                                handleClose();
                                router.push(row.href);
                              }}
                            />
                          ))}
                        </ul>
                      </li>
                    ),
                  )}
                </ul>
              ) : showEmpty ? (
                <EmptyState
                  icon={Search}
                  title="一致する結果がありません"
                  description="キーワードを見直して、もう一度検索してください。"
                />
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PaletteOptionProps = {
  optionId: string;
  active: boolean;
  badgeLabel: string;
  badgeClassName: string;
  title: string;
  subtitle: string | null;
  groupLabel: string;
  bestEffortNote?: string;
  onActivate: () => void;
  onSelect: () => void;
};

function PaletteOption({
  optionId,
  active,
  badgeLabel,
  badgeClassName,
  title,
  subtitle,
  groupLabel,
  bestEffortNote,
  onActivate,
  onSelect,
}: PaletteOptionProps) {
  const note = bestEffortNote ? ` ${bestEffortNote}` : '';
  const accessibleName = `${groupLabel} ${title}${subtitle ? ` ${subtitle}` : ''}${note}`.trim();
  return (
    <li
      id={optionId}
      role="option"
      aria-selected={active}
      aria-label={accessibleName}
      onMouseEnter={onActivate}
      onClick={onSelect}
      className={cn(
        'flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md px-2 py-2',
        active ? 'bg-accent' : 'hover:bg-accent/60',
      )}
    >
      <span
        className={cn(
          'shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium',
          badgeClassName,
        )}
        aria-hidden="true"
      >
        {badgeLabel}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
    </li>
  );
}
