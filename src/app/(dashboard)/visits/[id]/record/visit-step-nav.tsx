'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * デザイン p0_22/p0_23(訪問モード)の「訪問ステップ」ナビ。
 * 第一段は既存フォームのセクション構成に合わせた 5 ステップで、
 * スクロール位置から現在地を推定して左レールに表示する(フォーム本体は変更しない)。
 */

export const VISIT_RECORD_STEPS = [
  { id: 'visit-step-readiness', label: '訪問前確認' },
  { id: 'visit-step-status', label: '入力状況' },
  { id: 'visit-step-result', label: '訪問結果' },
  { id: 'visit-step-soap', label: '服薬・副作用の記録' },
  { id: 'visit-step-final', label: '次回予定・完了チェック' },
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

export function VisitStepNav() {
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
                onClick={() =>
                  document
                    .getElementById(step.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
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
