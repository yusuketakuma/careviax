'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { toast } from 'sonner';
import { clientLog } from '@/lib/utils/client-log';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useSoapDraft } from '@/lib/hooks/use-soap-draft';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import { useStaleAfterRefetchError } from '@/lib/hooks/use-stale-after-refetch-error';
import { downscaleImage } from '@/lib/files/downscale-image';
import { computeUploadSha256Hex } from '@/lib/files/upload-checksum';
import { isOfflineEncryptionUnavailableError } from '@/lib/offline/crypto';
import { encodePathSegment } from '@/lib/http/path-segment';
import { listEvidenceDraftSummariesForSchedule } from '@/lib/offline/evidence-drafts';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { setupAutoSync } from '@/lib/stores/sync-engine';
import { useOfflineStore } from '@/lib/stores/offline-store';
import { type VisitRecordStepId } from './visit-step-nav';
import { type VisitMedicationStockObservationSubmissionState } from '@/components/features/visits/visit-medication-stock-observation-panel';
import { type VisitPreviousStructuredReuse } from '@/components/features/visits/visit-medication-management-section';
import { type VisitAttachmentDraft } from '@/components/features/visits/visit-attachments-field';
import { type CdsAlert } from '@/components/features/cds/alert-panel';
import type {
  VisitMedicationStockObservationDraft,
  VisitMedicationStockObservationDraftErrors,
} from '@/types/medication-stock';
import {
  captureVisitGeoPoint,
  getVisitLocationPermissionState,
  getVisitLocationTrackingPreference,
  type VisitGeoLog,
} from '@/lib/visit-location';
import { type FacilityVisitContext } from '@/lib/visits/facility-visit-context';
import {
  buildAttachmentId,
  classifyVisitAttachment,
  validateVisitAttachment,
} from './visit-record-form.shared';
import {
  buildVisitRecordHeaderSafetyResponseSchema,
  buildVisitRecordScheduleResponseSchema,
} from './visit-record-form-response-schemas';
import {
  MAX_VISIT_ATTACHMENTS,
  VISIT_DRAFT_AUTOSAVE_DELAY_MS,
  VISIT_RECORD_ALERT_TYPES,
  VISIT_SYNC_COUNT_POLL_MS,
  VisitPreparationNonRetryableError,
  buildDraftMetadata,
  buildStructuredSoap,
  fetchVisitRecordCdsAlerts,
  formSchema,
  hasMeaningfulVisitDraft,
  visitPreparationSnapshotSchema,
  type FormValues,
  type PendingMedicationStockSubmission,
  type PendingPatientReflectionSubmission,
  type ScheduleDetail,
  type UploadedVisitAttachment,
  type VisitPreparationSnapshot,
} from './visit-record-form-model';
export function useVisitRecordFormBase({
  id,
  facilityVisitContext = null,
  medicationStockObservationWriteEnabled = false,
}: {
  id: string;
  facilityVisitContext?: FacilityVisitContext | null;
  medicationStockObservationWriteEnabled?: boolean;
}) {
  const router = useRouter();
  const orgId = useOrgId();
  const isNetworkOnline = useNetworkOnline();
  const isBootstrappingOrg = !orgId;
  const queryClient = useQueryClient();
  const schedulePathId = encodePathSegment(id);
  const [draftHydrated, setDraftHydrated] = useState(false);
  // p0_23 モバイルウィザード(<md)の現在ステップ。md 以上はスクロール準拠のまま
  const [mobileStepId, setMobileStepId] = useState<VisitRecordStepId>('visit-step-readiness');
  // 撮影・動作確認用のデモ注入(dev 限定、p0_34 の window フックの作法)
  const [demoUnsyncedPhotoCount, setDemoUnsyncedPhotoCount] = useState<number | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<VisitAttachmentDraft[]>([]);
  const [medicationStockDrafts, setMedicationStockDrafts] = useState<
    VisitMedicationStockObservationDraft[]
  >([]);
  const [medicationStockValidationErrors, setMedicationStockValidationErrors] =
    useState<VisitMedicationStockObservationDraftErrors>({});
  const [medicationStockSubmissionState, setMedicationStockSubmissionState] =
    useState<VisitMedicationStockObservationSubmissionState>({ status: 'idle' });
  const [pendingMedicationStockSubmission, setPendingMedicationStockSubmission] =
    useState<PendingMedicationStockSubmission | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [visitGeoLog, setVisitGeoLog] = useState<VisitGeoLog | null>(null);
  const [locationTrackingEnabled] = useState(() =>
    typeof window === 'undefined' ? false : getVisitLocationTrackingPreference(),
  );
  const [locationCaptureState, setLocationCaptureState] = useState<
    'idle' | 'capturing-start' | 'capturing-end'
  >('idle');
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  // ⑤ 反映導線: 訪問中に確認した患者情報を患者詳細(正本)へ反映する任意セクションの状態
  const [reflectToPatientDetail, setReflectToPatientDetail] = useState(false);
  const [reflectCareLevel, setReflectCareLevel] = useState('');
  const [reflectMedicationManager, setReflectMedicationManager] = useState('');
  const [pendingPatientReflection, setPendingPatientReflection] =
    useState<PendingPatientReflectionSubmission | null>(null);
  const reflectionAlertRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCapturedStartRef = useRef(false);
  const draftSaveFailureNotifiedRef = useRef(false);
  const errorSummaryId = 'visit-record-form-error-summary';
  const carryItemAcknowledgementErrorId = 'carry-item-warning-acknowledgement-error';
  const isOffline = useOfflineStore((state) => state.isOffline);
  const pendingSyncCount = useOfflineStore((state) => state.pendingSyncCount);
  const pendingQueue = useOfflineStore((state) => state.pendingQueue);
  const syncOnlineStatus = useOfflineStore((state) => state.syncOnlineStatus);
  const refreshSyncCount = useOfflineStore((state) => state.refreshSyncCount);
  const refreshSyncState = useOfflineStore((state) => state.refreshSyncState);
  const syncCountRefreshFailureNotifiedRef = useRef(false);

  // Fetch schedule details
  const {
    data: schedule,
    isLoading: scheduleLoading,
    isError: scheduleError,
    refetch: refetchSchedule,
  } = useQuery<ScheduleDetail>({
    queryKey: ['schedule', id, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-schedules/${schedulePathId}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        schema: buildVisitRecordScheduleResponseSchema(id),
        fallbackMessage: 'スケジュール情報の取得に失敗しました',
      });
    },
    enabled: !!orgId && !!id,
  });

  // 訪問キャプチャの Pinned に安全タグ(アレルギー等)を常時表示するための患者ヘッダサマリー
  // (SSOT 4.1)。visible_safety_tags は selectVisibleSafetyTags 済み=critical は必ず含まれる。
  const {
    data: headerSummary,
    isError: headerSummaryError,
    refetch: refetchHeaderSummary,
  } = useQuery<{
    patientId: string;
    safety: { visible_safety_tags: string[]; hidden_safety_tag_count: number };
    patientUpdatedAt: string;
    intakeEditTarget: { careCaseId: string; expectedCareCaseVersion: number } | null;
  }>({
    queryKey: ['patient-header-summary', schedule?.patient_id, orgId],
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(schedule?.patient_id ?? '', '/header-summary'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        schema: buildVisitRecordHeaderSafetyResponseSchema(schedule?.patient_id ?? ''),
        fallbackMessage: '患者ヘッダー情報の取得に失敗しました',
      });
    },
    enabled: !!orgId && !!schedule?.patient_id,
  });
  // fail-close: 取得失敗は「タグなし」でなく明示の警告表示(VisitHeaderSafetyTags)。
  const headerSafety = {
    tags: headerSummary?.safety.visible_safety_tags ?? [],
    hiddenCount: headerSummary?.safety.hidden_safety_tag_count ?? 0,
    unavailable: headerSummaryError,
  };

  const {
    data: visitAlertData,
    isLoading: visitAlertsLoading,
    isError: visitAlertsError,
  } = useQuery<{ alerts: CdsAlert[] }>({
    queryKey: ['visit-record-cds-alerts', schedule?.cycle_id, orgId],
    queryFn: () => fetchVisitRecordCdsAlerts(schedule!.cycle_id!, orgId),
    enabled: !!orgId && !!schedule?.cycle_id,
    staleTime: 30_000,
    retry: false,
  });
  // p0_23: この訪問の未同期写真ドラフト(p0_48 撮影分)。橙バナーとモバイル未同期バッジに使う
  const { data: evidenceDraftSummaries } = useQuery({
    queryKey: ['visit-evidence-drafts', id, orgId],
    queryFn: () => (orgId ? listEvidenceDraftSummariesForSchedule(id, orgId) : Promise.resolve([])),
    enabled: !!orgId,
  });

  const visitPreparationQueryKey = ['visit-preparation-care-team', id, orgId] as const;
  const {
    data: visitPreparationSnapshot,
    isLoading: visitPreparationLoading,
    isError: visitPreparationError,
    isRefetchError: visitPreparationRefetchError,
    error: visitPreparationQueryError,
    dataUpdatedAt: visitPreparationDataUpdatedAt,
    refetch: refetchVisitPreparation,
  } = useQuery<VisitPreparationSnapshot | null>({
    queryKey: visitPreparationQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/visit-preparations/${schedulePathId}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) {
        queryClient.setQueryData<VisitPreparationSnapshot | null>(visitPreparationQueryKey, null);
        throw new VisitPreparationNonRetryableError();
      }
      return readApiJson<VisitPreparationSnapshot>(res, {
        fallbackMessage: '訪問準備情報の取得に失敗しました',
        schema: visitPreparationSnapshotSchema,
      });
    },
    enabled: !!orgId && !!schedule?.id,
    retry: false,
  });
  const visitPreparationState = useStaleAfterRefetchError({
    data: visitPreparationSnapshot,
    isLoading: visitPreparationLoading,
    isError: visitPreparationError,
    isRefetchError: visitPreparationRefetchError,
  });

  // 訪問日/受領日時の既定は国内業務日(JST)を正本にする(SSOT 2.8)。format(new Date(),...) は
  // 端末ローカル TZ 解釈で、Asia/Tokyo より遅れた TZ では前日の既定日になり得るため使わない。
  const today = japanDateKey();
  const carryItemsWarning =
    schedule?.carry_items_status === 'blocked'
      ? {
          title: '持参薬が未確定のまま訪問を開始しています',
          description:
            'この訪問は carry_items_status が blocked です。記録入力前に持参物の代替手配または確定状況を再確認してください。',
        }
      : schedule?.carry_items_status === 'partial'
        ? {
            title: '持参物の一部が未確定です',
            description:
              'この訪問は carry_items_status が partial です。未確定分を確認し、現地で対応範囲を誤らないようにしてください。',
          }
        : null;
  const visitAlerts = (visitAlertData?.alerts ?? []).filter((alert) =>
    VISIT_RECORD_ALERT_TYPES.has(alert.type),
  );
  const { loadDraft, saveDraft, clearDraft } = useSoapDraft(id, schedule?.patient_id ?? '');

  const notifyDraftSaveFailure = useCallback((error: unknown) => {
    if (draftSaveFailureNotifiedRef.current) return;
    draftSaveFailureNotifiedRef.current = true;

    if (isOfflineEncryptionUnavailableError(error)) {
      toast.error(
        'オフライン下書きの暗号化キーを確認できないため、SOAP は端末に保存していません。再ログイン後に保存してください。',
      );
      return;
    }

    toast.error('オフライン下書きの保存に失敗しました');
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      schedule_id: id,
      patient_id: schedule?.patient_id ?? '',
      visit_date: today,
      visit_started_at: undefined,
      visit_ended_at: undefined,
      outcome_status: 'completed',
      soap_subjective: '',
      soap_objective: '',
      soap_assessment: '',
      soap_plan: '',
      receipt_person_name: '',
      receipt_person_relation: '',
      receipt_at: `${today}T00:00`,
      next_visit_suggestion_date: '',
      cancellation_reason: '',
      postpone_reason: '',
      revisit_reason: '',
      carry_item_warning_acknowledged: false,
      residual_medications: [],
    },
  });

  const outcomeStatus = useWatch({
    control: form.control,
    name: 'outcome_status',
  });
  const requiresCarryItemWarningAcknowledgement =
    schedule?.carry_items_status === 'partial' &&
    !['postponed', 'cancelled'].includes(outcomeStatus);
  const carryItemWarningAcknowledged = useWatch({
    control: form.control,
    name: 'carry_item_warning_acknowledged',
  });
  const carryItemAcknowledgementError =
    form.formState.errors.carry_item_warning_acknowledged?.message;
  const visitDate =
    useWatch({
      control: form.control,
      name: 'visit_date',
    }) ?? today;
  const visitStartedAt = useWatch({
    control: form.control,
    name: 'visit_started_at',
  });
  const visitEndedAt = useWatch({
    control: form.control,
    name: 'visit_ended_at',
  });
  const receiptPersonRelation =
    useWatch({
      control: form.control,
      name: 'receipt_person_relation',
    }) ?? '';
  const watchedValues = useWatch({
    control: form.control,
  }) as FormValues;
  const allowNavigation = useUnsavedChangesGuard({
    enabled:
      form.formState.isDirty ||
      medicationStockDrafts.length > 0 ||
      pendingMedicationStockSubmission !== null ||
      pendingPatientReflection !== null,
  });
  const isFormDirty = form.formState.isDirty;
  useEffect(() => {
    if (!requiresCarryItemWarningAcknowledgement && carryItemAcknowledgementError) {
      form.clearErrors('carry_item_warning_acknowledged');
    }
  }, [carryItemAcknowledgementError, form, requiresCarryItemWarningAcknowledgement]);

  useEffect(() => {
    syncOnlineStatus();
  }, [isNetworkOnline, syncOnlineStatus]);

  const refreshSyncCountSafely = useCallback(async () => {
    try {
      await refreshSyncCount();
      syncCountRefreshFailureNotifiedRef.current = false;
    } catch {
      if (syncCountRefreshFailureNotifiedRef.current) return;
      syncCountRefreshFailureNotifiedRef.current = true;
      console.warn('[offline-sync] sync count refresh failed');
    }
  }, [refreshSyncCount]);

  const clearAutosaveTimer = useCallback(() => {
    if (!autosaveTimerRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }, []);

  const saveDraftSnapshot = useCallback(
    async (
      values: FormValues,
      geoLog: VisitGeoLog | null,
      previousReuse?: VisitPreviousStructuredReuse | null,
    ) => {
      setDraftSaveStatus('saving');
      try {
        await saveDraft(
          buildStructuredSoap(values, previousReuse),
          0,
          buildDraftMetadata(values, geoLog),
        );
        draftSaveFailureNotifiedRef.current = false;
        setHasLocalDraft(true);
        setDraftSaveStatus('saved');
      } catch (error) {
        setDraftSaveStatus('idle');
        throw error;
      }
    },
    [saveDraft],
  );

  const flushDraftSnapshot = useCallback(
    (
      values: FormValues = form.getValues() as FormValues,
      geoLog: VisitGeoLog | null = visitGeoLog,
      options?: {
        force?: boolean;
        previousReuse?: VisitPreviousStructuredReuse | null;
        onSaved?: () => void;
      },
    ) => {
      clearAutosaveTimer();
      if (!options?.force && !isFormDirty && !hasMeaningfulVisitDraft(values, geoLog)) return;
      void saveDraftSnapshot(values, geoLog, options?.previousReuse)
        .then(() => {
          options?.onSaved?.();
        })
        .catch(notifyDraftSaveFailure);
    },
    [clearAutosaveTimer, form, isFormDirty, notifyDraftSaveFailure, saveDraftSnapshot, visitGeoLog],
  );

  const flushCurrentDraftSnapshot = useCallback(
    (options?: { force?: boolean; onSaved?: () => void }) => {
      if (!schedule?.patient_id || !draftHydrated) return;
      flushDraftSnapshot(form.getValues() as FormValues, visitGeoLog, options);
    },
    [draftHydrated, flushDraftSnapshot, form, schedule?.patient_id, visitGeoLog],
  );

  useEffect(() => {
    if (!orgId || typeof window === 'undefined') return;

    const syncConfig = {
      orgId,
      endpoints: {
        visit_record: '/api/visit-records',
      },
    };
    const teardown = setupAutoSync({
      ...syncConfig,
    });
    const initialTimer = window.setTimeout(() => {
      void refreshSyncCountSafely();
    }, 0);
    const handleOnline = () => {
      syncOnlineStatus();
      void refreshSyncCountSafely();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      teardown();
      window.clearTimeout(initialTimer);
      window.removeEventListener('online', handleOnline);
    };
  }, [orgId, refreshSyncCountSafely, syncOnlineStatus]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsDocumentVisible(visible);
      if (!visible) {
        if (schedule?.patient_id && draftHydrated) {
          flushDraftSnapshot();
        }
        return;
      }
      void refreshSyncCountSafely();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [draftHydrated, flushDraftSnapshot, refreshSyncCountSafely, schedule?.patient_id]);

  useEffect(() => {
    if (!orgId || typeof window === 'undefined') return;
    if (!isDocumentVisible || pendingSyncCount <= 0) return;

    const timer = window.setInterval(() => {
      void refreshSyncCountSafely();
    }, VISIT_SYNC_COUNT_POLL_MS);

    return () => window.clearInterval(timer);
  }, [isDocumentVisible, orgId, pendingSyncCount, refreshSyncCountSafely]);

  useEffect(() => {
    if (!schedule?.patient_id) return;
    form.setValue('patient_id', schedule.patient_id);
  }, [form, schedule?.patient_id]);

  useEffect(() => {
    if (!schedule?.patient_id || draftHydrated) return;

    let active = true;
    void loadDraft()
      .then((draft) => {
        if (!active) return;

        if (draft) {
          setHasLocalDraft(true);
          setVisitGeoLog(draft.visitGeoLog ?? null);
          autoCapturedStartRef.current = Boolean(draft.visitGeoLog?.start);
          form.reset({
            schedule_id: id,
            patient_id: schedule.patient_id,
            visit_date: draft.visitDate ?? today,
            visit_started_at: draft.visitStartedAt ?? undefined,
            visit_ended_at: draft.visitEndedAt ?? undefined,
            outcome_status: (draft.outcomeStatus as FormValues['outcome_status']) ?? 'completed',
            soap_subjective: draft.structuredSoap.subjective.free_text ?? '',
            soap_objective: draft.structuredSoap.objective.free_text ?? '',
            soap_assessment: draft.structuredSoap.assessment.free_text ?? '',
            soap_plan: draft.structuredSoap.plan.free_text ?? '',
            structured_soap: draft.structuredSoap as Record<string, unknown>,
            receipt_person_name: draft.receiptPersonName ?? '',
            receipt_person_relation: draft.receiptPersonRelation ?? '',
            receipt_at: draft.receiptAt ?? `${draft.visitDate ?? today}T00:00`,
            next_visit_suggestion_date:
              draft.nextVisitSuggestionDate ?? draft.structuredSoap.plan.next_visit_date ?? '',
            cancellation_reason: draft.cancellationReason ?? '',
            postpone_reason: draft.postponeReason ?? '',
            revisit_reason: draft.revisitReason ?? '',
            residual_medications: draft.residualMedications,
          });
          toast.info('オフライン下書きを復元しました');
        } else {
          setHasLocalDraft(false);
          setVisitGeoLog(null);
          autoCapturedStartRef.current = false;
        }
      })
      .finally(() => {
        if (active) setDraftHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [draftHydrated, form, loadDraft, schedule?.patient_id, id, today]);

  useEffect(() => {
    if (!schedule?.patient_id || !draftHydrated) return;
    clearAutosaveTimer();
    if (!isFormDirty && !hasMeaningfulVisitDraft(watchedValues, visitGeoLog)) return;

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveDraftSnapshot(watchedValues, visitGeoLog).catch(notifyDraftSaveFailure);
    }, VISIT_DRAFT_AUTOSAVE_DELAY_MS);

    return () => {
      clearAutosaveTimer();
    };
  }, [
    clearAutosaveTimer,
    draftHydrated,
    isFormDirty,
    notifyDraftSaveFailure,
    saveDraftSnapshot,
    schedule?.patient_id,
    visitGeoLog,
    watchedValues,
  ]);

  const handleAddAttachments = useCallback(
    (files: File[]) => {
      const next = [...selectedAttachments];
      const existingKeys = new Set(
        selectedAttachments.map(
          (item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`,
        ),
      );

      for (const file of files) {
        const duplicateKey = `${file.name}:${file.size}:${file.lastModified}`;
        if (existingKeys.has(duplicateKey)) {
          continue;
        }

        const validationMessage = validateVisitAttachment(file);
        if (validationMessage) {
          toast.error(validationMessage);
          continue;
        }

        if (next.length >= MAX_VISIT_ATTACHMENTS) {
          toast.error(`添付は ${MAX_VISIT_ATTACHMENTS} 件までです`);
          break;
        }

        next.push({
          id: buildAttachmentId(file),
          file,
          kind: classifyVisitAttachment(file),
        });
        existingKeys.add(duplicateKey);
      }

      if (next.length > selectedAttachments.length) {
        setSelectedAttachments(next);
        flushCurrentDraftSnapshot({ force: true });
      }
    },
    [flushCurrentDraftSnapshot, selectedAttachments],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setSelectedAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const captureLocationPhase = useCallback(
    async (phase: 'start' | 'end', options?: { silent?: boolean; successMessage?: string }) => {
      if (!locationTrackingEnabled) return null;

      const initialPermission = await getVisitLocationPermissionState();
      if (initialPermission === 'unsupported') {
        setVisitGeoLog((current) => ({
          enabled: true,
          permission: 'unsupported',
          start: current?.start ?? null,
          end: current?.end ?? null,
        }));
        if (!options?.silent) {
          toast.error('この端末では位置情報を利用できません');
        }
        return null;
      }

      if (initialPermission === 'denied') {
        setVisitGeoLog((current) => ({
          enabled: true,
          permission: 'denied',
          start: current?.start ?? null,
          end: current?.end ?? null,
        }));
        if (!options?.silent) {
          toast.error('ブラウザ設定で位置情報の利用を許可してください');
        }
        return null;
      }

      setLocationCaptureState(phase === 'start' ? 'capturing-start' : 'capturing-end');

      try {
        const point = await captureVisitGeoPoint();
        if (phase === 'start' && !form.getValues('visit_started_at')) {
          form.setValue('visit_started_at', point.captured_at, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        setVisitGeoLog((current) => ({
          enabled: true,
          permission: 'granted',
          start: phase === 'start' ? point : (current?.start ?? null),
          end: phase === 'end' ? point : (current?.end ?? null),
        }));
        if (options?.successMessage) {
          toast.success(options.successMessage);
        }
        return point;
      } catch (error) {
        const nextPermission = await getVisitLocationPermissionState();
        setVisitGeoLog((current) => ({
          enabled: true,
          permission: nextPermission === 'granted' ? 'unavailable' : nextPermission,
          start: current?.start ?? null,
          end: current?.end ?? null,
        }));
        clientLog.warn('visit_record.location_capture_failed', error, {
          route: '/visits/[id]/record',
          entityType: 'visit_geo_log',
          code: 'VISIT_LOCATION_CAPTURE_FAILED',
        });
        if (!options?.silent) {
          toast.error('位置情報を取得できませんでした');
        }
        return null;
      } finally {
        setLocationCaptureState('idle');
      }
    },
    [form, locationTrackingEnabled],
  );

  async function handleVisitStartClick() {
    const fallbackStartedAt = new Date().toISOString();
    clearAutosaveTimer();
    if (locationTrackingEnabled) {
      const point = await captureLocationPhase('start', {
        successMessage: '訪問開始を記録しました',
      });
      const startedAt = point?.captured_at ?? fallbackStartedAt;
      form.setValue('visit_started_at', startedAt, {
        shouldDirty: true,
        shouldValidate: true,
      });
      flushDraftSnapshot(
        { ...(form.getValues() as FormValues), visit_started_at: startedAt },
        visitGeoLog,
        { force: true },
      );
      return;
    }

    form.setValue('visit_started_at', fallbackStartedAt, {
      shouldDirty: true,
      shouldValidate: true,
    });
    flushDraftSnapshot(
      {
        ...(form.getValues() as FormValues),
        visit_started_at: fallbackStartedAt,
      },
      visitGeoLog,
      { force: true },
    );
    toast.success('訪問開始を記録しました');
  }

  async function handleVisitEndClick() {
    const currentStartedAt = form.getValues('visit_started_at');
    if (!currentStartedAt) {
      form.setError('visit_ended_at', {
        type: 'manual',
        message: '訪問終了を記録する前に、訪問開始を記録してください',
      });
      toast.error('訪問開始を記録してから終了してください');
      return;
    }

    const fallbackEndedAt = new Date().toISOString();
    clearAutosaveTimer();
    if (locationTrackingEnabled) {
      const point = await captureLocationPhase('end', {
        successMessage: '訪問終了を記録しました',
      });
      const endedAt = point?.captured_at ?? fallbackEndedAt;
      form.setValue('visit_ended_at', endedAt, {
        shouldDirty: true,
        shouldValidate: true,
      });
      flushDraftSnapshot(
        { ...(form.getValues() as FormValues), visit_ended_at: endedAt },
        visitGeoLog,
        { force: true },
      );
      return;
    }

    form.setValue('visit_ended_at', fallbackEndedAt, {
      shouldDirty: true,
      shouldValidate: true,
    });
    flushDraftSnapshot(
      {
        ...(form.getValues() as FormValues),
        visit_ended_at: fallbackEndedAt,
      },
      visitGeoLog,
      { force: true },
    );
    toast.success('訪問終了を記録しました');
  }

  useEffect(() => {
    if (!draftHydrated || !locationTrackingEnabled || autoCapturedStartRef.current) return;
    autoCapturedStartRef.current = true;
    void captureLocationPhase('start', {
      silent: true,
      successMessage: '訪問開始位置を記録しました',
    });
  }, [captureLocationPhase, draftHydrated, locationTrackingEnabled]);

  async function uploadVisitAttachment(recordId: string, attachment: VisitAttachmentDraft) {
    // モバイル撮影画像は長辺 1600px / JPEG 品質 0.85 に縮小してから送信する(W2-F1)。
    // presign の size_bytes は complete 時に S3 実サイズと突合されるため、
    // 縮小後のファイルを presign 段階から一貫して使う(fail-open: 変換失敗時は元ファイル)。
    const uploadFile = await downscaleImage(attachment.file);
    const sha256 = await computeUploadSha256Hex(uploadFile);

    const presignResponse = await fetch('/api/files/presigned-upload', {
      method: 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({
        purpose: 'visit-photo',
        file_name: uploadFile.name,
        mime_type: uploadFile.type,
        size_bytes: uploadFile.size,
        sha256,
        visit_record_id: recordId,
      }),
    });

    const presignJson = await presignResponse.json().catch(() => null);
    if (!presignResponse.ok) {
      throw new Error(
        presignJson?.message ?? `${attachment.file.name} のアップロードURL取得に失敗しました`,
      );
    }

    const uploadResponse = await fetch(presignJson.data.uploadUrl, {
      method: 'PUT',
      headers: presignJson.data.headers,
      body: uploadFile,
    });

    if (!uploadResponse.ok) {
      throw new Error(`${attachment.file.name} のアップロードに失敗しました`);
    }

    const completeResponse = await fetch('/api/files/complete', {
      method: 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({
        file_id: presignJson.data.id,
        etag: uploadResponse.headers.get('etag') ?? undefined,
      }),
    });

    const completeJson = await completeResponse.json().catch(() => null);
    if (!completeResponse.ok) {
      throw new Error(
        completeJson?.message ?? `${attachment.file.name} のアップロード確定に失敗しました`,
      );
    }

    return {
      file_id: completeJson.data.id,
      file_name: uploadFile.name,
      mime_type: uploadFile.type,
      size_bytes: uploadFile.size,
      uploaded_at: completeJson.data.completedAt ?? null,
      kind: attachment.kind,
    } satisfies UploadedVisitAttachment;
  }

  return {
    id,
    facilityVisitContext,
    medicationStockObservationWriteEnabled,
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
  };
}
