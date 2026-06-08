'use client';

import { CheckCircle2, Circle, CloudOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { PhosVisitArrivalOutcomeLabel, PhosVisitStepLabel } from '@/phos/contracts/phos_copy.ja';
import { ActionPhase, VisitArrivalOutcome, VisitStep } from '@/phos/contracts/phos_contracts';
import type { VisitModeView } from '@/phos/contracts/phos_contracts';
import { canCompleteVisit } from '@/phos/domain/visit/resolveVisitMode';

export type VisitModeProps = {
  visit: VisitModeView;
  actionPhase?: ActionPhase;
  onArrivalOutcome(outcome: VisitArrivalOutcome, reason?: string): void;
  onOpenStep(step: VisitStep): void;
  onCompleteVisit(): void;
};

const ARRIVAL_OUTCOMES = [
  VisitArrivalOutcome.PRESENT,
  VisitArrivalOutcome.ABSENT,
  VisitArrivalOutcome.POSTPONED,
  VisitArrivalOutcome.CANCELED,
] as const satisfies readonly VisitArrivalOutcome[];

function canOpenStep(visit: VisitModeView, step: VisitStep): boolean {
  return visit.applicable_steps.includes(step);
}

export function VisitMode({
  visit,
  actionPhase,
  onArrivalOutcome,
  onOpenStep,
  onCompleteVisit,
}: VisitModeProps) {
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReasonError, setCancelReasonError] = useState<string | undefined>();
  const blockingUnsyncedCount = visit.evidence_sync.blocking_unsynced_count;
  const nonBlockingUnsyncedCount = visit.evidence_sync.non_blocking_unsynced_count;
  const arrivalApplicable = visit.applicable_steps.includes(VisitStep.ARRIVAL_CONFIRM);
  const canComplete = canCompleteVisit({
    applicable_steps: visit.applicable_steps,
    required_steps: visit.required_steps,
    step_completed: visit.step_completed,
    blocking_unsynced_count: blockingUnsyncedCount,
    visit_status: visit.visit_status,
  });
  const isSubmitting = actionPhase === ActionPhase.SUBMITTING;
  const canExecuteComplete = canComplete && !isSubmitting;

  return (
    <section
      aria-labelledby="phos-visit-mode-title"
      className="space-y-4 rounded-lg border border-border/70 bg-card p-4"
    >
      <div className="flex flex-col gap-2 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="phos-visit-mode-title" className="text-lg font-semibold text-foreground">
            訪問モード
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {visit.patient_name}
            {[visit.facility, visit.room].filter(Boolean).length > 0
              ? ` / ${[visit.facility, visit.room].filter(Boolean).join(' / ')}`
              : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-1 text-muted-foreground">
            {visit.online ? 'オンライン' : 'オフライン'}
          </span>
          {blockingUnsyncedCount > 0 ? (
            <span className="rounded-md border border-amber-200/80 bg-amber-50/80 px-2 py-1 text-amber-950">
              必須未同期 {blockingUnsyncedCount}件
            </span>
          ) : null}
          {nonBlockingUnsyncedCount > 0 ? (
            <span className="rounded-md border border-border/70 bg-background px-2 py-1 text-muted-foreground">
              任意未同期 {nonBlockingUnsyncedCount}件
            </span>
          ) : null}
        </div>
      </div>

      {arrivalApplicable ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {PhosVisitStepLabel[VisitStep.ARRIVAL_CONFIRM]}
          </h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {ARRIVAL_OUTCOMES.map((outcome) => (
              <button
                key={outcome}
                type="button"
                className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => {
                  if (outcome === VisitArrivalOutcome.CANCELED) {
                    setCancelReasonOpen(true);
                    setCancelReasonError('キャンセル理由を入力してください。');
                    return;
                  }
                  onArrivalOutcome(outcome);
                }}
              >
                {PhosVisitArrivalOutcomeLabel[outcome]}
              </button>
            ))}
          </div>
          {cancelReasonOpen ? (
            <div className="rounded-md border border-border/70 bg-background p-3">
              <label className="text-sm font-medium text-foreground" htmlFor="visit-cancel-reason">
                キャンセル理由
              </label>
              <textarea
                id="visit-cancel-reason"
                className="mt-2 min-h-24 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={cancelReason}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                  setCancelReasonError(undefined);
                }}
              />
              {cancelReasonError ? (
                <p className="mt-2 text-sm text-amber-950">{cancelReasonError}</p>
              ) : null}
              <button
                type="button"
                className="mt-3 min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => {
                  const trimmedReason = cancelReason.trim();
                  if (!trimmedReason) {
                    setCancelReasonError('キャンセル理由を入力してください。');
                    return;
                  }
                  onArrivalOutcome(VisitArrivalOutcome.CANCELED, trimmedReason);
                }}
              >
                理由を付けてキャンセル
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <ol className="space-y-2">
        {visit.applicable_steps.map((step) => {
          const completed = visit.step_completed[step] === true;
          const required = visit.required_steps.includes(step);
          const Icon = completed ? CheckCircle2 : Circle;
          return (
            <li key={step}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border/70 bg-background px-3 text-left text-sm text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                data-current={visit.last_opened_step === step ? 'true' : 'false'}
                onClick={() => {
                  if (!canOpenStep(visit, step)) return;
                  onOpenStep(step);
                }}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="font-medium">{PhosVisitStepLabel[step]}</span>
                </span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {completed ? '完了' : required ? '必須' : '任意'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {!visit.online ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>オフライン中です。証跡は未同期として保持されます。</span>
        </div>
      ) : null}

      <button
        type="button"
        className="min-h-11 w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:bg-muted data-[enabled=false]:text-muted-foreground"
        data-enabled={canExecuteComplete ? 'true' : 'false'}
        aria-label={canExecuteComplete ? '訪問を完了する' : '訪問を完了する（未完了）'}
        onClick={() => {
          if (!canExecuteComplete) return;
          onCompleteVisit();
        }}
      >
        <span className="inline-flex items-center justify-center gap-2">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          訪問を完了する
        </span>
      </button>
    </section>
  );
}
