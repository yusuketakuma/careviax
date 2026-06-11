'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PROCESS_STEPS_9,
  getProcessStepIndex,
  type ProcessStepKey,
} from '@/lib/prescription/cycle-workspace';

/**
 * design/images/new 共通の 9 工程表示(取込→入力→判断→調剤→監査→セット→訪問→報告→算定)。
 * - ProcessChips: カード作業台(06_card)などの水平チップ列。
 *   完了=緑枠+チェック / 現在=青塗り白字 / 未来=灰枠。
 * - ProcessProgressDots: 患者カード(02_patient_list)用の小ドット列+現工程ラベルの圧縮版。
 *   完了=緑塗り / 現在=青大きめ / 未来=薄灰。
 * 現在工程キーは MedicationCycleStatus から getProcessStepKeyForStatus で導出する。
 */

type StepState = 'done' | 'current' | 'upcoming';

function stepStateAt(index: number, currentIndex: number): StepState {
  if (currentIndex < 0) return 'upcoming';
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return 'current';
  return 'upcoming';
}

export type ProcessChipsProps = {
  /** 現在工程のキー */
  currentStep: ProcessStepKey;
  className?: string;
};

export function ProcessChips({ currentStep, className }: ProcessChipsProps) {
  const currentIndex = getProcessStepIndex(currentStep);

  return (
    <ol
      aria-label="工程"
      className={cn('flex flex-wrap items-center gap-y-2', className)}
      data-testid="process-chips"
    >
      {PROCESS_STEPS_9.map((step, index) => {
        const state = stepStateAt(index, currentIndex);
        return (
          <li key={step.key} className="flex items-center">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              data-state={state}
              className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
                state === 'done' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
                state === 'current' &&
                  'border-primary bg-primary font-semibold text-primary-foreground',
                state === 'upcoming' && 'border-border bg-background text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check className="size-3" aria-hidden="true" /> : null}
              {step.label}
            </span>
            {index < PROCESS_STEPS_9.length - 1 && (
              <span
                className={cn(
                  'h-px w-2.5 sm:w-3.5',
                  state === 'done' ? 'bg-emerald-300' : 'bg-border',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type ProcessProgressDotsProps = {
  /** 現在工程のキー */
  currentStep: ProcessStepKey;
  className?: string;
};

export function ProcessProgressDots({ currentStep, className }: ProcessProgressDotsProps) {
  const currentIndex = getProcessStepIndex(currentStep);
  const currentLabel = currentIndex >= 0 ? PROCESS_STEPS_9[currentIndex].label : null;

  return (
    <span
      aria-label={
        currentLabel
          ? `工程: ${currentLabel}(${currentIndex + 1}/${PROCESS_STEPS_9.length})`
          : '工程: 未設定'
      }
      className={cn('inline-flex items-center gap-1.5', className)}
      data-testid="process-progress-dots"
    >
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {PROCESS_STEPS_9.map((step, index) => {
          const state = stepStateAt(index, currentIndex);
          return (
            <span
              key={step.key}
              data-state={state}
              className={cn(
                'rounded-full',
                state === 'done' && 'size-1.5 bg-emerald-500',
                state === 'current' && 'size-2.5 bg-primary',
                state === 'upcoming' && 'size-1.5 bg-muted-foreground/25',
              )}
            />
          );
        })}
      </span>
      {currentLabel ? (
        <span className="text-xs font-medium text-foreground">{currentLabel}</span>
      ) : null}
    </span>
  );
}
