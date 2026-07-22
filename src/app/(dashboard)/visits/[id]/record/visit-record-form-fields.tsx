'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import {
  AlertTriangle,
  Paperclip,
  MessageSquare,
  Eye,
  Brain,
  Check,
  ClipboardList,
  User,
  CalendarCheck,
  Clock,
  MapPin,
  LocateFixed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSection } from '@/components/layout/page-section';
import { cn } from '@/lib/utils';
import {
  FINAL_SECTION_STEP_IDS,
  MEDICATION_ADHERENCE_CHOICES,
  applyMedicationAdherenceChoice,
  applyMedicationAdherenceMemo,
  deriveMedicationAdherenceChoice,
  mobileVisitStepSectionClassName,
} from './visit-mode-mobile.shared';
import { ResidualMedicationForm } from '@/components/features/visits/residual-medication-form';
import { VisitMedicationStockObservationPanel } from '@/components/features/visits/visit-medication-stock-observation-panel';
import { SoapVoiceFieldToggle } from '@/components/features/visits/soap-voice-field-toggle';
import { VoiceSoapAssist } from '@/components/features/visits/voice-soap-assist';
import { PatientCareTeamSourcePanel } from '@/components/features/visits/patient-care-team-source-panel';
import { VisitReportReadinessPanel } from '@/components/features/visits/visit-report-readiness-panel';
import { CdsAlertPanel } from '@/components/features/cds/alert-panel';
import { VisitCompletionReadinessWarning } from './visit-completion-readiness-warning';

import type { useVisitRecordFormController } from './visit-record-form-controller';
import {
  formatVisitBillingAmount,
  formatVisitBillingDateTime,
  formatVisitExecutionTimestamp,
  medicationManagerOptions,
  outcomeOptions,
  relationOptions,
  type FormValues,
} from './visit-record-form-model';

function VisitRecordWorkflowSection({
  title,
  description,
  children,
  id,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** 訪問ステップナビ(p0_22)のアンカー。scroll-margin で固定ヘッダー分を逃がす */
  id?: string;
  /** p0_23: モバイルウィザードのステップ表示制御(max-md:hidden)を渡す */
  className?: string;
}) {
  return (
    <PageSection
      id={id}
      title={title}
      description={description}
      // <md はウィザードの 1 ステップ 1 画面(p0_23)。セクションのカード装飾と
      // 見出しを外し、ウィザード側のステップ見出しに置き換える(md 以上は不変)
      className={cn('scroll-mt-24', className)}
      headerClassName="max-md:hidden"
      contentClassName="space-y-3 sm:space-y-4"
      mobileSurface="bare"
    >
      {children}
    </PageSection>
  );
}

export function VisitRecordFormFields({
  controller,
}: {
  controller: ReturnType<typeof useVisitRecordFormController>;
}) {
  const {
    id,
    medicationStockObservationWriteEnabled,
    mobileStepId,
    medicationStockDrafts,
    setMedicationStockDrafts,
    medicationStockValidationErrors,
    setMedicationStockValidationErrors,
    medicationStockSubmissionState,
    visitGeoLog,
    locationTrackingEnabled,
    locationCaptureState,
    reflectToPatientDetail,
    setReflectToPatientDetail,
    reflectCareLevel,
    setReflectCareLevel,
    reflectMedicationManager,
    setReflectMedicationManager,
    carryItemAcknowledgementErrorId,
    isOffline,
    schedule,
    visitAlertsLoading,
    visitAlertsError,
    carryItemsWarning,
    visitAlerts,
    form,
    outcomeStatus,
    requiresCarryItemWarningAcknowledgement,
    carryItemWarningAcknowledged,
    carryItemAcknowledgementError,
    visitDate,
    visitStartedAt,
    visitEndedAt,
    receiptPersonRelation,
    flushCurrentDraftSnapshot,
    handleVisitStartClick,
    handleVisitEndClick,
    visitPreparationSourceStatus,
    patientCareTeamContacts,
    structuredSoapDraft,
    billingCollectionContext,
    createRecord,
    retryMedicationStockSubmission,
    currentPendingSyncCount,
    attachmentsField,
    voiceRecognition,
    missingHomeVisit2026Items,
    isCompletionOutcome,
    visitReportReadinessItems,
    handleStructuredSoapChange,
    medicationManagementSection,
  } = controller;
  return (
    <>
      <VisitRecordWorkflowSection
        id="visit-step-readiness"
        title="訪問前確認"
        description="現地で迷わないための担当者、会議からの引き継ぎ、薬学的管理、位置情報、同期状態を先に確認します。"
        className={mobileVisitStepSectionClassName(mobileStepId, ['visit-step-readiness'])}
      >
        {medicationManagementSection}

        {visitPreparationSourceStatus === 'ready' || visitPreparationSourceStatus === 'stale' ? (
          <PatientCareTeamSourcePanel contacts={patientCareTeamContacts} compact />
        ) : null}

        {carryItemsWarning && (
          <Card className="border-l-4 border-border/70 border-l-state-blocked bg-card">
            <CardHeader className="pb-3">
              <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-state-blocked">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                {carryItemsWarning.title}
              </h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-state-blocked">
              <p>{carryItemsWarning.description}</p>
              {requiresCarryItemWarningAcknowledgement && (
                <div className="space-y-1.5">
                  <label className="flex min-h-11 items-start gap-3 rounded-lg border border-state-blocked/30 bg-background/70 px-3 py-3">
                    <Checkbox
                      checked={Boolean(carryItemWarningAcknowledged)}
                      onCheckedChange={(checked) => {
                        const acknowledged = Boolean(checked);
                        form.setValue('carry_item_warning_acknowledged', acknowledged, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        if (acknowledged) {
                          form.clearErrors('carry_item_warning_acknowledged');
                        }
                      }}
                      aria-describedby={
                        carryItemAcknowledgementError ? carryItemAcknowledgementErrorId : undefined
                      }
                      aria-invalid={Boolean(carryItemAcknowledgementError)}
                      aria-labelledby="carry-item-warning-acknowledgement-label"
                    />
                    <span id="carry-item-warning-acknowledgement-label">
                      未確定の持参物を確認し、代替手配または現地対応方針を確認しました。
                    </span>
                  </label>
                  {carryItemAcknowledgementError && (
                    <p
                      id={carryItemAcknowledgementErrorId}
                      className="text-xs text-destructive"
                      role="alert"
                    >
                      {carryItemAcknowledgementError}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(visitAlertsLoading || visitAlertsError || visitAlerts.length > 0) && (
          <Card className="border-l-4 border-border/70 border-l-state-confirm bg-card">
            <CardHeader className="pb-3">
              <h3 className="font-heading text-sm leading-snug font-medium text-state-confirm">
                訪問時チェック
              </h3>
            </CardHeader>
            <CardContent>
              <CdsAlertPanel
                alerts={visitAlerts}
                isLoading={visitAlertsLoading}
                isUnavailable={visitAlertsError}
              />
            </CardContent>
          </Card>
        )}

        <Card className="border-l-4 border-border/70 border-l-tag-info bg-card">
          <CardHeader className="pb-3">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-tag-info">
              <Clock className="h-4 w-4 text-tag-info" aria-hidden="true" />
              訪問実施エビデンス
            </h3>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              訪問開始と訪問終了は時刻として保存します。位置情報は補助証跡で、無効化はユーザー設定から行えます。
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">開始時刻</p>
                <p className="mt-1 font-medium text-foreground">
                  {formatVisitExecutionTimestamp(visitStartedAt)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {visitGeoLog?.start
                    ? `位置: ${visitGeoLog.start.latitude.toFixed(5)}, ${visitGeoLog.start.longitude.toFixed(5)}`
                    : '位置情報は未記録'}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">終了時刻</p>
                <p className="mt-1 font-medium text-foreground">
                  {formatVisitExecutionTimestamp(visitEndedAt)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {visitGeoLog?.end
                    ? `位置: ${visitGeoLog.end.latitude.toFixed(5)}, ${visitGeoLog.end.longitude.toFixed(5)}`
                    : '訪問終了ボタンで明示記録します'}
                </p>
              </div>
            </div>
            {form.formState.errors.visit_ended_at?.message ? (
              <p className="text-xs font-medium text-state-blocked" role="alert">
                {form.formState.errors.visit_ended_at.message}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex min-h-9 items-center">
                <MapPin className="mr-1 h-4 w-4" aria-hidden="true" />
                位置権限: {visitGeoLog?.permission ?? (locationTrackingEnabled ? 'prompt' : 'off')}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void handleVisitStartClick()}
                disabled={locationCaptureState !== 'idle'}
              >
                <LocateFixed className="h-4 w-4" aria-hidden="true" />
                {locationCaptureState === 'capturing-start'
                  ? '開始を取得中...'
                  : visitStartedAt
                    ? '開始を更新'
                    : '訪問開始を記録'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void handleVisitEndClick()}
                disabled={locationCaptureState !== 'idle'}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {locationCaptureState === 'capturing-end'
                  ? '終了を取得中...'
                  : visitEndedAt
                    ? '終了を更新'
                    : '訪問終了を記録'}
              </Button>
              <a
                href="/settings"
                className="inline-flex min-h-[44px] items-center rounded-[min(var(--radius-md),12px)] px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                設定で無効化
              </a>
            </div>
          </CardContent>
        </Card>

        {(isOffline || currentPendingSyncCount > 0) && (
          <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-state-confirm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-medium">
                  {isOffline
                    ? '現在オフラインです。保存すると端末に下書きし、再接続後に同期します。'
                    : '同期待ちの訪問記録があります。'}
                </p>
                {currentPendingSyncCount > 0 ? (
                  <p className="text-xs text-state-confirm/90">
                    同期待ち {currentPendingSyncCount} 件
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </VisitRecordWorkflowSection>

      <VisitRecordWorkflowSection
        id="visit-step-status"
        title="入力状況"
        description="報告書化と訪問薬剤管理の確認事項がどこまで揃っているかを見ます。"
        className={mobileVisitStepSectionClassName(mobileStepId, ['visit-step-status'])}
      >
        <VisitReportReadinessPanel mode="visit_mobile" items={visitReportReadinessItems} />
      </VisitRecordWorkflowSection>

      <VisitRecordWorkflowSection
        id="visit-step-result"
        title="訪問結果"
        description="訪問日の確定と、完了・延期・再訪などの結果を先に決めます。"
        className={mobileVisitStepSectionClassName(mobileStepId, ['visit-step-result'])}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="visit_date">
              訪問日
              {/* 必須はテキスト表記で統一(SSOT 5.4: アスタリスク単独は不可)。 */}
              <span className="ml-1 text-xs font-normal text-muted-foreground">（必須）</span>
            </Label>
            <Input
              id="visit_date"
              type="date"
              aria-invalid={!!form.formState.errors.visit_date}
              {...form.register('visit_date')}
            />
            {form.formState.errors.visit_date && (
              <p className="text-xs text-destructive" role="alert">
                {form.formState.errors.visit_date.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="outcome_status">
              訪問結果
              <span className="ml-1 text-xs font-normal text-muted-foreground">（必須）</span>
            </Label>
            <Select
              value={outcomeStatus}
              onValueChange={(v) =>
                form.setValue('outcome_status', v as FormValues['outcome_status'])
              }
            >
              <SelectTrigger id="outcome_status" className="w-full">
                <SelectValue placeholder="訪問結果を選択" />
              </SelectTrigger>
              <SelectContent>
                {outcomeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.outcome_status && (
              <p className="text-xs text-destructive" role="alert">
                {form.formState.errors.outcome_status.message}
              </p>
            )}
          </div>
        </div>

        {outcomeStatus === 'cancelled' && (
          <div className="space-y-1.5">
            <Label htmlFor="cancellation_reason">キャンセル理由</Label>
            <Textarea
              id="cancellation_reason"
              placeholder="キャンセルの理由を入力してください"
              rows={2}
              {...form.register('cancellation_reason')}
            />
          </div>
        )}
        {outcomeStatus === 'postponed' && (
          <div className="space-y-1.5">
            <Label htmlFor="postpone_reason">延期理由</Label>
            <Textarea
              id="postpone_reason"
              placeholder="延期の理由を入力してください"
              rows={2}
              {...form.register('postpone_reason')}
            />
          </div>
        )}
        {outcomeStatus === 'revisit_needed' && (
          <div className="space-y-1.5">
            <Label htmlFor="revisit_reason">再訪理由</Label>
            <Textarea
              id="revisit_reason"
              placeholder="再訪が必要な理由を入力してください"
              rows={2}
              {...form.register('revisit_reason')}
            />
          </div>
        )}
      </VisitRecordWorkflowSection>

      <VisitRecordWorkflowSection
        id="visit-step-soap"
        title="現地記録"
        description="S/O/A/Pを中心に、訪問先で確認した薬学的評価と介入内容を記録します。"
        className={mobileVisitStepSectionClassName(mobileStepId, ['visit-step-soap'])}
      >
        {/* p0_23(<md のみ): 服薬状況の 3 択カード+メモ(任意)。
                  既存の structured_soap.objective(medication_status / adherence_score /
                  free_text)へ射影し、新規フィールドは作らない */}
        <div className="space-y-2 md:hidden" role="group" aria-label="服薬状況の確認">
          {MEDICATION_ADHERENCE_CHOICES.map((choice) => {
            const selected =
              deriveMedicationAdherenceChoice(structuredSoapDraft.objective) === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                data-testid={`medication-adherence-choice-${choice.value}`}
                onClick={() =>
                  handleStructuredSoapChange(
                    applyMedicationAdherenceChoice(structuredSoapDraft, choice.value),
                  )
                }
                className={cn(
                  'flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors',
                  selected
                    ? 'border-state-done/30 bg-state-done/10 text-state-done'
                    : 'border-border bg-card text-foreground hover:bg-muted/40',
                )}
              >
                <span>{choice.label}</span>
                {selected ? (
                  <Check className="size-4 shrink-0 text-state-done" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5 md:hidden">
          <Label htmlFor="medication_adherence_memo" className="sr-only">
            服薬・副作用のメモ(任意)
          </Label>
          <Textarea
            id="medication_adherence_memo"
            placeholder="メモ(任意)"
            rows={3}
            value={structuredSoapDraft.objective.free_text ?? ''}
            onChange={(event) =>
              handleStructuredSoapChange(
                applyMedicationAdherenceMemo(structuredSoapDraft, event.target.value),
              )
            }
          />
        </div>

        <VoiceSoapAssist
          activeField={voiceRecognition.activeField}
          disabled={createRecord.isPending}
          error={voiceRecognition.error}
          interimTranscript={voiceRecognition.interimTranscript}
          isOffline={isOffline}
          isSupported={voiceRecognition.isSupported}
          lastTranscript={voiceRecognition.transcript}
          onToggle={voiceRecognition.toggleListening}
        />

        {/* SOAP — mobile 1-column / tablet 2-column */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:gap-5">
          {/* S + O (left column) */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <h3 className="flex items-center justify-between gap-2 font-heading text-sm leading-snug font-medium">
                  <span className="inline-flex items-center gap-2">
                    <MessageSquare className="size-4 text-soap-s" aria-hidden="true" />S —
                    主観情報（患者の訴え）
                  </span>
                  <SoapVoiceFieldToggle
                    field="soap_subjective"
                    activeField={voiceRecognition.activeField}
                    disabled={createRecord.isPending}
                    error={voiceRecognition.error}
                    interimTranscript={voiceRecognition.interimTranscript}
                    isOffline={isOffline}
                    isSupported={voiceRecognition.isSupported}
                    onToggle={voiceRecognition.toggleListening}
                  />
                </h3>
              </CardHeader>
              <CardContent>
                <Textarea
                  id="soap_subjective"
                  placeholder="患者・家族からの訴え、服薬状況の自己申告など"
                  rows={5}
                  aria-label="主観情報"
                  {...form.register('soap_subjective')}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <h3 className="flex items-center justify-between gap-2 font-heading text-sm leading-snug font-medium">
                  <span className="inline-flex items-center gap-2">
                    <Eye className="size-4 text-soap-o" aria-hidden="true" />O —
                    客観情報（観察・計測）
                  </span>
                  <SoapVoiceFieldToggle
                    field="soap_objective"
                    activeField={voiceRecognition.activeField}
                    disabled={createRecord.isPending}
                    error={voiceRecognition.error}
                    interimTranscript={voiceRecognition.interimTranscript}
                    isOffline={isOffline}
                    isSupported={voiceRecognition.isSupported}
                    onToggle={voiceRecognition.toggleListening}
                  />
                </h3>
              </CardHeader>
              <CardContent>
                <Textarea
                  id="soap_objective"
                  placeholder="残薬確認、保管状況、副作用観察、バイタル、介助者の様子など"
                  rows={5}
                  aria-label="客観情報"
                  {...form.register('soap_objective')}
                />
              </CardContent>
            </Card>
          </div>

          {/* A + P (right column) */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <h3 className="flex items-center justify-between gap-2 font-heading text-sm leading-snug font-medium">
                  <span className="inline-flex items-center gap-2">
                    <Brain className="size-4 text-soap-a" aria-hidden="true" />A — 薬学的評価
                  </span>
                  <SoapVoiceFieldToggle
                    field="soap_assessment"
                    activeField={voiceRecognition.activeField}
                    disabled={createRecord.isPending}
                    error={voiceRecognition.error}
                    interimTranscript={voiceRecognition.interimTranscript}
                    isOffline={isOffline}
                    isSupported={voiceRecognition.isSupported}
                    onToggle={voiceRecognition.toggleListening}
                  />
                </h3>
              </CardHeader>
              <CardContent>
                <Textarea
                  id="soap_assessment"
                  placeholder="処方の適正評価、相互作用、副作用リスク、アドヒアランス評価など"
                  rows={5}
                  aria-label="薬学的評価"
                  {...form.register('soap_assessment')}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <h3 className="flex items-center justify-between gap-2 font-heading text-sm leading-snug font-medium">
                  <span className="inline-flex items-center gap-2">
                    <ClipboardList className="size-4 text-soap-p" aria-hidden="true" />P —
                    計画・介入
                  </span>
                  <SoapVoiceFieldToggle
                    field="soap_plan"
                    activeField={voiceRecognition.activeField}
                    disabled={createRecord.isPending}
                    error={voiceRecognition.error}
                    interimTranscript={voiceRecognition.interimTranscript}
                    isOffline={isOffline}
                    isSupported={voiceRecognition.isSupported}
                    onToggle={voiceRecognition.toggleListening}
                  />
                </h3>
              </CardHeader>
              <CardContent>
                <Textarea
                  id="soap_plan"
                  placeholder="介入内容、次回対応事項、多職種連携の要否、処方医への報告など"
                  rows={5}
                  aria-label="計画・介入"
                  {...form.register('soap_plan')}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </VisitRecordWorkflowSection>

      <VisitRecordWorkflowSection
        id="visit-step-final"
        title="保存前チェック"
        description="受領記録、次回提案、残薬、添付をまとめて確認して保存します。"
        className={mobileVisitStepSectionClassName(mobileStepId, FINAL_SECTION_STEP_IDS)}
      >
        {/* Receipt record(p0_23: モバイルはステップ5のみ表示) */}
        <Card
          id="visit-step-receipt"
          className={cn(
            'scroll-mt-24',
            mobileVisitStepSectionClassName(mobileStepId, ['visit-step-receipt']),
          )}
        >
          <CardHeader className="pb-2">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
              <User className="size-4 text-muted-foreground" aria-hidden="true" />
              受領記録
            </h3>
          </CardHeader>
          <CardContent className="space-y-4">
            {billingCollectionContext ? (
              <div
                className="rounded-md border border-border/70 bg-muted/30 p-3"
                data-testid="visit-billing-collection-context"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">集金確認</p>
                    <p className="text-xs text-muted-foreground">
                      {billingCollectionContext.billing_name ?? '請求候補'} /{' '}
                      {billingCollectionContext.collection_timing_label ?? '集金タイミング未設定'}
                    </p>
                  </div>
                  {billingCollectionContext.candidate_id ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/billing/candidates?${new URLSearchParams({
                          patient_id: schedule?.patient_id ?? '',
                          candidate_id: billingCollectionContext.candidate_id,
                          workflow_from: 'visit_record',
                          schedule_id: id,
                          ...(billingCollectionContext.billing_month
                            ? {
                                billing_month: billingCollectionContext.billing_month.slice(0, 10),
                              }
                            : {}),
                        }).toString()}`}
                      >
                        請求候補を開く
                      </Link>
                    </Button>
                  ) : null}
                </div>
                <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-xs text-muted-foreground">今回徴収</dt>
                  <dd className="font-medium text-foreground">
                    {formatVisitBillingAmount(billingCollectionContext.current_collection_amount)}
                  </dd>
                  <dt className="text-xs text-muted-foreground">前回未収分</dt>
                  <dd className="font-medium text-foreground">
                    {formatVisitBillingAmount(billingCollectionContext.previous_unpaid_amount)}
                  </dd>
                  <dt className="text-xs text-muted-foreground">合計徴収額</dt>
                  <dd className="font-medium text-foreground">
                    {formatVisitBillingAmount(billingCollectionContext.total_collection_amount)}
                  </dd>
                  <dt className="text-xs text-muted-foreground">支払者</dt>
                  <dd className="font-medium text-foreground">
                    {[billingCollectionContext.payer_name, billingCollectionContext.payer_relation]
                      .filter(Boolean)
                      .join(' / ') || '未記録'}
                  </dd>
                  <dt className="text-xs text-muted-foreground">集金方法</dt>
                  <dd className="font-medium text-foreground">
                    {billingCollectionContext.collection_method_label ?? '未記録'}
                  </dd>
                  <dt className="text-xs text-muted-foreground">領収証</dt>
                  <dd className="font-medium text-foreground">
                    {[
                      billingCollectionContext.receipt_issue_label,
                      billingCollectionContext.receipt_issue_status_label,
                      billingCollectionContext.receipt_number,
                    ]
                      .filter(Boolean)
                      .join(' / ') || '未記録'}
                  </dd>
                  <dt className="text-xs text-muted-foreground">次回集金予定</dt>
                  <dd className="font-medium text-foreground">
                    {formatVisitBillingDateTime(billingCollectionContext.scheduled_collection_at)}
                  </dd>
                  <dt className="text-xs text-muted-foreground">入金済み</dt>
                  <dd className="font-medium text-foreground">
                    {formatVisitBillingAmount(billingCollectionContext.collected_amount)}
                  </dd>
                  <dt className="text-xs text-muted-foreground">集金記録者</dt>
                  <dd className="font-medium text-foreground">
                    {billingCollectionContext.collector_user_id ? '記録済み' : '未記録'}
                  </dd>
                </dl>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="receipt_person_name">受領者名</Label>
                <Input
                  id="receipt_person_name"
                  placeholder="例: 山田 花子"
                  aria-invalid={Boolean(form.formState.errors.receipt_person_name)}
                  {...form.register('receipt_person_name')}
                />
                {form.formState.errors.receipt_person_name && (
                  <p className="text-xs text-destructive" role="alert">
                    {form.formState.errors.receipt_person_name.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt_person_relation">続柄</Label>
                <Select
                  value={receiptPersonRelation}
                  onValueChange={(v) =>
                    form.setValue('receipt_person_relation', v ?? undefined, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="receipt_person_relation" className="w-full">
                    <SelectValue placeholder="続柄を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {relationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.receipt_person_relation && (
                  <p className="text-xs text-destructive" role="alert">
                    {form.formState.errors.receipt_person_relation.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt_at">受領日時</Label>
                <Input
                  id="receipt_at"
                  type="datetime-local"
                  aria-invalid={Boolean(form.formState.errors.receipt_at)}
                  {...form.register('receipt_at')}
                  defaultValue={`${visitDate}T00:00`}
                />
                {form.formState.errors.receipt_at && (
                  <p className="text-xs text-destructive" role="alert">
                    {form.formState.errors.receipt_at.message}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next visit suggestion(p0_23: モバイルはステップ6のみ表示) */}
        <Card
          id="visit-step-next-visit"
          className={cn(
            'scroll-mt-24',
            mobileVisitStepSectionClassName(mobileStepId, ['visit-step-next-visit']),
          )}
        >
          <CardHeader className="pb-2">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
              <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              次回訪問提案
            </h3>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="next_visit_suggestion_date">次回提案日</Label>
              <Input
                id="next_visit_suggestion_date"
                type="date"
                {...form.register('next_visit_suggestion_date')}
              />
            </div>
            {schedule?.recurrence_rule && (
              <p className="text-xs text-muted-foreground">
                定期ルール: {schedule.recurrence_rule}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Residual medications(p0_23: モバイルはステップ7のみ表示) */}
        <Card
          id="visit-step-residual"
          className={cn(
            'scroll-mt-24',
            mobileVisitStepSectionClassName(mobileStepId, ['visit-step-residual']),
          )}
        >
          <CardContent className="space-y-4 pt-4">
            <VisitMedicationStockObservationPanel
              patientId={schedule?.patient_id ?? null}
              writeEnabled={medicationStockObservationWriteEnabled}
              drafts={medicationStockDrafts}
              onDraftsChange={(drafts) => {
                setMedicationStockDrafts(drafts);
                setMedicationStockValidationErrors({});
              }}
              validationErrors={medicationStockValidationErrors}
              submissionState={medicationStockSubmissionState}
              onRetrySubmission={() => void retryMedicationStockSubmission()}
            />
            <ResidualMedicationForm
              onImmediateDraftSave={() => flushCurrentDraftSnapshot({ force: true })}
            />
          </CardContent>
        </Card>

        {isCompletionOutcome && missingHomeVisit2026Items.length > 0 ? (
          <div
            className={mobileVisitStepSectionClassName(mobileStepId, ['visit-step-final-check'])}
          >
            <VisitCompletionReadinessWarning items={missingHomeVisit2026Items} />
          </div>
        ) : null}

        <Card
          id="visit-step-evidence"
          className={cn(
            'scroll-mt-24',
            mobileVisitStepSectionClassName(mobileStepId, ['visit-step-evidence']),
          )}
        >
          <CardHeader className="pb-2">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
              <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
              写真・添付
            </h3>
          </CardHeader>
          <CardContent>{attachmentsField}</CardContent>
        </Card>

        {/* ⑤ 反映導線: 訪問中に確認した患者情報を患者詳細(正本)へ反映する任意セクション */}
        <Card
          id="patient-detail-reflect"
          className={cn(
            'scroll-mt-24',
            mobileVisitStepSectionClassName(mobileStepId, ['visit-step-final-check']),
          )}
        >
          <CardHeader className="pb-2">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
              <User className="size-4 text-muted-foreground" aria-hidden="true" />
              患者情報の更新（任意）
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              訪問中に確認した内容を患者詳細（正本）へ反映できます。入力した項目のみ反映され、空欄は変更しません。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reflect-care-level">介護度</Label>
                <Input
                  id="reflect-care-level"
                  value={reflectCareLevel}
                  onChange={(event) => setReflectCareLevel(event.target.value)}
                  placeholder="要介護2 など"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reflect-medication-manager">服薬管理者</Label>
                <Select
                  value={reflectMedicationManager || undefined}
                  onValueChange={(value) => setReflectMedicationManager(value ?? '')}
                >
                  <SelectTrigger id="reflect-medication-manager">
                    <SelectValue placeholder="選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    {medicationManagerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex min-h-11 items-start gap-2 text-sm leading-6">
              <Checkbox
                checked={reflectToPatientDetail}
                onCheckedChange={(checked) => setReflectToPatientDetail(checked === true)}
                aria-labelledby="patient-detail-reflect-label"
                className="mt-0.5"
              />
              <span>
                <span id="patient-detail-reflect-label" className="font-medium text-foreground">
                  この内容を患者詳細に反映する
                </span>
                <span className="block text-xs text-muted-foreground">
                  反映するとオンライン時に患者詳細が更新され、変更履歴に記録されます。
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        {/* Submit(p0_23: モバイルはステップ9のみ表示。送信は下部バーの「訪問完了」) */}
        <div
          id="visit-step-final-check"
          className={cn(
            'scroll-mt-24',
            mobileVisitStepSectionClassName(mobileStepId, ['visit-step-final-check']),
          )}
        >
          <div className="space-y-3 md:hidden">
            <VisitReportReadinessPanel mode="visit_mobile" items={visitReportReadinessItems} />
            <p className="text-sm leading-6 text-muted-foreground">
              内容を確認し、下の「訪問完了」で記録を保存します。
            </p>
          </div>
          {/* md+ の submit 導線は下部固定バーの「訪問完了」に一本化する
                    (SSOT 5.1: 同一の主操作導線を1画面に二重に置かない)。
                    戻る導線はページ上部の WorkflowPageIntro が正本(SSOT 4.4)。 */}
        </div>
      </VisitRecordWorkflowSection>
    </>
  );
}
