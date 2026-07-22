'use client';

import Link from 'next/link';
import { FormProvider } from 'react-hook-form';
import { Mic, ChevronRight } from 'lucide-react';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import {
  VisitEvidenceRail,
  VisitMobileModeHeader,
  VisitModeHeader,
  VisitStepActionBar,
  VisitStepNav,
  VisitUnsyncedEvidenceBanner,
} from './visit-step-nav';
import { resolveMobileVisitStepHeading } from './visit-mode-mobile.shared';
import { FacilityVisitRecordSwitcher } from '@/components/features/visits/facility-visit-record-switcher';
import { FormErrorSummary } from '@/components/ui/form-error-summary';

import type { useVisitRecordFormController } from './visit-record-form-controller';
import { VisitRecordFormFields } from './visit-record-form-fields';
import {
  VisitPatientReflectionHydrationNotice,
  VisitPatientReflectionPanel,
} from './visit-patient-reflection-panel';

function VisitRecordLoadingState() {
  return (
    <div
      className="space-y-6 py-4"
      role="status"
      aria-label="訪問記録フォームを読み込み中"
      aria-live="polite"
    >
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-border/70 p-3" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-md" />
          ))}
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-border/70 p-4" aria-hidden="true">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 p-4" aria-hidden="true">
            <Skeleton className="h-5 w-36" />
            <div className="mt-4">
              <SkeletonRows rows={4} cols={3} status={false} />
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">訪問記録フォームを読み込み中</span>
    </div>
  );
}

export function VisitRecordFormView({
  controller,
}: {
  controller: ReturnType<typeof useVisitRecordFormController>;
}) {
  const {
    id,
    isBootstrappingOrg,
    mobileStepId,
    medicationStockSubmissionState,
    pendingPatientReflection,
    errorSummaryId,
    isOffline,
    schedule,
    scheduleLoading,
    scheduleError,
    refetchSchedule,
    headerSafety,
    form,
    effectiveFacilityVisitContext,
    createRecord,
    errorSummaryItems,
    activeStepId,
    handleMobileStepSelect,
    unsyncedPhotoCount,
    currentPendingSyncCount,
    visitSaveState,
    handleManualDraftSave,
    handleVisitRecordFormSubmit,
    evidenceRailItems,
    visitDateTimeLabel,
    patientName,
    patientReflectionHydrationState,
    retryPatientReflectionHydration,
    reflectionAlertRef,
    setPendingPatientReflection,
    refreshPatientReflectionAuthority,
    retryPatientReflectionOnly,
    skipPatientReflection,
    patientReflectionRecoveryBusy,
  } = controller;
  if (isBootstrappingOrg || scheduleLoading) {
    return <VisitRecordLoadingState />;
  }

  if (scheduleError || !schedule) {
    return (
      <ErrorState
        variant="server"
        size="page"
        live="assertive"
        title="訪問予定を読み込めませんでした"
        description="訪問予定と患者情報を確認できないため、訪問記録を入力できません。再読み込みしてください。"
        onRetry={() => void refetchSchedule()}
        retryLabel="再読み込み"
      />
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={handleVisitRecordFormSubmit} noValidate>
        {/* p0_23 訪問モード Smartphone(<md): 没入ヘッダ(PH-OS+未同期)+ステップ
            ドット+橙バナー+ステップ見出し。1 ステップ 1 画面のウィザードで進む */}
        <div className="md:hidden">
          <VisitMobileModeHeader
            patientName={patientName}
            dateTimeLabel={visitDateTimeLabel}
            safety={headerSafety}
            isOffline={isOffline}
            pendingSyncCount={currentPendingSyncCount}
            activeStepId={mobileStepId}
            onStepSelect={handleMobileStepSelect}
          />
          {unsyncedPhotoCount > 0 ? <VisitUnsyncedEvidenceBanner className="mt-3" /> : null}
          <h2 className="mt-4 text-lg font-bold text-foreground">
            {resolveMobileVisitStepHeading(mobileStepId)}
          </h2>
        </div>

        {/* p0_22 訪問モード(md 以上): ヘッダ(患者+訪問中+オフライン/未同期)→ 3カラム
            (左=訪問ステップ / 中央=フォーム / 右=写真・証跡)。pb は下部固定バー分の余白 */}
        {/* md+ も sticky 化: AppHeader の下で患者識別と安全タグを隠さない(SSOT 2.3/4.1)。 */}
        <VisitModeHeader
          className="sticky top-[var(--app-header-height)] z-20 max-md:hidden"
          patientName={patientName}
          dateTimeLabel={visitDateTimeLabel}
          safety={headerSafety}
          isOffline={isOffline}
          pendingSyncCount={currentPendingSyncCount}
        />
        <div className="mt-4 pb-24 xl:grid xl:grid-cols-[210px_minmax(0,1fr)_220px] xl:items-start xl:gap-6">
          <aside className="mb-4 max-md:hidden xl:sticky xl:top-6 xl:mb-0 xl:self-start">
            <VisitStepNav activeId={activeStepId} />
          </aside>
          {/* Hidden fields */}
          <input type="hidden" {...form.register('schedule_id')} />
          <input type="hidden" {...form.register('patient_id')} />

          <div className="space-y-5 sm:space-y-6">
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
            <VisitPatientReflectionHydrationNotice
              state={patientReflectionHydrationState}
              onRetry={retryPatientReflectionHydration}
            />
            {pendingPatientReflection ? (
              <VisitPatientReflectionPanel
                ref={reflectionAlertRef}
                recovery={pendingPatientReflection}
                disabled={patientReflectionRecoveryBusy}
                onRefresh={() => void refreshPatientReflectionAuthority()}
                onReconfirmedChange={(reconfirmed) =>
                  setPendingPatientReflection((current) =>
                    current ? { ...current, reconfirmed } : current,
                  )
                }
                onRetry={() => void retryPatientReflectionOnly()}
                onSkip={() => void skipPatientReflection()}
              />
            ) : null}

            <FacilityVisitRecordSwitcher
              currentScheduleId={id}
              context={effectiveFacilityVisitContext}
            />

            <VisitRecordFormFields controller={controller} />

            {/* p0_22/p0_23 下部固定バー: md 以上=一時保存/前へ/次へ/訪問完了、
                md 未満=保存+次へ(最終ステップのみ訪問完了) */}
            <VisitStepActionBar
              activeId={activeStepId}
              mobileStepId={mobileStepId}
              saveState={visitSaveState}
              onSaveDraft={handleManualDraftSave}
              onMobileStepSelect={handleMobileStepSelect}
              submitPending={
                createRecord.isPending ||
                medicationStockSubmissionState.status !== 'idle' ||
                pendingPatientReflection !== null ||
                patientReflectionHydrationState !== 'ready'
              }
            />
          </div>

          {/* p0_22 右レール: 写真・証跡(xl〜) */}
          <aside className="hidden xl:sticky xl:top-6 xl:block xl:self-start">
            <VisitEvidenceRail items={evidenceRailItems} />
            {/* p1_11 音声メモ・文字起こしへの導線(写真・証跡レールの並び) */}
            <Link
              href={`/visits/${id}/voice-memo`}
              data-testid="visit-voice-memo-link"
              className="group mt-3 flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex items-center gap-2">
                <Mic className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-medium leading-5 text-foreground">
                  音声メモ・文字起こし
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden="true"
              />
            </Link>
          </aside>
        </div>
      </form>
    </FormProvider>
  );
}
