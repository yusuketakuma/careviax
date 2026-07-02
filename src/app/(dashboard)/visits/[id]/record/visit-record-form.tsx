'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useForm, FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { toast } from 'sonner';
import { formatYen } from '@/lib/ui/currency-format';
import { timeIsoToString } from '@/lib/visits/time-of-day';
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
  MapPin,
  LocateFixed,
  Mic,
  ChevronRight,
} from 'lucide-react';
import { z } from 'zod';
import { visitRecordBaseSchema } from '@/lib/validations/visit-record';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useSpeechRecognition } from '@/lib/hooks/use-speech-recognition';
import { useSoapDraft } from '@/lib/hooks/use-soap-draft';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import { isOfflineEncryptionUnavailableError } from '@/lib/offline/crypto';
import { listEvidenceDraftSummariesForSchedule } from '@/lib/offline/evidence-drafts';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import {
  enqueueForSync,
  registerVisitRecordConflict,
  setupAutoSync,
} from '@/lib/stores/sync-engine';
import { useOfflineStore } from '@/lib/stores/offline-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/error-state';
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
  VisitEvidenceRail,
  VisitMobileModeHeader,
  VisitModeHeader,
  VisitStepActionBar,
  VisitStepNav,
  VisitUnsyncedEvidenceBanner,
  useVisitStepSpy,
  type VisitRecordStepId,
} from './visit-step-nav';
import {
  FINAL_SECTION_STEP_IDS,
  MEDICATION_ADHERENCE_CHOICES,
  applyMedicationAdherenceChoice,
  applyMedicationAdherenceMemo,
  countUnsyncedEvidenceDrafts,
  deriveMedicationAdherenceChoice,
  mobileVisitStepSectionClassName,
  resolveMobilePendingSyncCount,
  resolveMobileVisitStepHeading,
} from './visit-mode-mobile.shared';
import { ResidualMedicationForm } from '@/components/features/visits/residual-medication-form';
import { SoapVoiceFieldToggle } from '@/components/features/visits/soap-voice-field-toggle';
import { VoiceSoapAssist } from '@/components/features/visits/voice-soap-assist';
import { FacilityVisitRecordSwitcher } from '@/components/features/visits/facility-visit-record-switcher';
import {
  VisitMedicationManagementSection,
  type VisitConferenceContext,
  type VisitMedicationPeriod,
  type VisitPrescriptionChanges,
  type VisitOutsideMed,
  type VisitPreviousStructuredReuse,
} from '@/components/features/visits/visit-medication-management-section';
import {
  PatientCareTeamSourcePanel,
  type PatientCareTeamSourceContact,
} from '@/components/features/visits/patient-care-team-source-panel';
import {
  VisitReportReadinessPanel,
  type VisitReportReadinessItem,
} from '@/components/features/visits/visit-report-readiness-panel';
import {
  VisitAttachmentsField,
  type VisitAttachmentDraft,
} from '@/components/features/visits/visit-attachments-field';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { CdsAlertPanel, type CdsAlert } from '@/components/features/cds/alert-panel';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  buildHomeVisit2026ReadinessItems,
  getMissingHomeVisit2026CompletionItems,
  isHomeVisit2026CompletionOutcome,
  type HomeVisit2026BillingBlocker,
} from '@/lib/visits/home-visit-2026-evidence';
import {
  captureVisitGeoPoint,
  getVisitLocationPermissionState,
  getVisitLocationTrackingPreference,
  type VisitGeoLog,
} from '@/lib/visit-location';
import { appendVoiceTranscript } from '@/lib/voice-recognition';
import { getVisitExecutionQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import {
  createFacilityVisitRecordHref,
  getNextGroupedVisitScheduleId,
  type FacilityVisitContext,
} from '@/lib/visits/facility-visit-context';
import {
  buildAttachmentId,
  buildReflectPatientIntake,
  classifyVisitAttachment,
  getVisitReceiptReadiness,
  getVisitAttachmentConstraints,
  normalizeVisitReceiptPayload,
  validateVisitAttachment,
} from './visit-record-form.shared';
import { VisitCompletionReadinessWarning } from './visit-completion-readiness-warning';

type ScheduleDetail = {
  id: string;
  patient_id: string;
  cycle_id: string | null;
  scheduled_date: string;
  schedule_status?: string;
  visit_type: string;
  carry_items_status: string | null;
  recurrence_rule?: string | null;
  time_window_start?: string | null;
  case_?: {
    patient?: {
      id: string;
      name: string;
    } | null;
  } | null;
};

const VISIT_RECORD_ALERT_TYPES = new Set(['renal_dose', 'pim_elderly', 'high_risk']);

const outcomeOptions = [
  { value: 'completed', label: '完了' },
  { value: 'revisit_needed', label: '再訪必要' },
  { value: 'postponed', label: '延期' },
  { value: 'cancelled', label: 'キャンセル' },
  { value: 'delivery_only', label: '投薬のみ' },
  { value: 'completed_with_issue', label: '完了（課題あり）' },
];

const relationOptions = [
  { value: 'self', label: '本人' },
  { value: 'spouse', label: '配偶者' },
  { value: 'child', label: '子' },
  { value: 'parent', label: '親' },
  { value: 'sibling', label: '兄弟姉妹' },
  { value: 'other_family', label: 'その他家族' },
  { value: 'caregiver', label: '介護者' },
  { value: 'facility_staff', label: '施設職員' },
  { value: 'other', label: 'その他' },
];

// ⑤ 反映導線: 服薬管理者の選択肢(patientIntakeSchema.medication_manager と一致させる)
const medicationManagerOptions = [
  { value: 'self', label: '本人' },
  { value: 'family', label: '家族' },
  { value: 'visiting_nurse', label: '訪問看護師' },
  { value: 'facility', label: '施設職員' },
  { value: 'pharmacist', label: '薬剤師' },
  { value: 'unknown', label: '不明' },
];

const formSchema = visitRecordBaseSchema
  .extend({
    carry_item_warning_acknowledged: z.boolean().optional(),
    residual_medications: z
      .array(
        z.object({
          drug_name: z.string().min(1, '薬剤名は必須です'),
          drug_code: z.string().optional(),
          prescribed_quantity: z.number().optional(),
          prescribed_daily_dose: z.number().optional(),
          remaining_quantity: z.number().min(0),
          is_prohibited_reduction: z.boolean(),
        }),
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    const readiness = getVisitReceiptReadiness(data);
    if (!readiness.hasIdentityInput || readiness.hasCompleteIdentity) return;

    if (!data.receipt_person_name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receipt_person_name'],
        message: '受領者名を入力してください',
      });
    }
    if (!data.receipt_person_relation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receipt_person_relation'],
        message: '受領者の続柄を選択してください',
      });
    }
    if (!data.receipt_at?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receipt_at'],
        message: '受領日時を入力してください',
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

type UploadedVisitAttachment = {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  kind: 'photo' | 'attachment';
};

type VisitPreparationSnapshot = {
  data: {
    pack: {
      care_team: PatientCareTeamSourceContact[];
      billing_blockers: HomeVisit2026BillingBlocker[];
      conference_context: VisitConferenceContext[];
      medication_period?: VisitMedicationPeriod | null;
      prescription_changes?: VisitPrescriptionChanges | null;
      outside_meds?: VisitOutsideMed[] | null;
      previous_visit?: {
        summary?: string | null;
        structured_reuse?: VisitPreviousStructuredReuse | null;
      } | null;
      facility_parallel_context?: {
        batch_id: string | null;
        label: string | null;
        place_kind: 'facility' | 'home_group' | 'address' | null;
        site_name: string | null;
        common_notes: string | null;
        current_schedule_id: string;
        patients: Array<{
          schedule_id: string;
          patient_id: string;
          patient_name: string;
          patient_name_kana: string | null;
          patient_birth_date: string | null;
          patient_gender: string | null;
          unit_name: string | null;
          route_order: number | null;
          schedule_status: string;
          medication_start_date: string | null;
          medication_end_date: string | null;
          preparation_blockers_count: number;
          visit_record_id: string | null;
          visit_outcome_status: string | null;
        }>;
      } | null;
      intake_context?: {
        initial_transition_management_expected?: boolean | null;
      };
      billing_collection_context?: {
        candidate_id: string | null;
        billing_month: string | null;
        billing_name: string | null;
        candidate_status: string | null;
        current_billed_amount: number | null;
        current_collection_amount: number | null;
        previous_unpaid_amount: number | null;
        total_collection_amount: number | null;
        collected_amount: number | null;
        payer_name: string | null;
        payer_relation: string | null;
        collection_method: string | null;
        collection_method_label: string | null;
        collection_timing: string | null;
        collection_timing_label: string | null;
        scheduled_collection_at: string | null;
        collected_at: string | null;
        receipt_issue: string | null;
        receipt_issue_label: string | null;
        receipt_issue_status: string | null;
        receipt_issue_status_label: string | null;
        receipt_number: string | null;
        collector_user_id: string | null;
      } | null;
    };
  };
};

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
      className={cn(
        'scroll-mt-24 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0',
        className,
      )}
      headerClassName="max-md:hidden"
      contentClassName="space-y-3 sm:space-y-4"
    >
      {children}
    </PageSection>
  );
}

const { maxAttachments: MAX_VISIT_ATTACHMENTS } = getVisitAttachmentConstraints();

function buildPreviousVisitReuseSource(
  reuse: VisitPreviousStructuredReuse | null | undefined,
): StructuredSoap['previous_visit_reuse'] | undefined {
  if (!reuse) return undefined;
  return {
    source_visit_record_id: reuse.source_visit_record_id,
    source_visit_record_version: reuse.source_visit_record_version,
    source_visit_record_updated_at: reuse.source_visit_record_updated_at,
    carry_forward_items: reuse.carry_forward_items,
  };
}

function buildStructuredSoap(
  values: FormValues,
  previousVisitStructuredReuse?: VisitPreviousStructuredReuse | null,
): StructuredSoap {
  const wizard = values.structured_soap as Partial<StructuredSoap> | undefined;
  const previousVisitReuseSource =
    buildPreviousVisitReuseSource(previousVisitStructuredReuse) ?? wizard?.previous_visit_reuse;
  return {
    subjective: {
      symptom_checks: wizard?.subjective?.symptom_checks ?? [],
      free_text: values.soap_subjective || wizard?.subjective?.free_text || undefined,
    },
    objective: {
      medication_status: wizard?.objective?.medication_status ?? 'free_text_only',
      adherence_score: wizard?.objective?.adherence_score ?? 3,
      side_effect_checks: wizard?.objective?.side_effect_checks ?? [],
      free_text: values.soap_objective || wizard?.objective?.free_text || undefined,
      ...(wizard?.objective?.vitals ? { vitals: wizard.objective.vitals } : {}),
      ...(wizard?.objective?.lab_values ? { lab_values: wizard.objective.lab_values } : {}),
      ...(wizard?.objective?.self_management_ability != null
        ? { self_management_ability: wizard.objective.self_management_ability }
        : {}),
      ...(wizard?.objective?.medication_calendar_used != null
        ? { medication_calendar_used: wizard.objective.medication_calendar_used }
        : {}),
      ...(wizard?.objective?.functional_assessment
        ? { functional_assessment: wizard.objective.functional_assessment }
        : {}),
      ...(wizard?.objective?.adverse_events
        ? { adverse_events: wizard.objective.adverse_events }
        : {}),
    },
    assessment: {
      problem_checks: wizard?.assessment?.problem_checks ?? [],
      free_text: values.soap_assessment || wizard?.assessment?.free_text || undefined,
      ...(wizard?.assessment?.severity ? { severity: wizard.assessment.severity } : {}),
      ...(wizard?.assessment?.drug_related_problems
        ? { drug_related_problems: wizard.assessment.drug_related_problems }
        : {}),
    },
    plan: {
      intervention_checks: wizard?.plan?.intervention_checks ?? [],
      next_visit_date:
        values.next_visit_suggestion_date || wizard?.plan?.next_visit_date || undefined,
      free_text: values.soap_plan || wizard?.plan?.free_text || undefined,
      ...(wizard?.plan?.prescription_proposal
        ? { prescription_proposal: wizard.plan.prescription_proposal }
        : {}),
      ...(wizard?.plan?.physician_report_items
        ? { physician_report_items: wizard.plan.physician_report_items }
        : {}),
      ...(wizard?.plan?.care_manager_report_items
        ? { care_manager_report_items: wizard.plan.care_manager_report_items }
        : {}),
      ...(wizard?.plan?.care_service_coordination
        ? { care_service_coordination: wizard.plan.care_service_coordination }
        : {}),
    },
    ...(wizard?.residual_medications ? { residual_medications: wizard.residual_medications } : {}),
    ...(wizard?.home_visit_2026 ? { home_visit_2026: wizard.home_visit_2026 } : {}),
    ...(previousVisitReuseSource ? { previous_visit_reuse: previousVisitReuseSource } : {}),
  };
}

function buildDraftMetadata(values: FormValues, visitGeoLog: VisitGeoLog | null) {
  return {
    visitDate: values.visit_date,
    outcomeStatus: values.outcome_status,
    receiptPersonName: values.receipt_person_name,
    receiptPersonRelation: values.receipt_person_relation,
    receiptAt: values.receipt_at,
    nextVisitSuggestionDate: values.next_visit_suggestion_date,
    cancellationReason: values.cancellation_reason,
    postponeReason: values.postpone_reason,
    revisitReason: values.revisit_reason,
    residualMedications: values.residual_medications ?? [],
    visitGeoLog,
  };
}

function formatVisitBillingAmount(value: number | null | undefined) {
  return formatYen(value, '未記録');
}

function formatVisitBillingDateTime(value: string | null | undefined) {
  if (!value) return '未記録';
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return '未記録';
  return format(parsed, 'yyyy/MM/dd HH:mm');
}

export function VisitRecordForm({
  id,
  facilityVisitContext = null,
}: {
  id: string;
  facilityVisitContext?: FacilityVisitContext | null;
}) {
  const router = useRouter();
  const orgId = useOrgId();
  const isNetworkOnline = useNetworkOnline();
  const isBootstrappingOrg = !orgId;
  const queryClient = useQueryClient();
  const [draftHydrated, setDraftHydrated] = useState(false);
  // p0_23 モバイルウィザード(<md)の現在ステップ。md 以上はスクロール準拠のまま
  const [mobileStepId, setMobileStepId] = useState<VisitRecordStepId>('visit-step-readiness');
  // 撮影・動作確認用のデモ注入(dev 限定、p0_34 の window フックの作法)
  const [demoUnsyncedPhotoCount, setDemoUnsyncedPhotoCount] = useState<number | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<VisitAttachmentDraft[]>([]);
  const [visitGeoLog, setVisitGeoLog] = useState<VisitGeoLog | null>(null);
  const [locationTrackingEnabled] = useState(() =>
    typeof window === 'undefined' ? false : getVisitLocationTrackingPreference(),
  );
  const [locationCaptureState, setLocationCaptureState] = useState<
    'idle' | 'capturing-start' | 'capturing-end'
  >('idle');
  // ⑤ 反映導線: 訪問中に確認した患者情報を患者詳細(正本)へ反映する任意セクションの状態
  const [reflectToPatientDetail, setReflectToPatientDetail] = useState(false);
  const [reflectCareLevel, setReflectCareLevel] = useState('');
  const [reflectMedicationManager, setReflectMedicationManager] = useState('');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCapturedStartRef = useRef(false);
  const draftSaveFailureNotifiedRef = useRef(false);
  const errorSummaryId = 'visit-record-form-error-summary';
  const carryItemAcknowledgementErrorId = 'carry-item-warning-acknowledgement-error';
  const isOffline = useOfflineStore((state) => state.isOffline);
  const pendingSyncCount = useOfflineStore((state) => state.pendingSyncCount);
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
      const res = await fetch(`/api/visit-schedules/${id}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('スケジュール情報の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!id,
  });

  // 訪問キャプチャの Pinned に安全タグ(アレルギー等)を常時表示するための患者ヘッダサマリー
  // (SSOT 4.1)。visible_safety_tags は selectVisibleSafetyTags 済み=critical は必ず含まれる。
  const { data: headerSummary, isError: headerSummaryError } = useQuery<{
    safety: { visible_safety_tags: string[]; hidden_safety_tag_count: number };
  }>({
    queryKey: ['patient-header-summary', schedule?.patient_id, orgId],
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(schedule?.patient_id ?? '', '/header-summary'), {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者ヘッダー情報の取得に失敗しました');
      return res.json();
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
    queryFn: async () => {
      const res = await fetch('/api/cds/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ cycleId: schedule!.cycle_id }),
      });
      if (!res.ok) {
        throw new Error('訪問時の処方安全アラート取得に失敗しました');
      }
      return res.json() as Promise<{ alerts: CdsAlert[] }>;
    },
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

  const {
    data: visitPreparationSnapshot,
    isLoading: visitPreparationLoading,
    isError: visitPreparationError,
    refetch: refetchVisitPreparation,
  } = useQuery<VisitPreparationSnapshot>({
    queryKey: ['visit-preparation-care-team', id, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-preparations/${id}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問準備情報の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!schedule?.id,
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

    toast.error(error instanceof Error ? error.message : 'オフライン下書きの保存に失敗しました');
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      schedule_id: id,
      patient_id: schedule?.patient_id ?? '',
      visit_date: today,
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
  const receiptPersonRelation =
    useWatch({
      control: form.control,
      name: 'receipt_person_relation',
    }) ?? '';
  const watchedValues = useWatch({
    control: form.control,
  }) as FormValues;
  const allowNavigation = useUnsavedChangesGuard({
    enabled: form.formState.isDirty,
  });
  useEffect(() => {
    if (!requiresCarryItemWarningAcknowledgement && carryItemAcknowledgementError) {
      form.clearErrors('carry_item_warning_acknowledged');
    }
  }, [carryItemAcknowledgementError, form, requiresCarryItemWarningAcknowledgement]);

  useEffect(() => {
    syncOnlineStatus();
  }, [isNetworkOnline, syncOnlineStatus]);

  const refreshSyncCountSafely = useCallback(() => {
    void refreshSyncCount().catch((error) => {
      if (syncCountRefreshFailureNotifiedRef.current) return;
      syncCountRefreshFailureNotifiedRef.current = true;
      console.warn('[offline-sync] sync count refresh failed', error);
    });
  }, [refreshSyncCount]);

  useEffect(() => {
    if (!orgId || typeof window === 'undefined') return;

    const teardown = setupAutoSync({
      orgId,
      endpoints: {
        visit_record: '/api/visit-records',
      },
    });
    const initialTimer = window.setTimeout(() => {
      refreshSyncCountSafely();
    }, 0);
    const timer = window.setInterval(() => {
      refreshSyncCountSafely();
    }, 5000);

    return () => {
      teardown();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [orgId, refreshSyncCountSafely]);

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
          setVisitGeoLog(draft.visitGeoLog ?? null);
          autoCapturedStartRef.current = Boolean(draft.visitGeoLog?.start);
          form.reset({
            schedule_id: id,
            patient_id: schedule.patient_id,
            visit_date: draft.visitDate ?? today,
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
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void saveDraft(
        buildStructuredSoap(watchedValues),
        0,
        buildDraftMetadata(watchedValues, visitGeoLog),
      )
        .then(() => {
          draftSaveFailureNotifiedRef.current = false;
        })
        .catch(notifyDraftSaveFailure);
    }, 30_000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    draftHydrated,
    notifyDraftSaveFailure,
    saveDraft,
    schedule?.patient_id,
    visitGeoLog,
    watchedValues,
  ]);

  const handleAddAttachments = useCallback((files: File[]) => {
    setSelectedAttachments((current) => {
      const next = [...current];
      const existingKeys = new Set(
        current.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`),
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

      return next;
    });
  }, []);

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
        if (!options?.silent) {
          toast.error(error instanceof Error ? error.message : '位置情報を取得できませんでした');
        }
        return null;
      } finally {
        setLocationCaptureState('idle');
      }
    },
    [locationTrackingEnabled],
  );

  useEffect(() => {
    if (!draftHydrated || !locationTrackingEnabled || autoCapturedStartRef.current) return;
    autoCapturedStartRef.current = true;
    void captureLocationPhase('start', {
      silent: true,
      successMessage: '訪問開始位置を記録しました',
    });
  }, [captureLocationPhase, draftHydrated, locationTrackingEnabled]);

  async function uploadVisitAttachment(recordId: string, attachment: VisitAttachmentDraft) {
    const presignResponse = await fetch('/api/files/presigned-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({
        purpose: 'visit-photo',
        file_name: attachment.file.name,
        mime_type: attachment.file.type,
        size_bytes: attachment.file.size,
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
      body: attachment.file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`${attachment.file.name} のアップロードに失敗しました`);
    }

    const completeResponse = await fetch('/api/files/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
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
      file_name: completeJson.data.originalName,
      mime_type: completeJson.data.mimeType,
      size_bytes: completeJson.data.sizeBytes,
      uploaded_at: completeJson.data.completedAt ?? null,
      kind: attachment.kind,
    } satisfies UploadedVisitAttachment;
  }

  const visitPreparationPack = visitPreparationSnapshot?.data.pack;
  const patientCareTeamContacts = visitPreparationSnapshot?.data.pack.care_team ?? [];
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

  // Create visit record mutation
  const createRecord = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = normalizeVisitReceiptPayload({
        ...values,
        patient_id: schedule?.patient_id ?? values.patient_id,
        structured_soap: buildStructuredSoap(values, previousVisitStructuredReuse),
      });

      const res = await fetch('/api/visit-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
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
            server: err.details.existing_record as {
              id: string;
              version: number;
              patient_id: string;
              visit_date: string;
              outcome_status: string;
              soap_subjective?: string | null;
              soap_objective?: string | null;
              soap_assessment?: string | null;
              soap_plan?: string | null;
              next_visit_suggestion_date?: string | null;
              residual_medications?: Array<{
                drug_name: string;
                drug_code?: string | null;
                prescribed_quantity?: number | null;
                prescribed_daily_dose?: number | null;
                remaining_quantity: number;
                is_prohibited_reduction: boolean;
              }>;
            },
          });
          await refreshSyncState();
          throw new Error(
            '既存記録と競合しました。スケジュール画面の競合カードから解決してください。',
          );
        }
        throw new Error(err.message ?? '訪問記録の保存に失敗しました');
      }

      const { record } = await res.json();
      const labPatientId = schedule?.patient_id ?? values.patient_id;

      // ⑤ 反映導線: 確認した患者情報を正本(患者詳細)へ反映する(任意・オンライン時のみ・非ブロッキング)。
      // source_visit_record_id を付けることで変更履歴の source が visit_record になる。
      if (reflectToPatientDetail && labPatientId) {
        const reflectIntake = buildReflectPatientIntake({
          careLevel: reflectCareLevel,
          medicationManager: reflectMedicationManager,
        });
        if (reflectIntake) {
          void fetch(buildPatientApiPath(labPatientId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
            body: JSON.stringify({
              intake: reflectIntake,
              source_visit_record_id: record.id,
            }),
          })
            .then((reflectRes) => {
              if (reflectRes.ok) {
                toast.success('確認した内容を患者詳細に反映しました');
              } else {
                toast.warning('患者詳細への反映に失敗しました');
              }
            })
            .catch(() => {
              toast.warning('患者詳細への反映に失敗しました');
            });
        }
      }

      if (selectedAttachments.length === 0) {
        return {
          record,
          attachmentWarning: null,
        };
      }

      try {
        const uploadedAttachments: UploadedVisitAttachment[] = [];
        for (const attachment of selectedAttachments) {
          uploadedAttachments.push(await uploadVisitAttachment(record.id, attachment));
        }

        const patchResponse = await fetch(`/api/visit-records/${record.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            version: record.version,
            attachments: uploadedAttachments.map((attachment) => ({
              file_id: attachment.file_id,
            })),
          }),
        });

        const patchJson = await patchResponse.json().catch(() => null);
        if (!patchResponse.ok) {
          return {
            record,
            attachmentWarning:
              patchJson?.message ?? '訪問記録は保存しましたが、添付の紐づけに失敗しました',
          };
        }

        return {
          record: patchJson,
          attachmentWarning: null,
        };
      } catch (cause) {
        return {
          record,
          attachmentWarning:
            cause instanceof Error
              ? cause.message
              : '訪問記録は保存しましたが、添付のアップロードに失敗しました',
        };
      }
    },
    onSuccess: async ({ record, attachmentWarning }) => {
      await clearDraft();
      await refreshSyncState();
      setSelectedAttachments([]);
      await invalidateQueryKeys(
        queryClient,
        getVisitExecutionQueryKeys({
          orgId,
          patientId: schedule?.patient_id ?? record.patient_id,
          scheduleId: id,
        }),
      );
      allowNavigation();
      if (attachmentWarning) {
        toast.warning(attachmentWarning);
      } else {
        toast.success('訪問記録を保存しました');
      }
      const nextScheduleId = getNextGroupedVisitScheduleId(id, effectiveFacilityVisitContext);
      if (nextScheduleId && effectiveFacilityVisitContext) {
        router.push(createFacilityVisitRecordHref(nextScheduleId, effectiveFacilityVisitContext));
        return;
      }
      router.push(`/visits/${record.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? '保存に失敗しました');
    },
  });

  async function onSubmit(values: FormValues) {
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

    createRecord.mutate(payload);
  }

  const errorSummaryItems = collectFormErrorSummaryItems(form.formState.errors, {
    visit_date: '訪問日',
    outcome_status: '訪問結果',
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

  const shortcutStateRef = useRef({
    watchedValues,
    visitGeoLog,
    onSubmit,
    previousVisitStructuredReuse,
  });
  useEffect(() => {
    shortcutStateRef.current = {
      watchedValues,
      visitGeoLog,
      onSubmit,
      previousVisitStructuredReuse,
    };
  });

  // p0_22 訪問ステップ: スクロール現在地(左レール+下部固定バーで共有)
  const activeStepId = useVisitStepSpy();

  // p0_23 モバイルウィザード: ステップ移動(移動後は先頭から読めるよう最上部へ)
  const handleMobileStepSelect = useCallback((stepId: VisitRecordStepId) => {
    setMobileStepId(stepId);
    if (typeof document === 'undefined') return;
    const main = document.getElementById('main-content');
    if (main) {
      main.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, []);

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
  }, []);

  const unsyncedPhotoCount =
    demoUnsyncedPhotoCount ?? countUnsyncedEvidenceDrafts(evidenceDraftSummaries, id);
  const mobilePendingSyncCount = resolveMobilePendingSyncCount(
    pendingSyncCount,
    unsyncedPhotoCount,
  );
  // 下部固定バーの「一時保存」(Cmd/Ctrl+S と同じ下書き保存)
  const handleManualDraftSave = useCallback(() => {
    const {
      watchedValues: vals,
      visitGeoLog: geoLog,
      previousVisitStructuredReuse: previousReuse,
    } = shortcutStateRef.current;
    void saveDraft(buildStructuredSoap(vals, previousReuse), 0, buildDraftMetadata(vals, geoLog))
      .then(() => {
        draftSaveFailureNotifiedRef.current = false;
        toast.info('下書きを保存しました');
      })
      .catch(notifyDraftSaveFailure);
  }, [notifyDraftSaveFailure, saveDraft]);

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
        void saveDraft(
          buildStructuredSoap(vals, previousReuse),
          0,
          buildDraftMetadata(vals, geoLog),
        )
          .then(() => {
            draftSaveFailureNotifiedRef.current = false;
            toast.info('下書きを保存しました');
          })
          .catch(notifyDraftSaveFailure);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void form.handleSubmit(submit, scrollToErrorSummary)();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [form, notifyDraftSaveFailure, saveDraft, scrollToErrorSummary]);

  function handleVisitRecordFormSubmit(event: FormEvent<HTMLFormElement>) {
    void form.handleSubmit(onSubmit, scrollToErrorSummary)(event);
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
  const residualMedicationCount = watchedValues.residual_medications?.length ?? 0;
  const visitReceiptReadiness = getVisitReceiptReadiness(watchedValues);
  const homeVisit2026ReadinessItems = buildHomeVisit2026ReadinessItems({
    structuredSoap: structuredSoapDraft,
    visitType: schedule?.visit_type,
    residualMedicationCount,
    billingBlockers,
    intakeInitialTransitionExpected,
  });
  const requiredHomeVisit2026Items = homeVisit2026ReadinessItems.filter((item) => item.required);
  const completedHomeVisit2026Count = requiredHomeVisit2026Items.filter((item) => item.done).length;
  const missingHomeVisit2026Items = requiredHomeVisit2026Items.filter((item) => !item.done);
  const isCompletionOutcome = isHomeVisit2026CompletionOutcome(outcomeStatus);
  const visitReportReadinessItems: VisitReportReadinessItem[] = [
    {
      key: 'subjective',
      label: '患者・家族の訴え',
      description: '服薬状況、困りごと、自己申告を S に残します。',
      done: Boolean(
        structuredSoapDraft.subjective.free_text?.trim() ||
        structuredSoapDraft.subjective.symptom_checks.length > 0,
      ),
    },
    {
      key: 'objective',
      label: '客観情報・観察',
      description: '残薬、服薬カレンダー、バイタル、検査値、添付写真を O に残します。',
      done: Boolean(
        structuredSoapDraft.objective.free_text?.trim() ||
        structuredSoapDraft.objective.side_effect_checks.length > 0 ||
        selectedAttachments.length > 0,
      ),
    },
    {
      key: 'assessment',
      label: '薬学的評価',
      description: '問題点、重症度、薬学的判断を A に残します。',
      done: Boolean(
        structuredSoapDraft.assessment.free_text?.trim() ||
        structuredSoapDraft.assessment.problem_checks.length > 0,
      ),
    },
    {
      key: 'plan',
      label: '介入・次回計画',
      description: '介入内容、次回訪問日、処方提案を P に残します。',
      done: Boolean(
        structuredSoapDraft.plan.free_text?.trim() ||
        structuredSoapDraft.plan.intervention_checks.length > 0 ||
        structuredSoapDraft.plan.next_visit_date,
      ),
    },
    {
      key: 'collaboration',
      label: '他職種へ渡す事項',
      description: '医師向け、ケアマネ向け、介護サービス連携の要点を分けて残します。',
      done: Boolean(
        structuredSoapDraft.plan.physician_report_items?.trim() ||
        structuredSoapDraft.plan.care_manager_report_items?.trim() ||
        structuredSoapDraft.plan.care_service_coordination?.trim(),
      ),
    },
    {
      key: 'receipt',
      label: '受領・現地証跡',
      description: visitReceiptReadiness.hasIdentityInput
        ? visitReceiptReadiness.hasCompleteIdentity
          ? '受領者、続柄、受領日時が揃っています。'
          : `不足: ${visitReceiptReadiness.missingLabels.join(' / ')}`
        : '受領者、位置情報、添付で訪問時の証跡を補強します。',
      done: Boolean(
        visitReceiptReadiness.hasCompleteIdentity || visitGeoLog?.start || visitGeoLog?.end,
      ),
      required: false,
    },
    {
      key: 'medication_management',
      label: '訪問薬剤管理の確認',
      description:
        missingHomeVisit2026Items.length === 0
          ? '服薬状況、残薬、副作用、連携、該当時の加算根拠が揃っています。'
          : `未確認: ${missingHomeVisit2026Items
              .slice(0, 4)
              .map((item) => item.label)
              .join(' / ')}`,
      done: completedHomeVisit2026Count === requiredHomeVisit2026Items.length,
      required: true,
    },
  ];

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
      onChange={handleStructuredSoapChange}
    />
  );

  useEffect(() => {
    if ((createRecord.isPending || isOffline) && voiceRecognition.isListening) {
      voiceRecognition.stopListening();
    }
  }, [createRecord.isPending, isOffline, voiceRecognition]);

  if (isBootstrappingOrg || scheduleLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (scheduleError || !schedule) {
    return (
      <ErrorState
        variant="server"
        size="page"
        live="assertive"
        title="訪問予定を読み込めませんでした"
        description="訪問予定と患者情報を確認できないため、訪問記録を入力できません。再読み込みしてください。"
        action={{ label: '再読み込み', onClick: () => void refetchSchedule() }}
      />
    );
  }

  const visitDateTimeLabel = schedule?.scheduled_date
    ? `${format(parseISO(schedule.scheduled_date), 'M月d日')}${
        schedule.time_window_start
          ? ` ${timeIsoToString(schedule.time_window_start) ?? '時間未定'}`
          : ''
      }`
    : null;
  const patientName = schedule?.case_?.patient?.name ?? null;

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
            pendingSyncCount={mobilePendingSyncCount}
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
          className="sticky top-14 z-20 max-md:hidden"
          patientName={patientName}
          dateTimeLabel={visitDateTimeLabel}
          safety={headerSafety}
          isOffline={isOffline}
          pendingSyncCount={pendingSyncCount}
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

            <FacilityVisitRecordSwitcher
              currentScheduleId={id}
              context={effectiveFacilityVisitContext}
            />

            <VisitRecordWorkflowSection
              id="visit-step-readiness"
              title="訪問前確認"
              description="現地で迷わないための担当者、会議からの引き継ぎ、薬学的管理、位置情報、同期状態を先に確認します。"
              className={mobileVisitStepSectionClassName(mobileStepId, ['visit-step-readiness'])}
            >
              {medicationManagementSection}

              {!visitPreparationLoading ? (
                <PatientCareTeamSourcePanel contacts={patientCareTeamContacts} compact />
              ) : null}

              {visitPreparationError && (
                // 取得失敗を「準備情報なし(=処方変更/その他薬/前回記録なし)」に潰さない。
                // 記録入力自体は準備パックを必須としないため notification-only(再読込導線つき)。
                <Card
                  className="border-l-4 border-border/70 border-l-state-confirm bg-card"
                  role="alert"
                >
                  <CardHeader className="pb-3">
                    <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-state-confirm">
                      <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                      訪問準備情報を読み込めませんでした
                    </h3>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-state-confirm">
                    <p>
                      処方変更・その他薬・前回記録・他職種連携などの準備コンテキストが表示されていない可能性があります。「該当なし」ではなく取得エラーです。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refetchVisitPreparation()}
                    >
                      再読み込み
                    </Button>
                  </CardContent>
                </Card>
              )}

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
                              carryItemAcknowledgementError
                                ? carryItemAcknowledgementErrorId
                                : undefined
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

              {(locationTrackingEnabled || visitGeoLog) && (
                <Card className="border-l-4 border-border/70 border-l-tag-info bg-card">
                  <CardHeader className="pb-3">
                    <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-tag-info">
                      <MapPin className="h-4 w-4 text-tag-info" aria-hidden="true" />
                      訪問位置情報
                    </h3>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground">
                      開始時に現在地を記録し、保存時に終了位置を追加します。無効化は
                      ユーザー設定から行えます。
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">開始位置</p>
                        <p className="mt-1 font-medium text-foreground">
                          {visitGeoLog?.start
                            ? `${visitGeoLog.start.latitude.toFixed(5)}, ${visitGeoLog.start.longitude.toFixed(5)}`
                            : '未記録'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {visitGeoLog?.start
                            ? `${format(
                                new Date(visitGeoLog.start.captured_at),
                                'yyyy/MM/dd HH:mm',
                              )}${
                                visitGeoLog.start.accuracy_meters != null
                                  ? ` / 精度 ±${visitGeoLog.start.accuracy_meters}m`
                                  : ''
                              }`
                            : '画面を開いた時点で取得を試みます'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">終了位置</p>
                        <p className="mt-1 font-medium text-foreground">
                          {visitGeoLog?.end
                            ? `${visitGeoLog.end.latitude.toFixed(5)}, ${visitGeoLog.end.longitude.toFixed(5)}`
                            : '未記録'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {visitGeoLog?.end
                            ? `${format(new Date(visitGeoLog.end.captured_at), 'yyyy/MM/dd HH:mm')}${
                                visitGeoLog.end.accuracy_meters != null
                                  ? ` / 精度 ±${visitGeoLog.end.accuracy_meters}m`
                                  : ''
                              }`
                            : '保存時に現在地を取得します'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>権限状態: {visitGeoLog?.permission ?? 'prompt'}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() =>
                          void captureLocationPhase(visitGeoLog?.start ? 'end' : 'start', {
                            successMessage: visitGeoLog?.start
                              ? '終了位置を更新しました'
                              : '開始位置を記録しました',
                          })
                        }
                        disabled={locationCaptureState !== 'idle'}
                      >
                        <LocateFixed className="h-4 w-4" aria-hidden="true" />
                        {locationCaptureState === 'capturing-start'
                          ? '開始位置を取得中...'
                          : locationCaptureState === 'capturing-end'
                            ? '終了位置を取得中...'
                            : visitGeoLog?.start
                              ? '現在地を再取得'
                              : '開始位置を記録'}
                      </Button>
                      {/* 44px タッチターゲット(SSOT 8.2)+トークンサイズ(text-xs)。 */}
                      <a
                        href="/settings"
                        className="inline-flex min-h-[44px] items-center rounded-[min(var(--radius-md),12px)] px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        設定で無効化
                      </a>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(isOffline || pendingSyncCount > 0) && (
                <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-state-confirm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-medium">
                        {isOffline
                          ? '現在オフラインです。保存すると端末に下書きし、再接続後に同期します。'
                          : '同期待ちの訪問記録があります。'}
                      </p>
                      {pendingSyncCount > 0 ? (
                        <p className="text-xs text-state-confirm/90">
                          同期待ち {pendingSyncCount} 件
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
                            {billingCollectionContext.collection_timing_label ??
                              '集金タイミング未設定'}
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
                                      billing_month: billingCollectionContext.billing_month.slice(
                                        0,
                                        10,
                                      ),
                                    }
                                  : {}),
                              }).toString()}`}
                            >
                              請求候補を開く
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">今回徴収</dt>
                          <dd className="font-medium text-foreground">
                            {formatVisitBillingAmount(
                              billingCollectionContext.current_collection_amount,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">前回未収分</dt>
                          <dd className="font-medium text-foreground">
                            {formatVisitBillingAmount(
                              billingCollectionContext.previous_unpaid_amount,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">合計徴収額</dt>
                          <dd className="font-medium text-foreground">
                            {formatVisitBillingAmount(
                              billingCollectionContext.total_collection_amount,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">支払者</dt>
                          <dd className="font-medium text-foreground">
                            {[
                              billingCollectionContext.payer_name,
                              billingCollectionContext.payer_relation,
                            ]
                              .filter(Boolean)
                              .join(' / ') || '未記録'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">集金方法</dt>
                          <dd className="font-medium text-foreground">
                            {billingCollectionContext.collection_method_label ?? '未記録'}
                          </dd>
                        </div>
                        <div>
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
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">次回集金予定</dt>
                          <dd className="font-medium text-foreground">
                            {formatVisitBillingDateTime(
                              billingCollectionContext.scheduled_collection_at,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">入金済み</dt>
                          <dd className="font-medium text-foreground">
                            {formatVisitBillingAmount(billingCollectionContext.collected_amount)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">集金記録者</dt>
                          <dd className="font-medium text-foreground">
                            {billingCollectionContext.collector_user_id ? '記録済み' : '未記録'}
                          </dd>
                        </div>
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
                <CardContent className="pt-4">
                  <ResidualMedicationForm />
                </CardContent>
              </Card>

              {isCompletionOutcome && missingHomeVisit2026Items.length > 0 ? (
                <div
                  className={mobileVisitStepSectionClassName(mobileStepId, [
                    'visit-step-final-check',
                  ])}
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
                      <span
                        id="patient-detail-reflect-label"
                        className="font-medium text-foreground"
                      >
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
                  <VisitReportReadinessPanel
                    mode="visit_mobile"
                    items={visitReportReadinessItems}
                  />
                  <p className="text-sm leading-6 text-muted-foreground">
                    内容を確認し、下の「訪問完了」で記録を保存します。
                  </p>
                </div>
                {/* md+ の submit 導線は下部固定バーの「訪問完了」に一本化する
                    (SSOT 5.1: 同一の主操作導線を1画面に二重に置かない)。
                    戻る導線はページ上部の WorkflowPageIntro が正本(SSOT 4.4)。 */}
              </div>
            </VisitRecordWorkflowSection>

            {/* p0_22/p0_23 下部固定バー: md 以上=一時保存/前へ/次へ/訪問完了、
                md 未満=保存+次へ(最終ステップのみ訪問完了) */}
            <VisitStepActionBar
              activeId={activeStepId}
              mobileStepId={mobileStepId}
              onSaveDraft={handleManualDraftSave}
              onMobileStepSelect={handleMobileStepSelect}
              submitPending={createRecord.isPending}
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
