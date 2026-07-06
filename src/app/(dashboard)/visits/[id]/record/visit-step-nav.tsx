'use client';

import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { SafetyTagBadge } from '@/components/features/patients/safety-tag-badge';
import { cn } from '@/lib/utils';

/**
 * デザイン p0_22/p0_23(訪問モード)の「訪問ステップ」ナビと下部固定バー。
 * 既存フォームのセクション/カードに付けたアンカー id をステップとして扱い、
 * スクロール位置から現在地を推定する(フォーム本体のフィールドは変更しない)。
 */

export const VISIT_RECORD_STEPS = [
  { id: 'visit-step-readiness', label: '訪問前確認' },
  { id: 'visit-step-status', label: '今日の確認' },
  { id: 'visit-step-result', label: '訪問結果' },
  { id: 'visit-step-soap', label: '服薬・副作用' },
  { id: 'visit-step-receipt', label: '受領記録' },
  { id: 'visit-step-next-visit', label: '次回予定' },
  { id: 'visit-step-residual', label: '残薬確認' },
  { id: 'visit-step-evidence', label: '写真・証跡' },
  { id: 'visit-step-final-check', label: '完了チェック' },
] as const;

export type VisitRecordStepId = (typeof VISIT_RECORD_STEPS)[number]['id'];

export type VisitStepState = 'done' | 'current' | 'todo';

/** 現在地より上のステップを済として表示する(スクロール準拠の進行表示) */
export function buildVisitStepStates(activeId: VisitRecordStepId | null): VisitStepState[] {
  const activeIndex = activeId ? VISIT_RECORD_STEPS.findIndex((step) => step.id === activeId) : -1;
  return VISIT_RECORD_STEPS.map((_, index) => {
    if (activeIndex === -1) return index === 0 ? 'current' : 'todo';
    if (index < activeIndex) return 'done';
    if (index === activeIndex) return 'current';
    return 'todo';
  });
}

export function scrollToVisitStep(stepId: VisitRecordStepId) {
  document.getElementById(stepId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 前へ/次へ のジャンプ先(端では null)。 */
export function resolveAdjacentVisitStep(
  activeId: VisitRecordStepId | null,
  direction: 'prev' | 'next',
): VisitRecordStepId | null {
  const activeIndex = activeId ? VISIT_RECORD_STEPS.findIndex((step) => step.id === activeId) : 0;
  const safeIndex = activeIndex === -1 ? 0 : activeIndex;
  const nextIndex = direction === 'prev' ? safeIndex - 1 : safeIndex + 1;
  if (nextIndex < 0 || nextIndex >= VISIT_RECORD_STEPS.length) return null;
  return VISIT_RECORD_STEPS[nextIndex].id;
}

/** スクロール位置から現在ステップを推定する(jsdom 等では先頭固定)。 */
export function useVisitStepSpy(): VisitRecordStepId | null {
  const [activeId, setActiveId] = useState<VisitRecordStepId | null>(null);

  useEffect(() => {
    // jsdom 等 IntersectionObserver の無い環境では現在地追従を行わない(先頭固定)
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = VISIT_RECORD_STEPS.map((step) => document.getElementById(step.id)).filter(
      (element): element is HTMLElement => element !== null,
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const first = visible[0]?.target.id as VisitRecordStepId | undefined;
        if (first) setActiveId(first);
      },
      { rootMargin: '-15% 0px -65% 0px' },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return activeId;
}

export function VisitStepNav({ activeId }: { activeId: VisitRecordStepId | null }) {
  const states = buildVisitStepStates(activeId);

  return (
    <nav aria-label="訪問ステップ" data-testid="visit-step-nav">
      <p className="px-1 text-sm font-bold text-foreground">訪問ステップ</p>
      <ol className="mt-2 space-y-1.5" role="list">
        {VISIT_RECORD_STEPS.map((step, index) => {
          const state = states[index];
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => scrollToVisitStep(step.id)}
                data-state={state}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm',
                  state === 'current'
                    ? 'border-primary/40 bg-primary/5 font-medium text-foreground'
                    : state === 'done'
                      ? 'border-state-done/30 bg-state-done/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
                )}
              >
                <span className="min-w-0 truncate">
                  {index + 1}. {step.label}
                </span>
                {state === 'done' ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-state-done/30 bg-state-done/10 px-1.5 py-0.5 text-xs font-medium text-state-done">
                    済
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * 訪問モードヘッダの安全タグ(SSOT 4.1 訪問キャプチャ Pinned: ハイリスクタグ・アレルギー)。
 * tags は selectVisibleSafetyTags 済み(critical は必ず含まれる)を前提とする。
 * unavailable(取得失敗)は fail-close: 「タグなし」と区別できる警告を出す。
 */
export type VisitHeaderSafety = {
  tags: string[];
  hiddenCount: number;
  unavailable: boolean;
};

export function VisitHeaderSafetyTags({ safety }: { safety: VisitHeaderSafety }) {
  if (safety.unavailable) {
    return (
      <p
        role="alert"
        data-testid="visit-header-safety-unavailable"
        className="flex items-center gap-1 text-xs font-medium text-state-blocked"
      >
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        安全タグを取得できません（「なし」とは判断しないでください）
      </p>
    );
  }
  if (safety.tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="visit-header-safety-tags">
      {safety.tags.map((tag) => (
        <SafetyTagBadge key={tag} tag={tag} />
      ))}
      {safety.hiddenCount > 0 ? (
        <span className="text-xs text-muted-foreground">+{safety.hiddenCount}</span>
      ) : null}
    </div>
  );
}

/**
 * p0_22 ヘッダ: 「患者名 様 M月d日 HH:mm 訪問中」+ 安全タグ + オフライン / 未同期バッジ。
 */
export function VisitModeHeader({
  patientName,
  dateTimeLabel,
  safety,
  isOffline,
  pendingSyncCount,
  className,
}: {
  patientName: string | null;
  dateTimeLabel: string | null;
  safety?: VisitHeaderSafety;
  isOffline: boolean;
  pendingSyncCount: number;
  className?: string;
}) {
  return (
    <div
      data-testid="visit-mode-header"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <p className="text-base font-bold text-foreground">
          {patientName ? `${patientName} 様` : '患者情報を読み込み中'}
          {dateTimeLabel ? `　${dateTimeLabel}` : ''}
          　訪問中
        </p>
        {safety ? <VisitHeaderSafetyTags safety={safety} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isOffline ? (
          <span className="inline-flex items-center rounded-full border border-state-confirm/30 bg-state-confirm/10 px-2.5 py-0.5 text-xs font-semibold text-state-confirm">
            オフライン
          </span>
        ) : null}
        {pendingSyncCount > 0 ? (
          <span className="inline-flex items-center rounded-full border border-state-blocked/30 bg-state-blocked/10 px-2.5 py-0.5 text-xs font-semibold text-state-blocked">
            未同期 {pendingSyncCount}件
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * p0_23 モバイル没入ヘッダ: 「PH-OS」ロゴ+未同期バッジ+患者行+ステップドット。
 * グローバルヘッダは app-shell 側で <md のみ隠れるため、本ヘッダが代替になる。
 */
export function VisitMobileModeHeader({
  patientName,
  dateTimeLabel,
  safety,
  isOffline,
  pendingSyncCount,
  activeStepId,
  onStepSelect,
}: {
  patientName: string | null;
  dateTimeLabel: string | null;
  safety?: VisitHeaderSafety;
  isOffline: boolean;
  pendingSyncCount: number;
  activeStepId: VisitRecordStepId;
  onStepSelect: (stepId: VisitRecordStepId) => void;
}) {
  return (
    <header
      data-testid="visit-mobile-mode-header"
      className="sticky top-0 z-20 -mx-4 -mt-4 border-b border-border/60 bg-card px-4 pb-3 pt-3 sm:-mx-6 sm:-mt-6 sm:px-6"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-bold tracking-tight text-primary">PH-OS</p>
        <div className="flex items-center gap-2">
          {isOffline ? (
            <span className="inline-flex items-center rounded-full border border-state-confirm/30 bg-state-confirm/10 px-2.5 py-0.5 text-xs font-semibold text-state-confirm">
              オフライン
            </span>
          ) : null}
          {pendingSyncCount > 0 ? (
            <span
              data-testid="visit-mobile-pending-sync-badge"
              className="inline-flex items-center rounded-full border border-state-blocked/30 bg-state-blocked/10 px-2.5 py-0.5 text-xs font-semibold text-state-blocked"
            >
              未同期{pendingSyncCount}
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-base font-bold text-foreground">
        {patientName ? `${patientName} 様` : '患者情報を読み込み中'}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        訪問中{dateTimeLabel ? ` ${dateTimeLabel}` : ''}
      </p>
      {safety ? (
        <div className="mt-1.5">
          <VisitHeaderSafetyTags safety={safety} />
        </div>
      ) : null}
      <VisitStepDots activeId={activeStepId} onSelect={onStepSelect} />
    </header>
  );
}

/**
 * p0_23 ステップドット(1〜9)。現在地までが青塗り、残りはグレー。
 * タップで該当ステップへ移動できる(色だけに依存しないよう番号+aria を併用)。
 */
export function VisitStepDots({
  activeId,
  onSelect,
}: {
  activeId: VisitRecordStepId;
  onSelect: (stepId: VisitRecordStepId) => void;
}) {
  const states = buildVisitStepStates(activeId);

  return (
    <ol className="mt-2.5 flex items-center gap-1" data-testid="visit-step-dots" role="list">
      {VISIT_RECORD_STEPS.map((step, index) => {
        const state = states[index];
        const stateLabel = state === 'done' ? '完了' : state === 'current' ? '現在' : '未入力';
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              aria-label={`ステップ${index + 1} ${step.label}(${stateLabel})`}
              aria-current={state === 'current' ? 'step' : undefined}
              data-state={state}
              className="flex h-11 w-8 items-center justify-center"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  state === 'todo'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary text-primary-foreground',
                  state === 'current' ? 'ring-2 ring-primary/30' : undefined,
                )}
              >
                {index + 1}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** p0_23 橙バナー: 未同期の写真ドラフト(p0_48)が残っているときの注意喚起 */
export function VisitUnsyncedEvidenceBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      data-testid="visit-unsynced-evidence-banner"
      className={cn(
        'rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3',
        className,
      )}
    >
      <p className="text-sm font-bold text-state-confirm">未同期の写真があります</p>
      <p className="mt-1 text-xs leading-5 text-state-confirm/80">訪問完了前に同期してください。</p>
    </div>
  );
}

export type VisitEvidenceRailItem = {
  id: string;
  name: string;
  kindLabel: string;
  statusLabel: string;
  statusTone: 'pending' | 'done';
};

export type VisitSaveState = 'saving' | 'local_saved' | 'sync_waiting' | 'synced' | 'conflict';

const VISIT_SAVE_STATE_LABELS: Record<VisitSaveState, string> = {
  saving: '保存中',
  local_saved: '端末保存済',
  sync_waiting: '同期待ち',
  synced: '同期済',
  conflict: '競合あり',
};

const VISIT_SAVE_STATE_CLASSES: Record<VisitSaveState, string> = {
  saving: 'border-tag-info/30 bg-tag-info/10 text-tag-info',
  local_saved: 'border-state-done/30 bg-state-done/10 text-state-done',
  sync_waiting: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  synced: 'border-state-done/30 bg-state-done/10 text-state-done',
  conflict: 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked',
};

/**
 * p0_22 右レール「写真・証跡」: 添付ドラフトを同期状態付きで一覧する。
 * 保存前の添付は端末上のみ(=未同期)、保存時にまとめてアップロードされる。
 */
export function VisitEvidenceRail({ items }: { items: VisitEvidenceRailItem[] }) {
  return (
    <section aria-label="写真・証跡" data-testid="visit-evidence-rail">
      <p className="px-1 text-sm font-bold text-foreground">写真・証跡</p>
      {items.length === 0 ? (
        <div className="mt-2 rounded-lg border border-dashed border-border bg-card px-3 py-4 text-center">
          <p className="text-xs leading-5 text-muted-foreground">
            写真はまだありません。お薬カレンダーや残薬の写真を残せます。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => scrollToVisitStep('visit-step-evidence')}
          >
            写真を追加
          </Button>
        </div>
      ) : (
        <ul className="mt-2 space-y-2" role="list">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-border/70 bg-card px-3 py-2.5"
              data-testid="visit-evidence-item"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-all text-xs font-medium leading-5 text-foreground">
                  {item.name}
                </p>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-xs font-medium',
                    item.statusTone === 'pending'
                      ? 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm'
                      : 'border-state-done/30 bg-state-done/10 text-state-done',
                  )}
                >
                  {item.statusLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.kindLabel}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * p0_22/p0_23 下部固定バー。フォーム内に置く前提(訪問完了は type=submit)。
 * - md 以上(p0_22): 一時保存 / 前へ / 次へ(青)/ 訪問完了(緑)— スクロール現在地に追従
 * - md 未満(p0_23): 保存(アウトライン)+ 次へ(青・幅広)。最終ステップのみ訪問完了(緑)
 * メインのスクロールは AppShell の main 内で起きるため sticky では常時表示できず
 * fixed にする(xl はデスクトップサイドバー幅 w-56 分を空ける)。
 */
export function VisitStepActionBar({
  activeId,
  mobileStepId,
  saveState,
  onSaveDraft,
  onMobileStepSelect,
  submitPending,
}: {
  activeId: VisitRecordStepId | null;
  /** p0_23 モバイルウィザードの現在ステップ(state 管理。スクロール現在地とは独立) */
  mobileStepId: VisitRecordStepId;
  saveState: VisitSaveState;
  onSaveDraft: () => void;
  onMobileStepSelect: (stepId: VisitRecordStepId) => void;
  submitPending: boolean;
}) {
  const prevStep = resolveAdjacentVisitStep(activeId, 'prev');
  const nextStep = resolveAdjacentVisitStep(activeId, 'next');
  const mobileNextStep = resolveAdjacentVisitStep(mobileStepId, 'next');
  const saveStateLabel = VISIT_SAVE_STATE_LABELS[saveState];

  return (
    <div
      data-testid="visit-step-action-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-6 xl:left-56"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span
          role="status"
          aria-live="polite"
          data-testid="visit-save-state-indicator"
          className={cn(
            'inline-flex min-h-8 items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
            VISIT_SAVE_STATE_CLASSES[saveState],
          )}
        >
          {saveStateLabel}
        </span>
        <span className="hidden text-xs text-muted-foreground md:inline">
          端末保存後、通信可能なときに同期します。
        </span>
      </div>

      {/* md 以上: p0_22 のスクロール準拠ナビ */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:min-w-28"
          onClick={onSaveDraft}
        >
          一時保存
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:min-w-24"
          disabled={!prevStep}
          onClick={() => prevStep && scrollToVisitStep(prevStep)}
        >
          前へ
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* 次へ はスクロール補助(Secondary)。塗りの主操作は 訪問完了 1つに絞る(SSOT 5.1)。 */}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-w-32"
            disabled={!nextStep}
            onClick={() => nextStep && scrollToVisitStep(nextStep)}
          >
            次へ
          </Button>
          {/* 完了アクションも Primary(--primary)。done 緑は状態表示専用で主操作に使わない(SSOT 5.1)。 */}
          <LoadingButton
            type="submit"
            loading={submitPending}
            loadingLabel="保存中..."
            className="min-h-11 sm:min-w-32"
          >
            訪問完了
          </LoadingButton>
        </div>
      </div>

      {/* md 未満: p0_23 ウィザードの 保存 + 次へ(最終ステップは訪問完了) */}
      <div className="flex items-center gap-3 md:hidden">
        <Button
          type="button"
          variant="outline"
          aria-label="一時保存"
          className="min-h-12 min-w-24"
          onClick={onSaveDraft}
        >
          保存
        </Button>
        {mobileNextStep ? (
          <Button
            type="button"
            className="min-h-12 flex-1"
            onClick={() => onMobileStepSelect(mobileNextStep)}
          >
            次へ
          </Button>
        ) : (
          <LoadingButton
            type="submit"
            loading={submitPending}
            loadingLabel="保存中..."
            className="min-h-12 flex-1"
          >
            訪問完了
          </LoadingButton>
        )}
      </div>
    </div>
  );
}
