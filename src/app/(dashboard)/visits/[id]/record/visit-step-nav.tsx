'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
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
  const activeIndex = activeId
    ? VISIT_RECORD_STEPS.findIndex((step) => step.id === activeId)
    : 0;
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
                      ? 'border-emerald-200 bg-emerald-50/60 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
                )}
              >
                <span className="min-w-0 truncate">
                  {index + 1}. {step.label}
                </span>
                {state === 'done' ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
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
 * p0_22 下部固定バー: 一時保存 / 前へ / 次へ(青)/ 訪問完了(緑)。
 * フォーム内に置く前提(訪問完了は type=submit)。メインのスクロールは
 * AppShell の main 内で起きるため sticky では常時表示できず fixed にする
 * (xl はデスクトップサイドバー幅 w-56 分を空ける)。
 */
export function VisitStepActionBar({
  activeId,
  onSaveDraft,
  submitPending,
}: {
  activeId: VisitRecordStepId | null;
  onSaveDraft: () => void;
  submitPending: boolean;
}) {
  const prevStep = resolveAdjacentVisitStep(activeId, 'prev');
  const nextStep = resolveAdjacentVisitStep(activeId, 'next');

  return (
    <div
      data-testid="visit-step-action-bar"
      className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-6 xl:left-56"
    >
      <Button type="button" variant="outline" className="min-h-11 sm:min-w-28" onClick={onSaveDraft}>
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
        <Button
          type="button"
          className="min-h-11 sm:min-w-32"
          disabled={!nextStep}
          onClick={() => nextStep && scrollToVisitStep(nextStep)}
        >
          次へ
        </Button>
        <LoadingButton
          type="submit"
          loading={submitPending}
          loadingLabel="保存中..."
          className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:min-w-32"
        >
          訪問完了
        </LoadingButton>
      </div>
    </div>
  );
}
