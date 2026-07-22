'use client';
import { useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { clientLog } from '@/lib/utils/client-log';
import { timeIsoToString } from '@/lib/visits/time-of-day';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { useSpeechRecognition } from '@/lib/hooks/use-speech-recognition';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import { enqueueForSync, registerVisitRecordConflict } from '@/lib/stores/sync-engine';
import type { VisitRecordConflictServerSnapshotInput } from '@/types/visit-record-conflict';
import { useVisitStepSpy, type VisitRecordStepId, type VisitSaveState } from './visit-step-nav';
import { countUnsyncedEvidenceDrafts } from './visit-mode-mobile.shared';
import {
  VisitMedicationManagementSection,
  type VisitOutsideMed,
  type VisitPreparationSourceStatus,
} from '@/components/features/visits/visit-medication-management-section';
import { VisitAttachmentsField } from '@/components/features/visits/visit-attachments-field';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import type { StructuredSoap } from '@/types/structured-soap';
import type { VisitMedicationStockObservationRequest } from '@/types/medication-stock';
import { getMissingHomeVisit2026CompletionItems } from '@/lib/visits/home-visit-2026-evidence';
import { appendVoiceTranscript } from '@/lib/voice-recognition';
import { getVisitExecutionQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import {
  buildVisitMedicationStockObservationRequest,
  getVisitMedicationStockSubmissionFailureMessage,
  submitVisitMedicationStockObservations,
} from '@/lib/visits/medication-stock-observation';
import {
  createFacilityVisitRecordHref,
  getNextGroupedVisitScheduleId,
  type FacilityVisitContext,
} from '@/lib/visits/facility-visit-context';
import {
  buildReflectPatientIntake,
  normalizeVisitReceiptPayload,
  resolveVisitRecordSavePresentation,
} from './visit-record-form.shared';
import {
  buildVisitRecordAttachmentPatchResponseSchema,
  buildVisitRecordCreateResponseSchema,
} from './visit-record-form-response-schemas';
import {
  patchPatientReflection,
  persistPatientReflectionContinuation,
  requiresPatientReflectionCareCaseTarget,
  type PendingPatientReflection,
} from './visit-patient-reflection';
import { usePatientReflectionRecovery } from './visit-patient-reflection-recovery';
import {
  VisitPreparationNonRetryableError,
  buildDraftMetadata,
  buildStructuredSoap,
  type FormValues,
  type PendingMedicationStockSubmission,
  type PendingPatientReflectionSubmission,
  type SavedVisitRecord,
  type UploadedVisitAttachment,
  type VisitRecordMutationInput,
} from './visit-record-form-model';
import { useVisitRecordFormBase } from './visit-record-form-base';
import { buildVisitRecordReadiness } from './visit-record-readiness';
export function useVisitRecordFormController({
  id,
  facilityVisitContext = null,
  medicationStockObservationWriteEnabled = false,
}: {
  id: string;
  facilityVisitContext?: FacilityVisitContext | null;
  medicationStockObservationWriteEnabled?: boolean;
}) {
  const {
    router,
    orgId,
    isNetworkOnline,
    isBootstrappingOrg,
    queryClient,
    draftHydrated,
    mobileStepId,
    setMobileStepId,
    demoUnsyncedPhotoCount,
    setDemoUnsyncedPhotoCount,
    selectedAttachments,
    setSelectedAttachments,
    medicationStockDrafts,
    setMedicationStockDrafts,
    medicationStockValidationErrors,
    setMedicationStockValidationErrors,
    medicationStockSubmissionState,
    setMedicationStockSubmissionState,
    pendingMedicationStockSubmission,
    setPendingMedicationStockSubmission,
    draftSaveStatus,
    setDraftSaveStatus,
    hasLocalDraft,
    setHasLocalDraft,
    visitGeoLog,
    setVisitGeoLog,
    locationTrackingEnabled,
    locationCaptureState,
    reflectToPatientDetail,
    setReflectToPatientDetail,
    reflectCareLevel,
    setReflectCareLevel,
    reflectMedicationManager,
    setReflectMedicationManager,
    pendingPatientReflection,
    setPendingPatientReflection,
    reflectionAlertRef,
    draftSaveFailureNotifiedRef,
    errorSummaryId,
    carryItemAcknowledgementErrorId,
    isOffline,
    pendingSyncCount,
    pendingQueue,
    refreshSyncState,
    schedule,
    scheduleLoading,
    scheduleError,
    refetchSchedule,
    headerSummary,
    refetchHeaderSummary,
    headerSafety,
    visitAlertsLoading,
    visitAlertsError,
    evidenceDraftSummaries,
    visitPreparationSnapshot,
    visitPreparationQueryError,
    visitPreparationDataUpdatedAt,
    refetchVisitPreparation,
    visitPreparationState,
    carryItemsWarning,
    visitAlerts,
    saveDraft,
    clearDraft,
    notifyDraftSaveFailure,
    form,
    outcomeStatus,
    requiresCarryItemWarningAcknowledgement,
    carryItemWarningAcknowledged,
    carryItemAcknowledgementError,
    visitDate,
    visitStartedAt,
    visitEndedAt,
    receiptPersonRelation,
    watchedValues,
    allowNavigation,
    flushDraftSnapshot,
    flushCurrentDraftSnapshot,
    handleAddAttachments,
    handleRemoveAttachment,
    captureLocationPhase,
    handleVisitStartClick,
    handleVisitEndClick,
    uploadVisitAttachment,
  } = useVisitRecordFormBase({ id, facilityVisitContext, medicationStockObservationWriteEnabled });
  const hasNonRetryableVisitPreparationError =
    visitPreparationQueryError instanceof VisitPreparationNonRetryableError;
  const visitPreparationPack = hasNonRetryableVisitPreparationError
    ? null
    : (visitPreparationSnapshot?.data.pack ?? null);
  const visitPreparationSourceStatus: VisitPreparationSourceStatus =
    visitPreparationState.isInitialLoading
      ? 'loading'
      : hasNonRetryableVisitPreparationError ||
          visitPreparationState.isInitialError ||
          !visitPreparationPack
        ? 'error'
        : visitPreparationState.isStaleAfterRefetchError
          ? 'stale'
          : 'ready';
  const patientCareTeamContacts = visitPreparationPack?.care_team ?? [];
  const billingBlockers = visitPreparationPack?.billing_blockers ?? [];
  const conferenceContext = visitPreparationPack?.conference_context ?? [];
  const medicationPeriod = visitPreparationPack?.medication_period ?? null;
  const prescriptionChanges = visitPreparationPack?.prescription_changes ?? null;
  const outsideMeds: VisitOutsideMed[] = visitPreparationPack?.outside_meds ?? [];
  const previousVisitSummary = visitPreparationPack?.previous_visit?.summary ?? null;
  const previousVisitStructuredReuse =
    visitPreparationPack?.previous_visit?.structured_reuse ?? null;
  const structuredSoapDraft = buildStructuredSoap(watchedValues, previousVisitStructuredReuse);
  const facilityParallelContext = visitPreparationPack?.facility_parallel_context ?? null;
  const billingCollectionContext = visitPreparationPack?.billing_collection_context ?? null;
  const effectiveFacilityVisitContext: FacilityVisitContext | null =
    facilityParallelContext && facilityParallelContext.patients.length > 1
      ? {
          label: facilityParallelContext.label ?? '同一施設',
          siteName: facilityParallelContext.site_name,
          placeKind: facilityParallelContext.place_kind,
          commonNotes: facilityParallelContext.common_notes,
          patients: facilityParallelContext.patients.map((patient) => ({
            scheduleId: patient.schedule_id,
            patientId: patient.patient_id,
            patientName: patient.patient_name,
            patientNameKana: patient.patient_name_kana,
            birthDate: patient.patient_birth_date,
            gender: patient.patient_gender,
            unitName: patient.unit_name,
            routeOrder: patient.route_order,
            scheduleStatus: patient.schedule_status,
            medicationStartDate: patient.medication_start_date,
            medicationEndDate: patient.medication_end_date,
            preparationBlockersCount: patient.preparation_blockers_count,
            visitRecordId: patient.visit_record_id,
            visitOutcomeStatus: patient.visit_outcome_status,
          })),
        }
      : facilityVisitContext;
  const intakeInitialTransitionExpected =
    visitPreparationPack?.intake_context?.initial_transition_management_expected ?? null;
  const submitAttemptLockRef = useRef(false);

  // Create visit record mutation
  const createRecord = useMutation({
    mutationFn: async ({ values }: VisitRecordMutationInput) => {
      const payload = normalizeVisitReceiptPayload({
        ...values,
        patient_id: schedule?.patient_id ?? values.patient_id,
        structured_soap: buildStructuredSoap(values, previousVisitStructuredReuse),
      });

      const res = await fetch('/api/visit-records', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (
          res.status === 409 &&
          err?.details?.existing_record &&
          typeof payload.schedule_id === 'string'
        ) {
          await registerVisitRecordConflict({
            scheduleId: payload.schedule_id,
            payload,
            server: err.details.existing_record as VisitRecordConflictServerSnapshotInput,
          });
          await refreshSyncState();
          throw new Error(
            '既存記録と競合しました。スケジュール画面の競合カードから解決してください。',
          );
        }
        throw new Error(err.message ?? '訪問記録の保存に失敗しました');
      }

      const labPatientId = schedule?.patient_id ?? values.patient_id;
      const record = await readApiJson(res, {
        schema: buildVisitRecordCreateResponseSchema(labPatientId),
        fallbackMessage: '訪問記録の保存に失敗しました',
      });

      let failedReflection: Omit<
        PendingPatientReflectionSubmission,
        'record' | 'attachmentWarning'
      > | null = null;

      if (reflectToPatientDetail && labPatientId) {
        const reflectIntake = buildReflectPatientIntake({
          careLevel: reflectCareLevel,
          medicationManager: reflectMedicationManager,
        });
        if (reflectIntake) {
          const requiresCareCaseTarget = requiresPatientReflectionCareCaseTarget(reflectIntake);
          const intakeEditTarget = headerSummary?.intakeEditTarget ?? null;
          const reflection: PendingPatientReflection = {
            patientId: labPatientId,
            sourceVisitRecordId: record.id,
            intake: reflectIntake,
            expectedUpdatedAt: headerSummary?.patientUpdatedAt ?? '',
            careCaseId: intakeEditTarget?.careCaseId ?? null,
            expectedCareCaseVersion: intakeEditTarget?.expectedCareCaseVersion ?? null,
          };
          if (
            !headerSummary?.patientUpdatedAt ||
            headerSummary.patientId !== labPatientId ||
            (requiresCareCaseTarget && !intakeEditTarget)
          ) {
            failedReflection = {
              reflection,
              status: 'failed',
              reconfirmed: false,
            };
          } else {
            const reflectionResult = await patchPatientReflection(reflection, orgId);
            if (reflectionResult.ok) {
              toast.success('確認した内容を患者詳細に反映しました');
            } else {
              failedReflection = {
                reflection,
                status: reflectionResult.reason,
                reconfirmed: false,
              };
            }
          }
        }
      }

      if (selectedAttachments.length === 0) {
        return {
          record,
          attachmentWarning: null,
          failedReflection,
        };
      }

      try {
        const uploadedAttachments: UploadedVisitAttachment[] = [];
        for (const attachment of selectedAttachments) {
          uploadedAttachments.push(await uploadVisitAttachment(record.id, attachment));
        }

        const patchResponse = await fetch(`/api/visit-records/${record.id}`, {
          method: 'PATCH',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify({
            version: record.version,
            attachments: uploadedAttachments.map((attachment) => ({
              file_id: attachment.file_id,
            })),
          }),
        });

        if (!patchResponse.ok) {
          clientLog.warn('visit_record.attachment_link_failed', undefined, {
            route: '/visits/[id]/record',
            entityType: 'visit_attachment',
            code: 'VISIT_ATTACHMENT_LINK_FAILED',
            status: patchResponse.status,
          });
          return {
            record,
            attachmentWarning: '訪問記録は保存しましたが、添付の紐づけに失敗しました',
            failedReflection,
          };
        }
        const patchedRecord = await readApiJson(patchResponse, {
          schema: buildVisitRecordAttachmentPatchResponseSchema(
            record.id,
            record.patient_id,
            record.version,
          ),
          fallbackMessage: '訪問記録は保存しましたが、添付の紐づけに失敗しました',
        });

        return {
          record: patchedRecord,
          attachmentWarning: null,
          failedReflection,
        };
      } catch (cause) {
        clientLog.warn('visit_record.attachment_upload_failed', cause, {
          route: '/visits/[id]/record',
          entityType: 'visit_attachment',
          code: 'VISIT_ATTACHMENT_UPLOAD_FAILED',
        });
        return {
          record,
          attachmentWarning: '訪問記録は保存しましたが、添付のアップロードに失敗しました',
          failedReflection,
        };
      }
    },
    onSuccess: async ({ record, attachmentWarning, failedReflection }, variables) => {
      await clearDraft();
      setHasLocalDraft(false);
      setDraftSaveStatus('idle');
      await refreshSyncState();
      setSelectedAttachments([]);
      form.reset(form.getValues());
      await invalidateQueryKeys(
        queryClient,
        getVisitExecutionQueryKeys({
          orgId,
          patientId: schedule?.patient_id ?? record.patient_id,
          scheduleId: id,
        }),
      );
      if (attachmentWarning) {
        toast.warning(attachmentWarning);
      }
      if (failedReflection) {
        const continuation = {
          ...failedReflection,
          record,
          attachmentWarning,
          reconfirmed: false,
        } satisfies PendingPatientReflectionSubmission;
        try {
          await persistPatientReflectionContinuation(orgId, {
            scheduleId: id,
            reflection: continuation.reflection,
            record,
            status: continuation.status === 'stale' ? 'stale' : 'failed',
          });
        } catch {
          toast.error('患者詳細への未完了反映を安全に保存できません。この画面で解決してください');
        }
        setPendingPatientReflection(continuation);
        toast.warning('訪問記録は保存しましたが、患者詳細への反映は完了していません');
      }

      if (variables.medicationStockRequest && variables.medicationStockIdempotencyKey) {
        const pending = {
          record,
          attachmentWarning,
          request: variables.medicationStockRequest,
          idempotencyKey: variables.medicationStockIdempotencyKey,
        } satisfies PendingMedicationStockSubmission;
        setPendingMedicationStockSubmission(pending);
        const applied = await submitPendingMedicationStockObservation(pending);
        if (!applied) return;
        if (!failedReflection) {
          await finishSavedVisit(record, attachmentWarning, true, {
            reflectionResolved: true,
            medicationStockResolved: true,
          });
        }
        return;
      }

      if (!failedReflection) {
        await finishSavedVisit(record, attachmentWarning, false, {
          reflectionResolved: true,
          medicationStockResolved: true,
        });
      }
    },
    onError: (err: Error) => {
      clientLog.warn('visit_record.save_failed', err, {
        route: '/visits/[id]/record',
        entityType: 'visit_record',
        code: 'VISIT_RECORD_SAVE_FAILED',
      });
      toast.error('保存に失敗しました');
    },
    onSettled: () => {
      submitAttemptLockRef.current = false;
    },
  });

  async function submitPendingMedicationStockObservation(
    pending: PendingMedicationStockSubmission,
  ): Promise<boolean> {
    setMedicationStockSubmissionState({
      status: 'saving',
      message: '訪問記録は保存済みです。残数観測を登録しています。',
    });
    const result = await submitVisitMedicationStockObservations({
      visitRecordId: pending.record.id,
      orgId,
      idempotencyKey: pending.idempotencyKey,
      request: pending.request,
    });
    if (!result.ok) {
      const failureMessage = getVisitMedicationStockSubmissionFailureMessage(result.status);
      clientLog.warn('visit_record.medication_stock_submission_failed', undefined, {
        route: '/visits/[id]/record',
        entityType: 'medication_stock_observation',
        code: 'VISIT_MEDICATION_STOCK_SUBMISSION_FAILED',
        status: result.status,
      });
      setMedicationStockSubmissionState({ status: result.status, message: failureMessage });
      toast.error(`訪問記録は保存しましたが、${failureMessage}`);
      return false;
    }
    setMedicationStockSubmissionState({ status: 'idle' });
    setPendingMedicationStockSubmission(null);
    setMedicationStockDrafts([]);
    setMedicationStockValidationErrors({});
    return true;
  }

  async function finishSavedVisit(
    record: SavedVisitRecord,
    attachmentWarning: string | null,
    medicationStockApplied: boolean,
    resolved: { reflectionResolved: boolean; medicationStockResolved: boolean },
  ) {
    const reflectionStillPending =
      !resolved.reflectionResolved && pendingPatientReflection !== null;
    const medicationStockStillPending =
      !resolved.medicationStockResolved && pendingMedicationStockSubmission !== null;
    if (reflectionStillPending || medicationStockStillPending) return;
    allowNavigation();
    if (!attachmentWarning) {
      toast.success(
        medicationStockApplied ? '訪問記録と残数観測を保存しました' : '訪問記録を保存しました',
      );
    }
    const nextScheduleId = getNextGroupedVisitScheduleId(id, effectiveFacilityVisitContext);
    if (nextScheduleId && effectiveFacilityVisitContext) {
      router.push(createFacilityVisitRecordHref(nextScheduleId, effectiveFacilityVisitContext));
      return;
    }
    router.push(`/visits/${record.id}`);
  }

  const patientReflectionRecovery = usePatientReflectionRecovery({
    scheduleId: id,
    orgId,
    pending: pendingPatientReflection,
    setPending: setPendingPatientReflection,
    alertRef: reflectionAlertRef,
    refetchSchedule,
    refetchHeader: refetchHeaderSummary,
    onResolved: (completed) =>
      finishSavedVisit(completed.record, completed.attachmentWarning, false, {
        reflectionResolved: true,
        medicationStockResolved: false,
      }),
  });

  async function retryMedicationStockSubmission() {
    if (!pendingMedicationStockSubmission || medicationStockSubmissionState.status === 'saving') {
      return;
    }
    const applied = await submitPendingMedicationStockObservation(pendingMedicationStockSubmission);
    if (!applied) return;
    await finishSavedVisit(
      pendingMedicationStockSubmission.record,
      pendingMedicationStockSubmission.attachmentWarning,
      true,
      { reflectionResolved: false, medicationStockResolved: true },
    );
  }

  async function onSubmit(values: FormValues) {
    if (patientReflectionRecovery.hydrationState !== 'ready') {
      toast.error('保存済みの患者反映情報を確認してから訪問記録を保存してください');
      submitAttemptLockRef.current = false;
      return;
    }
    if (pendingPatientReflection) {
      reflectionAlertRef.current?.focus();
      toast.error('訪問記録は保存済みです。患者詳細への反映結果を確認してください');
      submitAttemptLockRef.current = false;
      return;
    }
    if (pendingMedicationStockSubmission || medicationStockSubmissionState.status !== 'idle') {
      document
        .getElementById('visit-medication-stock-observation-panel')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast.error('訪問記録は保存済みです。残数観測の登録結果を確認してください');
      submitAttemptLockRef.current = false;
      return;
    }
    if (
      requiresCarryItemWarningAcknowledgement &&
      values.carry_item_warning_acknowledged !== true
    ) {
      form.setError('carry_item_warning_acknowledged', {
        type: 'manual',
        message: '持参物一部未確定の確認が必要です',
      });
      scrollToErrorSummary();
      toast.error('持参物一部未確定の確認を完了してから保存してください');
      return;
    }

    const completionStructuredSoap = buildStructuredSoap(values, previousVisitStructuredReuse);
    const completionMissingItems = getMissingHomeVisit2026CompletionItems({
      outcomeStatus: values.outcome_status,
      structuredSoap: completionStructuredSoap,
      visitType: schedule?.visit_type,
      residualMedicationCount: values.residual_medications?.length ?? 0,
      billingBlockers,
      intakeInitialTransitionExpected,
    }).filter((item) => item.required && !item.done);

    if (completionMissingItems.length > 0) {
      form.setError('structured_soap', {
        type: 'manual',
        message: `訪問完了には訪問薬剤管理の必須確認が必要です: ${completionMissingItems
          .slice(0, 4)
          .map((item) => item.label)
          .join(' / ')}`,
      });
      scrollToErrorSummary();
      toast.error('訪問薬剤管理の必須確認を完了してから保存してください');
      return;
    }

    let nextVisitGeoLog = visitGeoLog;
    if (locationTrackingEnabled && !visitGeoLog?.end) {
      const endPoint = await captureLocationPhase('end', {
        silent: true,
      });
      nextVisitGeoLog = {
        enabled: true,
        permission: endPoint ? 'granted' : (visitGeoLog?.permission ?? 'unavailable'),
        start: visitGeoLog?.start ?? null,
        end: endPoint ?? visitGeoLog?.end ?? null,
      };
      setVisitGeoLog(nextVisitGeoLog);
    }

    const payload = normalizeVisitReceiptPayload({
      ...values,
      patient_id: schedule?.patient_id ?? values.patient_id,
      structured_soap: buildStructuredSoap(values, previousVisitStructuredReuse),
      carry_item_warning_acknowledged: requiresCarryItemWarningAcknowledgement
        ? values.carry_item_warning_acknowledged
        : undefined,
      visit_geo_log: locationTrackingEnabled ? (nextVisitGeoLog ?? undefined) : undefined,
    });

    let medicationStockRequest: VisitMedicationStockObservationRequest | null = null;
    let medicationStockIdempotencyKey: string | null = null;
    if (medicationStockDrafts.length > 0) {
      if (!medicationStockObservationWriteEnabled) {
        document
          .getElementById('visit-medication-stock-observation-panel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast.error('残数観測の登録機能はDB連携確認中です。従来の残薬記録を使用してください。');
        return;
      }
      const prepared = buildVisitMedicationStockObservationRequest(medicationStockDrafts);
      if (!prepared.ok) {
        setMedicationStockValidationErrors(prepared.errors);
        document
          .getElementById('visit-medication-stock-observation-panel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast.error('残数観測の入力内容を確認してください');
        return;
      }
      if (!isNetworkOnline || (typeof window !== 'undefined' && !window.navigator.onLine)) {
        toast.error('残数観測がある場合はオンラインで訪問記録を保存してください');
        return;
      }
      medicationStockRequest = prepared.data;
      medicationStockIdempotencyKey = createClientIdempotencyKey('visit-stock-request');
      setMedicationStockValidationErrors({});
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      if (selectedAttachments.length > 0) {
        toast.error('添付ファイルがある場合はオンラインで保存してください');
        return;
      }

      try {
        await saveDraft(
          buildStructuredSoap(values, previousVisitStructuredReuse),
          0,
          buildDraftMetadata(values, nextVisitGeoLog),
        );
        draftSaveFailureNotifiedRef.current = false;
        setHasLocalDraft(true);
        setDraftSaveStatus('saved');
      } catch (error) {
        notifyDraftSaveFailure(error);
        return;
      }
      await enqueueForSync('visit_record', payload);
      await refreshSyncState();
      form.reset(values);
      toast.success('オフラインで下書きを保存しました。再接続後に自動同期します。');
      return;
    }

    createRecord.mutate({
      values: payload,
      medicationStockRequest,
      medicationStockIdempotencyKey,
    });
    return true;
  }

  const errorSummaryItems = collectFormErrorSummaryItems(form.formState.errors, {
    visit_date: '訪問日',
    outcome_status: '訪問結果',
    visit_ended_at: '訪問終了時刻',
    carry_item_warning_acknowledged: '持参物一部未確定の確認',
    structured_soap: '訪問薬剤管理の必須確認',
    receipt_person_name: '受領者名',
    receipt_person_relation: '受領者の続柄',
    receipt_at: '受領日時',
    'residual_medications.*.drug_name': '残薬の薬剤名',
    'residual_medications.*.remaining_quantity': '残薬数',
  });

  const scrollToErrorSummary = useCallback(() => {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const summary = document.getElementById(errorSummaryId);
      summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      summary?.focus();
    });
  }, [errorSummaryId]);

  async function runValidatedSubmit(values: FormValues) {
    let mutationStarted = false;
    try {
      mutationStarted = (await onSubmit(values)) === true;
    } finally {
      if (!mutationStarted) submitAttemptLockRef.current = false;
    }
  }

  function startVisitRecordSubmit(event?: FormEvent<HTMLFormElement>) {
    if (submitAttemptLockRef.current) {
      event?.preventDefault();
      return;
    }
    // React state updates are not synchronous enough to protect a shortcut + click in one tick.
    submitAttemptLockRef.current = true;
    void form.handleSubmit(runValidatedSubmit, () => {
      submitAttemptLockRef.current = false;
      scrollToErrorSummary();
    })(event);
  }

  const shortcutStateRef = useRef({
    watchedValues,
    visitGeoLog,
    onSubmit: runValidatedSubmit,
    previousVisitStructuredReuse,
  });
  useEffect(() => {
    shortcutStateRef.current = {
      watchedValues,
      visitGeoLog,
      onSubmit: runValidatedSubmit,
      previousVisitStructuredReuse,
    };
  });

  // p0_22 訪問ステップ: スクロール現在地(左レール+下部固定バーで共有)
  const activeStepId = useVisitStepSpy();

  // p0_23 モバイルウィザード: ステップ移動(移動後は先頭から読めるよう最上部へ)
  const handleMobileStepSelect = useCallback(
    (stepId: VisitRecordStepId) => {
      flushCurrentDraftSnapshot();
      setMobileStepId(stepId);
      if (typeof document === 'undefined') return;
      const main = document.getElementById('main-content');
      if (main) {
        main.scrollTo({ top: 0 });
      } else {
        window.scrollTo({ top: 0 });
      }
    },
    [flushCurrentDraftSnapshot, setMobileStepId],
  );

  // p0_23 撮影用 dev フック: 未同期写真 2 件相当(橙バナー+未同期バッジ)を再現する
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = window;
    target.__phosSeedVisitModeDemo = () => {
      setDemoUnsyncedPhotoCount(2);
    };
    return () => {
      delete target.__phosSeedVisitModeDemo;
    };
  }, [setDemoUnsyncedPhotoCount]);

  const unsyncedPhotoCount =
    demoUnsyncedPhotoCount ?? countUnsyncedEvidenceDrafts(evidenceDraftSummaries, id);
  const visitSavePresentation = resolveVisitRecordSavePresentation({
    scheduleId: id,
    queueItems: pendingQueue,
    unsyncedEvidenceCount: unsyncedPhotoCount,
    draftHydrated,
    hasLocalDraft,
    draftSaveStatus,
    serverSavePending: createRecord.isPending,
    serverSaved: createRecord.isSuccess,
    medicationStockStatus: medicationStockSubmissionState.status,
  });
  const currentPendingSyncCount = visitSavePresentation.pendingCount;
  const visitSaveState: VisitSaveState = visitSavePresentation.state;
  // 下部固定バーの「一時保存」(Cmd/Ctrl+S と同じ下書き保存)
  const handleManualDraftSave = useCallback(() => {
    const {
      watchedValues: vals,
      visitGeoLog: geoLog,
      previousVisitStructuredReuse: previousReuse,
    } = shortcutStateRef.current;
    flushDraftSnapshot(vals, geoLog, {
      force: true,
      previousReuse,
      onSaved: () => toast.info('下書きを保存しました'),
    });
  }, [flushDraftSnapshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const {
        watchedValues: vals,
        visitGeoLog: geoLog,
        onSubmit: submit,
        previousVisitStructuredReuse: previousReuse,
      } = shortcutStateRef.current;
      if (e.key === 's') {
        e.preventDefault();
        flushDraftSnapshot(vals, geoLog, {
          force: true,
          previousReuse,
          onSaved: () => toast.info('下書きを保存しました'),
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (submitAttemptLockRef.current) return;
        submitAttemptLockRef.current = true;
        void form.handleSubmit(submit, () => {
          submitAttemptLockRef.current = false;
          scrollToErrorSummary();
        })();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flushDraftSnapshot, form, scrollToErrorSummary]);

  function handleVisitRecordFormSubmit(event: FormEvent<HTMLFormElement>) {
    startVisitRecordSubmit(event);
  }

  const attachmentsField = (
    <VisitAttachmentsField
      disabled={createRecord.isPending}
      items={selectedAttachments}
      onAddFiles={handleAddAttachments}
      onRemoveFile={handleRemoveAttachment}
    />
  );

  // p0_22 右レール「写真・証跡」: 保存前の添付は端末上のみ=未同期として表示
  const evidenceRailItems = selectedAttachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.file.name,
    kindLabel: attachment.kind === 'photo' ? '写真' : '添付',
    statusLabel: '未同期',
    statusTone: 'pending' as const,
  }));

  function handleAppendTranscript(
    field: 'soap_subjective' | 'soap_objective' | 'soap_assessment' | 'soap_plan',
    transcript: string,
  ) {
    const currentValue = form.getValues(field) ?? '';
    form.setValue(field, appendVoiceTranscript(currentValue, transcript), {
      shouldDirty: true,
      shouldTouch: true,
    });
  }

  const voiceRecognition = useSpeechRecognition({
    onTranscript: handleAppendTranscript,
  });
  const {
    residualMedicationCount,
    missingHomeVisit2026Items,
    isCompletionOutcome,
    visitReportReadinessItems,
  } = buildVisitRecordReadiness({
    values: watchedValues,
    structuredSoap: structuredSoapDraft,
    visitType: schedule?.visit_type,
    selectedAttachmentCount: selectedAttachments.length,
    visitGeoLog,
    billingBlockers,
    intakeInitialTransitionExpected,
    preparationSourceStatus: visitPreparationSourceStatus,
  });

  function handleStructuredSoapChange(nextStructuredSoap: StructuredSoap) {
    form.setValue('structured_soap', nextStructuredSoap as unknown as Record<string, unknown>, {
      shouldDirty: true,
      shouldTouch: true,
    });
  }

  const medicationManagementSection = (
    <VisitMedicationManagementSection
      structuredSoap={structuredSoapDraft}
      visitType={schedule?.visit_type}
      residualMedicationCount={residualMedicationCount}
      billingBlockers={billingBlockers}
      intakeInitialTransitionExpected={intakeInitialTransitionExpected}
      conferenceContext={conferenceContext}
      medicationPeriod={medicationPeriod}
      prescriptionChanges={prescriptionChanges}
      outsideMeds={outsideMeds}
      previousVisitSummary={previousVisitSummary}
      previousVisitStructuredReuse={previousVisitStructuredReuse}
      preparationSourceStatus={visitPreparationSourceStatus}
      preparationSourceUpdatedAt={visitPreparationDataUpdatedAt || undefined}
      onRetryPreparation={() => void refetchVisitPreparation()}
      onChange={handleStructuredSoapChange}
    />
  );

  useEffect(() => {
    if ((createRecord.isPending || isOffline) && voiceRecognition.isListening) {
      voiceRecognition.stopListening();
    }
  }, [createRecord.isPending, isOffline, voiceRecognition]);

  const visitDateTimeLabel = schedule?.scheduled_date
    ? `${format(parseISO(schedule.scheduled_date), 'M月d日')}${
        schedule.time_window_start
          ? ` ${timeIsoToString(schedule.time_window_start) ?? '時間未定'}`
          : ''
      }`
    : null;
  const patientName = schedule?.case_?.patient?.name ?? null;

  return {
    id,
    medicationStockObservationWriteEnabled,
    isBootstrappingOrg,
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
    pendingPatientReflection,
    setPendingPatientReflection,
    reflectionAlertRef,
    errorSummaryId,
    carryItemAcknowledgementErrorId,
    isOffline,
    pendingSyncCount,
    schedule,
    scheduleLoading,
    scheduleError,
    refetchSchedule,
    headerSafety,
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
    effectiveFacilityVisitContext,
    createRecord,
    retryMedicationStockSubmission,
    refreshPatientReflectionAuthority: patientReflectionRecovery.refreshAuthority,
    retryPatientReflectionOnly: patientReflectionRecovery.retryOnly,
    skipPatientReflection: patientReflectionRecovery.skip,
    patientReflectionRecoveryBusy: patientReflectionRecovery.actionInFlight,
    patientReflectionHydrationState: patientReflectionRecovery.hydrationState,
    retryPatientReflectionHydration: patientReflectionRecovery.retryHydration,
    onSubmit,
    errorSummaryItems,
    activeStepId,
    handleMobileStepSelect,
    unsyncedPhotoCount,
    currentPendingSyncCount,
    visitSaveState,
    handleManualDraftSave,
    handleVisitRecordFormSubmit,
    attachmentsField,
    evidenceRailItems,
    voiceRecognition,
    missingHomeVisit2026Items,
    isCompletionOutcome,
    visitReportReadinessItems,
    handleStructuredSoapChange,
    medicationManagementSection,
    visitDateTimeLabel,
    patientName,
  };
}
