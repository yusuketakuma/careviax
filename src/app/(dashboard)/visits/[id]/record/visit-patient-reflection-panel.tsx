'use client';

import { forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { PendingPatientReflection } from './visit-patient-reflection';
import type { PatientReflectionHydrationState } from './visit-patient-reflection-recovery';

export type PatientReflectionRecoveryState = {
  reflection: PendingPatientReflection;
  status: 'stale' | 'failed' | 'ready' | 'resolved';
  reconfirmed: boolean;
};

export function VisitPatientReflectionHydrationNotice({
  state,
  onRetry,
}: {
  state: PatientReflectionHydrationState;
  onRetry: () => void;
}) {
  if (state === 'ready') return null;
  if (state === 'pending') {
    return (
      <div role="status" aria-live="polite" className="border-l-4 border-l-border px-4 py-3">
        <p className="text-sm text-muted-foreground">保存済みの患者反映情報を確認しています。</p>
      </div>
    );
  }
  return (
    <div role="alert" className="space-y-2 border-l-4 border-l-destructive px-4 py-3">
      <p className="font-medium text-foreground">保存済みの患者反映情報を確認できません</p>
      <p className="text-sm leading-6 text-muted-foreground">
        未完了の反映が残っていないことを確認できるまで、訪問記録は送信しません。
      </p>
      <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>
        回復情報を再読み込み
      </Button>
    </div>
  );
}

export const VisitPatientReflectionPanel = forwardRef<
  HTMLDivElement,
  {
    recovery: PatientReflectionRecoveryState;
    disabled?: boolean;
    onRefresh: () => void;
    onReconfirmedChange: (checked: boolean) => void;
    onRetry: () => void;
    onSkip: () => void;
  }
>(function VisitPatientReflectionPanel(
  { recovery, disabled = false, onRefresh, onReconfirmedChange, onRetry, onSkip },
  ref,
) {
  if (recovery.status === 'resolved') {
    return (
      <div
        ref={ref}
        role="alert"
        tabIndex={-1}
        className="mx-4 mt-4 space-y-3 border-l-4 border-l-state-confirm px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="font-medium text-foreground">患者詳細への反映は完了しています</p>
        <p className="text-sm leading-6 text-muted-foreground">
          回復情報の後片付けだけが未完了です。患者詳細への反映は再実行しません。
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled}
          onClick={onSkip}
        >
          完了情報を消去して続行
        </Button>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mx-4 mt-4 space-y-3 border-l-4 border-l-state-confirm px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="font-medium text-foreground">
        訪問記録は保存済みですが、患者詳細への反映は未完了です
      </p>
      <p className="text-sm leading-6 text-muted-foreground">
        {recovery.status === 'stale'
          ? '患者情報または訪問ケースが更新されています。最新版を取得して内容を再確認してください。'
          : recovery.status === 'ready'
            ? '最新版を取得しました。内容を再確認後、患者詳細への反映だけを再試行できます。'
            : '更新元の版を確認できないか、通信に失敗しました。最新版を取得してください。'}
      </p>
      <div className="border border-border/70 bg-card px-3 py-2 text-sm leading-6">
        <p className="font-medium text-foreground">反映する内容</p>
        <dl className="mt-1 grid gap-x-4 sm:grid-cols-2">
          {Object.entries(recovery.reflection.intake).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="text-muted-foreground">
                {key === 'care_level' ? '介護度' : '服薬管理者'}
              </dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {recovery.status === 'ready' ? (
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
          <Checkbox
            checked={recovery.reconfirmed}
            disabled={disabled}
            onCheckedChange={(checked) => onReconfirmedChange(checked === true)}
            aria-describedby="patient-reflection-reconfirm-description"
            className="mt-0.5"
          />
          <span id="patient-reflection-reconfirm-description">
            最新の患者情報と訪問ケースを確認し、この内容を反映します
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled}
          onClick={onRefresh}
        >
          最新情報を再取得
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={disabled || recovery.status !== 'ready' || !recovery.reconfirmed}
          aria-describedby="patient-reflection-retry-description"
          onClick={onRetry}
        >
          反映だけ再試行
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled}
          onClick={onSkip}
        >
          今回は反映しない
        </Button>
      </div>
      <p id="patient-reflection-retry-description" className="text-xs text-muted-foreground">
        再試行しても訪問記録は再送信されません。
      </p>
    </div>
  );
});
