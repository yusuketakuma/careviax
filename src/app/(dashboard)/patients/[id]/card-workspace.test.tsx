// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { useUIStore } from '@/lib/stores/ui-store';
import type {
  PatientDocumentsSnapshot,
  PatientMovementTimelineSnapshot,
  PatientOverview,
  PatientWorkspace,
} from './patient-detail.types';
import type { CaseRiskCockpitResponse } from '@/types/case-risk-cockpit';
import type { PatientHomeOperationsSnapshot } from '@/types/patient-home-operations';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

// Actual-backed spy: buildOrgJsonHeaders keeps real behavior by default (so F-081/F-082 header assertions stay
// valid) but can be given a sentinel return in the F-083 test to prove helper adoption (not just equal shape).
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

import { buildPatientHref } from '@/lib/patient/navigation';
import {
  CardWorkspace,
  buildConferenceStructuredContent,
  parseConferenceParticipants,
} from './card-workspace';

setupDomTestEnv();

beforeEach(() => {
  window.history.replaceState({}, '', '/patients/patient_1');
  useUIStore.setState({ workspaceRailOpen: false, workspaceRailAvailable: false });
});

function buildWorkspace(overrides: Partial<PatientWorkspace> = {}): PatientWorkspace {
  return {
    cycle_id: 'cycle_1',
    overall_status: 'dispensed',
    exception_status: null,
    action_context: {
      patient_id: 'patient_1',
      prescription_intake_id: 'intake_0500',
      visit_schedule_id: 'visit_1',
      visit_record_id: 'visit_record_1',
      report_id: null,
    },
    current_intake: {
      id: 'intake_0500',
      prescribed_date: '2026-06-09T00:00:00.000Z',
      prescription_category: 'regular',
    },
    safety: {
      allergy: 'セフェム系(2019)',
      renal: 'eGFR 38(6/1)',
      handling_tags: ['narcotic', 'cold_storage', 'unit_dose'],
      swallowing: '錠剤OK・大きい錠は半割',
      cautions: ['ふらつき(6/5〜経過観察)'],
    },
    prescription_lines: [
      {
        id: 'line_1',
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '朝食後',
        days: 28,
        quantity: null,
        unit: null,
        packaging_instruction_tags: [],
      },
      {
        id: 'line_2',
        drug_name: 'オキシコドン錠5mg',
        dose: '1錠',
        frequency: '疼痛時',
        days: 14,
        quantity: 14,
        unit: '錠',
        packaging_instruction_tags: ['narcotic'],
      },
      {
        id: 'line_3',
        drug_name: 'インスリングラルギン注',
        dose: '8単位',
        frequency: '夕',
        days: 28,
        quantity: 1,
        unit: '本',
        packaging_instruction_tags: ['cold_storage'],
      },
    ],
    recent_activities: [
      {
        id: 'transition-1',
        type: 'transition',
        label: '調剤 完了',
        actor: '佐藤',
        at: '2026-06-01T09:30:00.000Z',
        href: '/audit',
      },
      {
        id: 'inquiry-1',
        type: 'inquiry',
        label: '残薬調整 → 疑義照会 回答受領',
        actor: null,
        at: '2026-06-01T09:31:00.000Z',
        href: '/communications/requests?status=responded&patient_id=patient_1',
      },
      {
        id: 'intake-1',
        type: 'intake',
        label: '定期処方 取込(やまもと内科)',
        actor: null,
        at: '2026-05-30T08:00:00.000Z',
        href: '/prescriptions',
      },
    ],
    today_tasks: [
      {
        id: 'audit-1',
        tone: 'deadline',
        time_label: '期限 12:00',
        label: '麻薬監査',
        href: '/audit',
        action_label: '監査へ',
        due_time: '12:00',
      },
      {
        id: 'set-1',
        tone: 'waiting',
        time_label: '監査後',
        label: 'セット作成',
        href: '/set',
        action_label: 'セットへ',
        due_time: null,
      },
      {
        id: 'visit-1',
        tone: 'scheduled',
        time_label: '14:00',
        label: '訪問',
        href: '/schedules',
        action_label: '訪問へ',
        due_time: null,
      },
    ],
    open_exceptions: [
      {
        id: 'exception_1',
        exception_type: 'awaiting_reply',
        description: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        created_at: null,
      },
    ],
    medication_changes: [],
    previous_medication: null,
    current_medication: null,
    set_plan: null,
    prescription_document_url: null,
    ...overrides,
  };
}

function buildVisitBrief(
  overrides: Partial<PatientOverview['visit_brief']> = {},
): PatientOverview['visit_brief'] {
  const base: PatientOverview['visit_brief'] = {
    patient: {
      id: 'patient_1',
      name: '田中 一郎',
    },
    context: 'patient',
    generated_at: '2026-06-18T00:00:00.000Z',
    last_prescribed_date: null,
    baseline_context: null,
    medication_changes: [],
    patient_changes: [],
    medications: [],
    dispensing_items: [],
    delivery_status: [],
    dosage_form_support: [],
    multidisciplinary_updates: [],
    jahis_supplemental_records: [],
    latest_labs: [],
    unresolved_items: [],
    must_check_today: [],
    rule_summary: {
      generation_id: 'rule_1',
      headline: '確認事項はありません',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-06-18T00:00:00.000Z',
    },
    ai_summary: {
      generation_id: 'ai_1',
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: null,
      headline: '確認事項はありません',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-06-18T00:00:00.000Z',
      duration_ms: null,
      recent_generation_count_24h: 0,
      recent_failure_count_24h: 0,
      recent_failure_rate_24h: null,
    },
    conference_summary: {
      recent_conferences: 0,
      pending_action_items: 0,
      last_conference_date: null,
      last_conference_type: null,
      summary: null,
      highlighted_risks: [],
    },
    facility_context: null,
    drug_cautions: [],
  };

  return {
    ...base,
    ...overrides,
    patient: {
      ...base.patient,
      ...overrides.patient,
    },
    rule_summary: {
      ...base.rule_summary,
      ...overrides.rule_summary,
    },
    ai_summary: {
      ...base.ai_summary,
      ...overrides.ai_summary,
    },
    conference_summary:
      overrides.conference_summary === null
        ? null
        : {
            ...base.conference_summary!,
            ...overrides.conference_summary,
          },
  };
}

function mockPatientQuery(
  workspace: PatientWorkspace | null,
  homeOperations: PatientHomeOperationsSnapshot | null = null,
  pending: Partial<
    Record<
      | 'fax'
      | 'prescriptionDocument'
      | 'prescriptionOriginalManagement'
      | 'billing'
      | 'billingProfile'
      | 'conference'
      | 'mcsCheckLog'
      | 'patientShareCase'
      | 'riskTaskSync'
      | 'riskTaskWaiver',
      boolean
    >
  > = {},
  options: {
    patientOverrides?: Partial<PatientOverview>;
    patientOverviewError?: Error;
    patientOverviewMissing?: boolean;
    partnerships?: {
      data: Array<{
        id: string;
        status: string;
        effective_from: string | null;
        effective_to: string | null;
        base_site: { id: string; name: string };
        partner_pharmacy: { id: string; name: string; status: string };
      }>;
    };
    managementPlans?: {
      data: Array<{
        id: string;
        case_id: string;
        title: string;
        version: number;
        status: 'draft' | 'approved' | 'superseded' | 'archived';
        effective_from: string | null;
        updated_at: string;
      }>;
    };
    managementPlansError?: Error;
    managementPlansRefetch?: ReturnType<typeof vi.fn>;
    homeOperationsError?: boolean;
    homeOperationsRefetch?: ReturnType<typeof vi.fn>;
    patientDocuments?: {
      data?: PatientDocumentsSnapshot;
      error?: Error;
      isLoading?: boolean;
    };
    headerSummary?: {
      primary_pharmacist_name: string | null;
      backup_pharmacist_name: string | null;
      primary_staff_name: string | null;
      backup_staff_name: string | null;
      first_visit_date: string | null;
      last_prescribed_date: string | null;
      next_prescription_expected_date: string | null;
    };
    headerSummaryError?: boolean;
    movementTimeline?: PatientMovementTimelineSnapshot;
    movementTimelineError?: Error;
    movementTimelineLoading?: boolean;
    movementTimelineRefetch?: ReturnType<typeof vi.fn>;
    patientOverviewLoading?: boolean;
    executePatientShareCaseMutation?: boolean;
    executeRiskTaskSyncMutation?: boolean;
    executeRiskTaskWaiverMutation?: boolean;
    riskTaskSyncError?: Error;
    riskTaskWaiverError?: Error;
    caseRiskCockpit?: CaseRiskCockpitResponse;
    caseRiskCockpitError?: Error;
  } = {},
) {
  const faxMutate = vi.fn();
  const prescriptionDocumentMutate = vi.fn();
  const prescriptionOriginalManagementMutate = vi.fn();
  const billingMutate = vi.fn();
  const billingProfileMutate = vi.fn();
  const conferenceMutate = vi.fn();
  const mcsCheckLogMutate = vi.fn();
  const patientShareCaseMutate = vi.fn();
  const riskTaskSyncMutate = vi.fn();
  const riskTaskWaiverMutate = vi.fn();
  const invalidateQueries = vi.fn();
  useOrgIdMock.mockReturnValue('org_1');
  useRouterMock.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
  useQueryClientMock.mockReturnValue({ invalidateQueries });
  const patientShareCaseMutationResult = {
    mutate: patientShareCaseMutate,
    isPending: Boolean(pending.patientShareCase),
    variables: null,
  };
  const mutationResults = [
    {
      mutate: faxMutate,
      isPending: Boolean(pending.fax),
      variables: pending.fax ? 'intake_0500' : null,
    },
    {
      mutate: prescriptionDocumentMutate,
      isPending: Boolean(pending.prescriptionDocument),
      variables: pending.prescriptionDocument ? { intakeId: 'intake_0500' } : null,
    },
    {
      mutate: prescriptionOriginalManagementMutate,
      isPending: Boolean(pending.prescriptionOriginalManagement),
      variables: pending.prescriptionOriginalManagement ? { intakeId: 'intake_0500' } : null,
    },
    {
      mutate: billingMutate,
      isPending: Boolean(pending.billing),
      variables: pending.billing ? { candidateId: 'billing_1' } : null,
    },
    {
      mutate: billingProfileMutate,
      isPending: Boolean(pending.billingProfile),
      variables: pending.billingProfile ? { patientId: 'patient_1' } : null,
    },
    {
      mutate: conferenceMutate,
      isPending: Boolean(pending.conference),
      variables: pending.conference ? { patientId: 'patient_1', caseId: null } : null,
    },
    {
      mutate: mcsCheckLogMutate,
      isPending: Boolean(pending.mcsCheckLog),
      variables: pending.mcsCheckLog ? { patientId: 'patient_1' } : null,
    },
    patientShareCaseMutationResult,
  ];
  const riskTaskSyncMutationResult = {
    mutate: riskTaskSyncMutate,
    isPending: Boolean(pending.riskTaskSync),
    variables: pending.riskTaskSync ? 'case_1' : null,
    error: options.riskTaskSyncError ?? null,
  };
  const riskTaskWaiverMutationResult = {
    mutate: riskTaskWaiverMutate,
    isPending: Boolean(pending.riskTaskWaiver),
    variables: pending.riskTaskWaiver ? { caseId: 'case_1', taskId: 'task_1' } : null,
    error: options.riskTaskWaiverError ?? null,
  };
  let mutationCallIndex = 0;
  const pickMutationResult = (mutationOptions?: {
    mutationFn?: (input: unknown) => Promise<unknown>;
    onError?: (error: Error) => void;
  }) => {
    const onErrorText = String(mutationOptions?.onError ?? '');
    if (onErrorText.includes('FAX原本到着の記録に失敗しました')) return mutationResults[0];
    if (onErrorText.includes('処方せん画像/PDFの保存に失敗しました')) return mutationResults[1];
    if (onErrorText.includes('処方せん原本管理の保存に失敗しました')) return mutationResults[2];
    if (onErrorText.includes('集金記録の保存に失敗しました')) return mutationResults[3];
    if (onErrorText.includes('支払設定の保存に失敗しました')) return mutationResults[4];
    if (onErrorText.includes('会議要点の保存に失敗しました')) return mutationResults[5];
    if (onErrorText.includes('MCS確認ログの保存に失敗しました')) return mutationResults[6];
    if (onErrorText.includes('リスクタスク同期に失敗しました')) {
      return riskTaskSyncMutationResult;
    }
    if (onErrorText.includes('リスクタスク免除に失敗しました')) {
      return riskTaskWaiverMutationResult;
    }

    const result = mutationResults[mutationCallIndex % mutationResults.length];
    mutationCallIndex += 1;
    return result;
  };
  useMutationMock.mockImplementation(
    (mutationOptions?: {
      mutationFn?: (input: unknown) => Promise<unknown>;
      onSuccess?: (result?: unknown) => Promise<void> | void;
      onError?: (error: Error) => void;
    }) => {
      const onErrorText = String(mutationOptions?.onError ?? '');
      if (String(mutationOptions?.mutationFn).includes('/api/patient-share-cases')) {
        if (!options.executePatientShareCaseMutation) {
          return patientShareCaseMutationResult;
        }

        return {
          mutate: async (input: unknown) => {
            patientShareCaseMutate(input);
            try {
              await mutationOptions?.mutationFn?.(input);
              await mutationOptions?.onSuccess?.();
            } catch (error) {
              mutationOptions?.onError?.(error as Error);
            }
          },
          isPending: Boolean(pending.patientShareCase),
          variables: null,
        };
      }
      if (onErrorText.includes('リスクタスク同期に失敗しました')) {
        if (!options.executeRiskTaskSyncMutation) {
          return riskTaskSyncMutationResult;
        }

        return {
          mutate: async (input: string) => {
            riskTaskSyncMutate(input);
            try {
              await mutationOptions?.mutationFn?.(input);
              await mutationOptions?.onSuccess?.({
                generated_at: '2026-07-06T00:00:00.000Z',
                case_id: input,
                patient_id: 'patient_1',
                overall_status: 'blocked',
                taskable_finding_count: 2,
                skipped_finding_count: 3,
                upserted_task_count: 2,
                resolved_stale_task_count: 1,
              });
            } catch (error) {
              mutationOptions?.onError?.(error as Error);
            }
          },
          isPending: Boolean(pending.riskTaskSync),
          variables: pending.riskTaskSync ? 'case_1' : null,
          error: options.riskTaskSyncError ?? null,
        };
      }
      if (onErrorText.includes('リスクタスク免除に失敗しました')) {
        if (!options.executeRiskTaskWaiverMutation) {
          return riskTaskWaiverMutationResult;
        }

        return {
          mutate: async (input: {
            caseId: string;
            taskId: string;
            waiverReason: string;
            reasonCode: string;
          }) => {
            riskTaskWaiverMutate(input);
            try {
              const result = await mutationOptions?.mutationFn?.(input);
              await mutationOptions?.onSuccess?.(result);
            } catch (error) {
              mutationOptions?.onError?.(error as Error);
            }
          },
          isPending: Boolean(pending.riskTaskWaiver),
          variables: pending.riskTaskWaiver ? { caseId: 'case_1', taskId: 'task_1' } : null,
          error: options.riskTaskWaiverError ?? null,
        };
      }
      return pickMutationResult(mutationOptions);
    },
  );
  const patientData = {
    id: 'patient_1',
    name: '田中 一郎',
    name_kana: 'タナカ イチロウ',
    birth_date: '1942-04-12',
    gender: 'male',
    archived_at: null,
    updated_at: '2026-06-01T00:00:00.000Z',
    allergy_info: [],
    residences: [],
    visit_schedules: [],
    lab_summary: [
      {
        analyte_code: 'egfr',
        value_numeric: 38,
        measured_at: '2026-06-01T00:00:00.000Z',
        unit: 'mL/min/1.73m2',
        abnormal_flag: 'L',
      },
    ],
    foundation: {
      summary: {
        status: 'needs_confirmation',
        label: '未確認2件',
        items: ['保険確認1件', '検査値古い1件'],
      },
      items: [
        {
          key: 'contact',
          label: '主連絡先',
          status: 'ready',
          detail: '連絡先あり',
          action_href: '/patients/patient_1/edit?section=visit#intake.contact_phone',
          action_label: '連絡先を編集',
          meta: {
            updated_at: '2026-06-15',
            updated_by_name: '佐藤 薬剤師',
            source: '患者詳細',
            confirmed_at: '2026-06-15',
            confirmed_by_name: '鈴木 管理者',
            confirmation_status: 'confirmed',
            confirmation_detail: '確認済み',
            stale: false,
          },
        },
        {
          key: 'insurance',
          label: '保険・公費',
          status: 'needs_confirmation',
          detail: '1件 / 1件確認',
          action_href: '/patients/patient_1/edit?section=contact#medical_insurance_number',
          action_label: '保険を確認',
        },
        {
          key: 'medication_risk',
          label: '薬学リスク',
          status: 'needs_confirmation',
          detail: '薬学的課題2件 / 訪問同意未整備',
          action_href: '/patients/patient_1/safety-check',
          action_label: '薬学課題を確認',
        },
        {
          key: 'labs',
          label: '最新検査値',
          status: 'needs_confirmation',
          detail: '1項目 / 要確認1件',
          action_href: '/patients/patient_1/safety-check',
          action_label: '検査値を確認',
        },
      ],
      changes_since_last_visit: [
        {
          id: 'revision_1',
          category: 'clinical',
          field_label: '介護度',
          field_key: 'care_level',
          source: 'visit_record',
          updated_by_name: '佐藤 薬剤師',
          created_at: '2026-06-01T10:00:00.000Z',
        },
      ],
      latest_labs: [
        {
          analyte_code: 'egfr',
          value_label: '38 mL/min/1.73m2',
          measured_at: '2026-06-01',
          stale: true,
          abnormal: true,
        },
      ],
      insurances: [
        {
          insurance_type: '公費 54',
          status_label: '申請中',
          period_label: '2026-04-01 - 2026-06-30',
          copay_label: '30%',
          expires_soon: true,
          insurer_number: '21540000',
          number: '54001234',
          symbol: 'A-1',
          branch_number: '01',
          notes: 'raw insurance note',
        },
      ],
      archive: {
        archived: false,
        archived_at: null,
        archived_by_name: null,
      },
    },
    cases: [],
    conditions: [],
    contacts: [
      {
        id: 'contact_1',
        relation: 'child',
        name: '長女',
        phone: '090-0000-0000',
        email: null,
        fax: null,
        organization_name: null,
        department: null,
        address: null,
        is_primary: true,
        is_emergency_contact: true,
        notes: null,
      },
    ],
    phone: '090-0000-0000',
    medical_insurance_number: null,
    care_insurance_number: null,
    billing_support_flag: true,
    notes: null,
    summary_metrics: { open_tasks_count: 0 },
    risk_summary: null,
    visit_brief: buildVisitBrief({
      conference_summary: {
        recent_conferences: 1,
        pending_action_items: 0,
        last_conference_date: '2026-06-01T00:00:00.000Z',
        last_conference_type: 'discharge_conference',
        summary: '退院前カンファで初回訪問を確認',
        highlighted_risks: [],
      },
      unresolved_items: [],
    }),
    jahis_supplemental_records: [],
    workspace,
    privacy: {
      sensitive_fields_masked: false,
      address_fields_masked: false,
      can_view_detail: true,
    },
    ...options.patientOverrides,
  };
  const documentsData: PatientDocumentsSnapshot = {
    patient: {
      id: 'patient_1',
      name: '田中 一郎',
      name_kana: 'タナカ イチロウ',
    },
    print_readiness: {
      overall_status: 'warning',
      missing_required_count: 0,
      warning_count: 1,
      template_versions: [
        {
          document_type: 'contract',
          label: '契約書',
          template_id: 'template_contract',
          template_name: '在宅契約書',
          template_version: 'v3',
          effective_from: '2026-04-01T00:00:00.000Z',
          effective_to: null,
        },
      ],
      checks: [
        {
          key: 'patient_profile',
          label: '患者基本情報',
          completed: true,
          severity: 'required',
          description: '氏名、フリガナ、生年月日を差し込みできます。',
          action_href: '/patients/patient_1/edit',
          action_label: '基本情報を編集',
        },
        {
          key: 'explainer',
          label: '説明担当者',
          completed: false,
          severity: 'warning',
          description: '説明担当者の初期値に使う主担当薬剤師を設定してください。',
          action_href: '/patients/patient_1#patient-profile-summary',
          action_label: '担当者を確認',
        },
      ],
    },
    document_statuses: [
      {
        document_type: 'contract',
        label: '契約書',
        status: 'created',
        status_label: '作成済み',
        template_name: '在宅契約書',
        template_version: 'v3',
        storage_location: '店舗',
        latest_action_at: '2026-06-01T00:00:00.000Z',
        latest_printed_at: '2026-06-01T00:00:00.000Z',
        latest_print_batch_id: 'print_20260601T000000Z_batch1',
        latest_document_id: 'doc_1',
        has_file: true,
        delivered_at: null,
        alerts: ['交付・回収が未記録です'],
      },
      {
        document_type: 'important_matters',
        label: '重要事項説明書',
        status: 'not_created',
        status_label: '未作成',
        template_name: null,
        template_version: null,
        storage_location: null,
        latest_action_at: null,
        latest_printed_at: null,
        latest_print_batch_id: null,
        latest_document_id: null,
        has_file: false,
        delivered_at: null,
        alerts: ['文書が未作成です'],
      },
    ],
    first_visit_documents: [],
  };
  const movementTimelineData: PatientMovementTimelineSnapshot = options.movementTimeline ?? {
    movement_events: [
      {
        id: 'timeline_visit_record_1',
        event_type: 'visit_event',
        category: 'visit',
        occurred_at: '2026-06-18T09:00:00.000Z',
        title: '訪問記録を保存',
        summary: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
        href: '/visits/visit_record_1',
        action_label: '訪問記録へ',
        status: 'completed',
        status_label: '完了',
        actor_name: '佐藤 薬剤師',
        actor_role: null,
        source_channel: null,
        source_label: null,
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
        severity: 'normal',
        badges: [{ label: '完了', tone: 'success' }],
        metadata: ['直近抜粋'],
        privacy_level: 'summary',
        raw_available: false,
      },
      {
        id: 'timeline_care_report_1',
        event_type: 'document_registered',
        category: 'document',
        occurred_at: '2026-06-17T10:00:00.000Z',
        title: '報告書を作成',
        summary: '報告書が登録されました。内容は報告書詳細で確認してください。',
        href: '/reports/report_1',
        action_label: '報告書へ',
        status: 'draft',
        status_label: '下書き',
        actor_name: null,
        actor_role: null,
        source_channel: null,
        source_label: null,
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        severity: 'normal',
        badges: [{ label: '下書き', tone: 'neutral' }],
        metadata: [],
        privacy_level: 'summary',
        raw_available: false,
      },
    ],
    meta: {
      next_cursor: null,
      has_more: false,
      returned_count: 2,
      count_basis: 'bounded_latest_window',
      filters: { category: null, date_from: null, date_to: null },
      window_limit: 40,
    },
  };

  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'pharmacy-partnerships') {
      return {
        data:
          options.partnerships ??
          ({
            data: [
              {
                id: 'partnership_1',
                status: 'active',
                effective_from: '2026-06-01T00:00:00.000Z',
                effective_to: null,
                base_site: { id: 'site_1', name: '基幹薬局' },
                partner_pharmacy: {
                  id: 'partner_pharmacy_1',
                  name: '協力薬局',
                  status: 'active',
                },
              },
            ],
          } as const),
        isLoading: false,
        isError: false,
        error: null,
      };
    }
    if (queryKey[0] === 'management-plans') {
      if (options.managementPlansError) {
        return {
          data: options.managementPlans,
          isLoading: false,
          isError: true,
          isRefetching: false,
          error: options.managementPlansError,
          refetch: options.managementPlansRefetch ?? vi.fn(),
        };
      }

      return {
        data: options.managementPlans ?? { data: [] },
        isLoading: false,
        isError: false,
        isRefetching: false,
        error: null,
        refetch: options.managementPlansRefetch ?? vi.fn(),
      };
    }
    if (queryKey[0] === 'patient-home-operations') {
      return {
        data: options.homeOperationsError ? undefined : (homeOperations ?? undefined),
        isLoading: false,
        isError: Boolean(options.homeOperationsError),
        error: options.homeOperationsError ? new Error('在宅運用管理の取得に失敗しました') : null,
        refetch: options.homeOperationsRefetch ?? vi.fn(),
      };
    }
    if (queryKey[0] === 'patient-documents') {
      return {
        data: options.patientDocuments ? options.patientDocuments.data : documentsData,
        isLoading: options.patientDocuments?.isLoading ?? false,
        error: options.patientDocuments?.error ?? null,
      };
    }
    if (queryKey[0] === 'patient-header-summary') {
      if (options.headerSummaryError) {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('患者ヘッダー情報の取得に失敗しました'),
        };
      }
      return {
        data: options.headerSummary ?? {
          primary_pharmacist_name: null,
          backup_pharmacist_name: null,
          primary_staff_name: null,
          backup_staff_name: null,
          first_visit_date: null,
          last_prescribed_date: null,
          next_prescription_expected_date: null,
        },
        isLoading: false,
        isError: false,
        error: null,
      };
    }

    if (queryKey[0] === 'patient-movement-timeline') {
      return {
        data:
          options.movementTimelineLoading || options.movementTimelineError
            ? undefined
            : movementTimelineData,
        isLoading: Boolean(options.movementTimelineLoading),
        isFetching: Boolean(options.movementTimelineLoading),
        isError: Boolean(options.movementTimelineError),
        error: options.movementTimelineError ?? null,
        refetch: options.movementTimelineRefetch ?? vi.fn(),
      };
    }

    if (queryKey[0] === 'case-risk-cockpit') {
      return {
        data: options.caseRiskCockpitError ? undefined : options.caseRiskCockpit,
        isLoading: false,
        isFetching: false,
        isError: Boolean(options.caseRiskCockpitError),
        error: options.caseRiskCockpitError ?? null,
        refetch: vi.fn(),
      };
    }

    if (queryKey[0] === 'patient-overview') {
      return {
        data:
          options.patientOverviewLoading || options.patientOverviewMissing
            ? undefined
            : patientData,
        isLoading: Boolean(options.patientOverviewLoading),
        error: options.patientOverviewError ?? null,
        refetch: vi.fn(),
      };
    }

    return {
      data: patientData,
      isLoading: false,
      error: null,
    };
  });
  return {
    faxMutate,
    prescriptionDocumentMutate,
    prescriptionOriginalManagementMutate,
    billingMutate,
    billingProfileMutate,
    conferenceMutate,
    mcsCheckLogMutate,
    patientShareCaseMutate,
    riskTaskSyncMutate,
    riskTaskWaiverMutate,
    invalidateQueries,
  };
}

function buildActivePatientCase(): PatientOverview['cases'][number] {
  return {
    id: 'case_1',
    display_id: 'cc0000000001',
    status: 'active',
    primary_pharmacist_id: null,
    backup_pharmacist_id: null,
    referral_source: null,
    referral_date: null,
    start_date: '2026-06-01',
    end_date: null,
    end_reason: null,
    notes: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    required_visit_support: null,
    care_team_links: [],
  };
}

function buildCaseRiskCockpit(
  overrides: Partial<CaseRiskCockpitResponse> = {},
): CaseRiskCockpitResponse {
  return {
    generated_at: '2026-07-06T00:00:00.000Z',
    patient: { id: 'patient_1', display_id: 'pt0000000001', name: '田中 一郎' },
    case: { id: 'case_1', display_id: 'cc0000000001', status: 'active' },
    overall: {
      status: 'blocked',
      blocking_count: 1,
      urgent_count: 0,
      warning_count: 0,
    },
    sections: [],
    next_actions: [
      {
        task_id: 'task_1',
        label: '同意更新タスクを確認',
        priority: 'high',
        due_at: '2026-07-07T00:00:00.000Z',
        action_href: '/tasks/task_1',
      },
      {
        task_id: null,
        label: '正本を確認',
        priority: 'normal',
        due_at: null,
        action_href: '/patients/patient_1#patient-profile-summary',
      },
    ],
    ...overrides,
  };
}

function openPatientDetailTab(label: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

function openFoundationTab() {
  openPatientDetailTab(/正本・在宅運用/);
}

function openMedicationTab() {
  openPatientDetailTab(/薬剤・訪問/);
}

function openMovementTab() {
  openPatientDetailTab(/患者の動き/);
}

function openSharingTab() {
  openPatientDetailTab(/共有・文書/);
}

function openBillingTab() {
  openPatientDetailTab(/請求・会議/);
}

function getVisibleTestId(testId: string) {
  const visibleElement = screen
    .getAllByTestId(testId)
    .find((element) => element.closest('[hidden], [data-base-ui-inert]') == null);
  if (!visibleElement) throw new Error(`No visible element found for test id: ${testId}`);
  return visibleElement;
}

describe('CardWorkspace', () => {
  it('shows a patient workspace skeleton while the overview query is loading', () => {
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverviewLoading: true });

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '処方カード作業台を読み込み中' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '処方カード作業台', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('田中 一郎')).toBeNull();
    expect(screen.queryByText('患者情報を表示できません')).toBeNull();
    expect(screen.queryByText('患者が見つかりません')).toBeNull();
  });

  it('shows a retryable error state instead of a not-found when the patient overview fetch fails', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverviewMissing: true,
        patientOverviewError: new Error('患者情報の取得に失敗しました'),
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    // 取得失敗を「患者が見つかりません」(=不在)に潰さず、再試行導線付きの ErrorState を出す。
    expect(screen.getByText('患者情報を表示できません')).toBeTruthy();
    expect(screen.queryByText('患者が見つかりません')).toBeNull();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
  });

  it('shows a not-found state only when the patient overview resolves with no data and no error', () => {
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverviewMissing: true });

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByText('患者が見つかりません')).toBeTruthy();
    expect(screen.queryByText('患者情報を表示できません')).toBeNull();
  });

  it('keeps the workspace visible when a background refetch fails but patient data is cached', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverviewError: new Error('refetch failed'),
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    // patient データがある限り、背景 refetch 失敗でもワークスペースを全置換しない。
    expect(screen.queryByText('患者情報を表示できません')).toBeNull();
    expect(screen.queryByText('患者が見つかりません')).toBeNull();
    expect(screen.getByRole('heading', { name: '処方カード作業台', level: 1 })).toBeTruthy();
  });

  it('renders the 06_card tabbed workspace: header, safety board, tab sections, prescription, activities, rail', async () => {
    mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 3,
      top_alerts: [
        {
          id: 'documents:0:作成済み書類の交付・回収が未記録です',
          key: 'documents',
          label: '契約・同意・書類',
          message: '作成済み書類の交付・回収が未記録です',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態へ',
        },
        {
          id: 'prescription:0:FAX受信から7日経過しても原本到着が未記録です',
          key: 'prescription',
          label: '処方せん',
          message: 'FAX受信から7日経過しても原本到着が未記録です',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
        },
        {
          id: 'billing:1:未収額 1,080円 があります',
          key: 'billing',
          label: '請求・集金',
          message: '未収額 1,080円 があります',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
        },
      ],
      items: [
        {
          key: 'documents',
          label: '契約・同意・書類',
          status: '作成済・回収確認',
          description: '作成済み書類の交付・回収が未記録です',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態へ',
          tone: 'attention',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [
            { label: 'PDF/画像', value: '保存済み' },
            { label: '交付', value: '未記録' },
          ],
          alerts: ['作成済み書類の交付・回収が未記録です'],
        },
        {
          key: 'mcs',
          label: 'MCS・外部連携',
          status: '連携あり',
          description: '田中一郎 在宅チーム / 最終同期 2026/06/01',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を管理',
          external_href: 'https://www.medical-care.net/projects/medical/57886227',
          external_action_label: 'MCSを開く',
          tone: 'ok',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [{ label: '最終同期', value: '2026/06/01' }],
          alerts: [],
        },
        {
          key: 'prescription',
          label: '処方せん',
          status: '原本未着',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [
            { label: '期限', value: '2026/06/12 / 4日超過' },
            { label: '原本', value: '未着/未記録' },
            { label: 'FAX経過', value: '7日未着' },
            { label: '疑義照会', value: '未解決なし' },
            { label: '照合', value: '一致 / 2026/06/10' },
          ],
          alerts: ['FAX受信から7日経過しても原本到着が未記録です'],
          quick_actions: [
            {
              key: 'mark_fax_original_collected',
              label: '原本到着を記録',
              resource_id: 'intake_0500',
            },
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
            {
              key: 'record_prescription_original_management',
              label: '原本管理を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / candidate',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '算定候補', value: '1件' },
            { label: '支払設定', value: '家族' },
            { label: '支払方法', value: '振込' },
            { label: '今月請求額', value: '3,240円' },
            { label: '未収額', value: '1,080円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: 'R20260616-001' },
            { label: '支払者区分コード', value: 'family' },
            { label: '支払方法コード', value: 'bank_transfer' },
            { label: '集金タイミングコード', value: 'month_end' },
            { label: '領収証発行コード', value: 'paper' },
            { label: '請求書発行コード', value: 'yes' },
            { label: '未収許容コード', value: 'one_month' },
            { label: '続柄', value: '長女' },
          ],
          alerts: ['未処理の算定候補が1件あります', '未収額 1,080円 があります'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を更新',
              resource_id: 'patient_1',
            },
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
        {
          key: 'conference',
          label: 'カンファレンス',
          status: '記録あり',
          description: '退院前カンファ / 2026/06/01',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議要点へ',
          tone: 'ok',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [{ label: '報告書', value: '作成済み' }],
          alerts: [],
          quick_actions: [
            {
              key: 'open_visit_proposal',
              label: '予定候補を確認',
              resource_id: 'proposal_1',
            },
            {
              key: 'record_conference_note',
              label: '会議要点を追記',
              resource_id: 'case_1',
            },
          ],
        },
      ],
    });

    const { container } = render(<CardWorkspace patientId="patient_1" />);

    // ヘッダー行: カード見出し + RX 番号 + 右上 3 ボタン（氏名は Pinned ストリップに一本化）
    expect(screen.getByRole('heading', { name: '処方カード作業台', level: 1 })).toBeTruthy();
    expect(screen.getByText('RX-2026-0500')).toBeTruthy();
    const collaborationLink = screen.getByRole('link', { name: 'いま見ている人' });
    expect(collaborationLink.getAttribute('href')).toBe('/patients/patient_1/collaboration');
    expect(collaborationLink.className).toContain('!min-h-11');
    const profileButton = screen.getByRole('button', { name: 'プロフィールを確認' });
    expect(profileButton.className).toContain('!min-h-11');
    const compareLink = screen.getByRole('link', { name: 'カードを分割表示' });
    expect(compareLink.getAttribute('href')).toBe('/patients/compare?patients=patient_1');
    expect(compareLink.className).toContain('!min-h-11');
    expect(screen.getByRole('tablist', { name: '患者詳細セクション' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Command/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /正本・在宅運用/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /薬剤・訪問/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /共有・文書/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /請求・会議/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /履歴・構造化/ })).toBeTruthy();
    expect(screen.queryByTestId('patient-profile-summary')).toBeNull();
    expect(screen.queryByTestId('card-prescription-section')).toBeNull();
    expect(screen.getByTestId('next-action-panel')).toBeTruthy();
    expect(screen.getByTestId('blocked-reasons-panel')).toBeTruthy();
    expect(screen.getByTestId('evidence-panel')).toBeTruthy();

    fireEvent.click(profileButton);
    expect(screen.getByRole('tab', { name: /正本・在宅運用/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('patient-profile-summary')).toBeTruthy();
    const foundationPanel = screen.getByTestId('patient-foundation-panel');
    expect(within(foundationPanel).getByRole('heading', { name: '正本確認' })).toBeTruthy();
    expect(
      within(foundationPanel).getByText('最終更新 2026-06-15 / 佐藤 薬剤師 / 患者詳細'),
    ).toBeTruthy();
    expect(within(foundationPanel).getByText('確認 2026-06-15 / 鈴木 管理者')).toBeTruthy();
    expect(within(foundationPanel).getByText('異常・古い')).toBeTruthy();
    expect(within(foundationPanel).getByText('公費 54')).toBeTruthy();
    expect(within(foundationPanel).getByText('薬学リスク')).toBeTruthy();
    expect(within(foundationPanel).getByText('薬学的課題2件 / 訪問同意未整備')).toBeTruthy();
    expect(within(foundationPanel).getAllByRole('button', { name: 'タスク化' })).toHaveLength(3);
    expect(container.textContent).not.toMatch(/21540000|54001234|A-1|raw insurance note/);
    expect(screen.getByRole('heading', { name: '患者プロフィール' })).toBeTruthy();
    const contactsPanel = await screen.findByTestId('patient-contacts-panel');
    expect(
      Boolean(
        screen.getByTestId('patient-profile-summary').compareDocumentPosition(contactsPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(within(contactsPanel).getByRole('heading', { name: '患者・家族連絡先' })).toBeTruthy();
    expect(within(contactsPanel).getByText('子: 長女')).toBeTruthy();
    const contactsSaveButton = within(contactsPanel).getByRole('button', { name: '保存' });
    expect(contactsSaveButton).toHaveProperty('disabled', false);
    expect(
      within(contactsPanel).queryByText('患者情報を再読み込みしてから連絡先を保存してください。'),
    ).toBeNull();
    expect(screen.queryByTestId('patient-home-operations-panel')).toBeNull();

    openBillingTab();
    expect(screen.getByRole('tab', { name: /請求・会議/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const homeOps = getVisibleTestId('patient-home-operations-panel');
    expect(within(homeOps).getByRole('heading', { name: '在宅運用管理' })).toBeTruthy();
    expect(within(homeOps).queryByText('契約・同意・書類')).toBeNull();
    expect(within(homeOps).queryByText('MCS・外部連携')).toBeNull();
    expect(within(homeOps).queryByText('処方せん')).toBeNull();
    expect(within(homeOps).getAllByText('請求・集金').length).toBeGreaterThan(0);
    expect(within(homeOps).getByText('カンファレンス')).toBeTruthy();
    expect(within(homeOps).getByText('要確認 1件')).toBeTruthy();
    const homeOpsAlerts = screen.getByTestId('patient-home-operation-alerts');
    expect(within(homeOpsAlerts).getByRole('heading', { name: '未処理アラート' })).toBeTruthy();
    expect(within(homeOpsAlerts).getByText('1件を上から確認')).toBeTruthy();
    expect(within(homeOpsAlerts).queryByText('契約・同意・書類')).toBeNull();
    expect(within(homeOpsAlerts).queryByText('処方せん')).toBeNull();
    expect(within(homeOpsAlerts).getByText('請求・集金')).toBeTruthy();
    expect(within(homeOpsAlerts).queryByRole('link', { name: '文書状態へ' })).toBeNull();
    expect(within(homeOpsAlerts).queryByRole('link', { name: '処方履歴へ' })).toBeNull();
    expect(within(homeOps).queryByText('作成済み書類の交付・回収が未記録です')).toBeNull();
    expect(within(homeOps).queryByText('FAX受信から7日経過しても原本到着が未記録です')).toBeNull();
    expect(within(homeOps).getByText('未処理の算定候補が1件あります')).toBeTruthy();
    expect(within(homeOps).getAllByText('未収額 1,080円 があります').length).toBeGreaterThan(0);
    expect(within(homeOps).getByText('未収額')).toBeTruthy();
    expect(within(homeOps).getAllByText('領収証').length).toBeGreaterThan(0);
    expect(within(homeOps).getAllByText('R20260616-001').length).toBeGreaterThan(0);
    expect(within(homeOps).queryByText('支払者区分コード')).toBeNull();
    const expandBillingMetricsButton = within(homeOps).getByRole('button', {
      name: '全指標を表示（残り10件）',
    });
    expect(expandBillingMetricsButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expandBillingMetricsButton);
    expect(within(homeOps).getByText('支払者区分コード')).toBeTruthy();
    expect(within(homeOps).getByText('請求書発行コード')).toBeTruthy();
    expect(within(homeOps).getByText('one_month')).toBeTruthy();
    const collapseBillingMetricsButton = within(homeOps).getByRole('button', {
      name: '主要4項目に戻す',
    });
    expect(collapseBillingMetricsButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapseBillingMetricsButton);
    expect(within(homeOps).queryByText('支払者区分コード')).toBeNull();
    expect(within(homeOps).getByRole('button', { name: /支払設定を更新/ })).toBeTruthy();
    expect(within(homeOps).getByRole('button', { name: /集金記録を更新/ })).toBeTruthy();
    expect(
      within(homeOps)
        .getByRole('link', { name: /予定候補を確認/ })
        .getAttribute('href'),
    ).toBe(
      '/schedules/proposals?workspace=dashboard&patient_id=patient_1&case_id=case_1&focus=patient&detail=proposal_1',
    );
    expect(within(homeOps).getByRole('button', { name: /会議要点を追記/ })).toBeTruthy();
    expect(
      within(homeOps)
        .getAllByRole('link', { name: /請求候補を確認/ })
        .some(
          (link) =>
            link.getAttribute('href') ===
            '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
        ),
    ).toBe(true);
    expect(
      within(homeOps)
        .getByRole('link', { name: /会議要点へ/ })
        .getAttribute('href'),
    ).toBe('/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail');

    openSharingTab();
    expect(screen.getByRole('tab', { name: /共有・文書/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const sharePanel = screen.getByTestId('patient-share-case-create-panel');
    expect(within(sharePanel).getByRole('heading', { name: '薬局間共有ケース' })).toBeTruthy();
    expect(sharePanel.textContent).not.toMatch(/田中 一郎|090-0000-0000/);
    const documentsPanel = screen.getByTestId('patient-card-documents-panel');
    expect(
      Boolean(
        sharePanel.compareDocumentPosition(documentsPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      await within(documentsPanel).findByRole('heading', { name: '初回訪問文書・交付記録' }),
    ).toBeTruthy();
    expect(within(documentsPanel).getByText('印刷前チェック')).toBeTruthy();
    expect(within(documentsPanel).getByText('確認あり / 確認 1件')).toBeTruthy();
    expect(within(documentsPanel).getByText('契約・同意書類の現在状態')).toBeTruthy();
    expect(within(documentsPanel).getAllByText('契約書').length).toBeGreaterThan(0);
    expect(
      within(documentsPanel).getByRole('link', { name: '印刷プレビュー' }).getAttribute('href'),
    ).toBe('/reports/print?type=first_visit_documents&patient_id=patient_1');
    const sharingHomeOps = getVisibleTestId('patient-home-operations-panel');
    expect(within(sharingHomeOps).getAllByText('契約・同意・書類').length).toBeGreaterThan(0);
    expect(within(sharingHomeOps).getByText('MCS・外部連携')).toBeTruthy();
    expect(within(sharingHomeOps).queryByText('処方せん')).toBeNull();
    expect(within(sharingHomeOps).queryByText('請求・集金')).toBeNull();
    expect(
      within(sharingHomeOps)
        .getAllByRole('link', { name: /文書状態へ/ })
        .some((link) => link.getAttribute('href') === '/patients/patient_1#patient-documents'),
    ).toBe(true);
    const mcsExternalLink = within(sharingHomeOps).getByRole('link', { name: /MCSを開く/ });
    expect(mcsExternalLink.getAttribute('href')).toBe(
      'https://www.medical-care.net/projects/medical/57886227',
    );
    expect(mcsExternalLink.getAttribute('target')).toBe('_blank');
    expect(
      within(sharingHomeOps)
        .getByRole('link', { name: /MCS連携を管理/ })
        .getAttribute('href'),
    ).toBe('/patients/patient_1/mcs');

    openMedicationTab();
    expect(screen.getByRole('tab', { name: /薬剤・訪問/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const medicationHomeOps = getVisibleTestId('patient-home-operations-panel');
    expect(within(medicationHomeOps).getAllByText('処方せん').length).toBeGreaterThan(0);
    expect(within(medicationHomeOps).queryByText('請求・集金')).toBeNull();
    expect(within(medicationHomeOps).getAllByText('照合').length).toBeGreaterThan(0);
    expect(within(medicationHomeOps).getByText('一致 / 2026/06/10')).toBeTruthy();
    expect(within(medicationHomeOps).getByRole('button', { name: /原本到着を記録/ })).toBeTruthy();
    expect(within(medicationHomeOps).getByRole('button', { name: /画像\/PDFを保存/ })).toBeTruthy();
    expect(within(medicationHomeOps).getByRole('button', { name: /原本管理を記録/ })).toBeTruthy();
    expect(
      within(medicationHomeOps)
        .getAllByRole('link', { name: /処方履歴へ/ })
        .some((link) => link.getAttribute('href') === '/patients/patient_1/prescriptions'),
    ).toBe(true);
    // 共通患者ヘッダーの安全層: アレルギー / 腎機能 / 取扱タグ / 嚥下 / 注意
    const safetyBoard = screen.getByTestId('patient-header-safety');
    expect(within(safetyBoard).getByText('セフェム系(2019)')).toBeTruthy();
    expect(within(safetyBoard).getByText('eGFR 38(6/1)')).toBeTruthy();
    expect(within(safetyBoard).getByText('一包化')).toBeTruthy();
    expect(within(safetyBoard).getByText('錠剤OK・大きい錠は半割')).toBeTruthy();
    expect(within(safetyBoard).getByText('ふらつき(6/5〜経過観察)')).toBeTruthy();

    // 今回の処方: RX 見出し + 現在工程 + 9 工程チップ + 薬剤テーブル
    expect(screen.getByRole('heading', { name: '今回の処方 — RX-2026-0500' })).toBeTruthy();
    expect(screen.getByText('工程: 監査(いまここ)')).toBeTruthy();
    const chips = screen.getByTestId('process-chips');
    expect(
      within(chips).getByText('監査').closest('[data-state]')?.getAttribute('data-state'),
    ).toBe('current');
    const prescriptionSection = screen.getByTestId('card-prescription-section');
    expect(
      Boolean(
        prescriptionSection.compareDocumentPosition(foundationPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    // DataTable はデスクトップ表/モバイルカードを両方 DOM に描画するため getAllByText で拾う。
    expect(
      within(prescriptionSection).getAllByText('アムロジピン錠5mg').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      within(prescriptionSection).getAllByText('オキシコドン錠5mg').length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(prescriptionSection).getAllByText('14錠').length).toBeGreaterThanOrEqual(1);
    expect(within(prescriptionSection).getAllByText('28日分').length).toBeGreaterThanOrEqual(1);
    expect(within(prescriptionSection).getAllByText('麻薬').length).toBeGreaterThanOrEqual(1);
    expect(within(prescriptionSection).getAllByText('冷所').length).toBeGreaterThanOrEqual(1);
    // 無タグ行に「安全タグなし」風の淡表示は出さない
    expect(screen.queryByText('安全タグなし')).toBeNull();

    // 直近の動き: 時系列 3 行 + 「開く」
    const activities = screen.getByTestId('card-recent-activities');
    expect(within(activities).getByText('調剤 完了 — 佐藤')).toBeTruthy();
    expect(within(activities).getByText('残薬調整 → 疑義照会 回答受領')).toBeTruthy();
    expect(within(activities).getByText('定期処方 取込(やまもと内科)')).toBeTruthy();
    expect(within(activities).getAllByRole('button', { name: '開く' })).toHaveLength(3);
    // 直近の動き種別バッジは SSOT 6軸トークン（工程=info / 照会=confirm / 取込=neutral）。
    expect(activities.innerHTML).toContain('text-tag-info');
    expect(activities.innerHTML).toContain('text-state-confirm');
    // 回帰: 旧 ad-hoc な emerald/blue カテゴリ色が残っていないこと。
    expect(activities.innerHTML).not.toMatch(
      /border-emerald-200|bg-emerald-50|text-emerald-700|border-blue-200|bg-blue-50|text-blue-700/,
    );

    // Primary zone: このカードに紐づく今日(期限/監査後/時刻 + 遷移リンク)を実作業の最上部へ昇格
    const todayPanel = screen.getByTestId('card-today-panel');
    expect(within(todayPanel).getByText('期限 12:00')).toBeTruthy();
    expect(within(todayPanel).getByText('麻薬監査')).toBeTruthy();
    expect(within(todayPanel).getByText('監査後')).toBeTruthy();
    expect(within(todayPanel).getByRole('link', { name: /監査へ/, hidden: true })).toBeTruthy();
    expect(within(todayPanel).getByRole('link', { name: /セットへ/, hidden: true })).toBeTruthy();
    expect(within(todayPanel).getByRole('link', { name: /訪問へ/, hidden: true })).toBeTruthy();

    // Command タブは、患者を開いた直後に次の作業と今日のタスクを同じ順序で見せる。
    expect(screen.getByTestId('next-action-panel')).toBeTruthy();
    expect(screen.getByTestId('blocked-reasons-panel')).toBeTruthy();
    expect(screen.getByTestId('evidence-panel')).toBeTruthy();
    const commandActivities = screen.getByTestId('command-recent-activities-panel');
    expect(within(commandActivities).getByText('調剤 完了 — 佐藤')).toBeTruthy();
    expect(within(commandActivities).getByText('残薬調整 → 疑義照会 回答受領')).toBeTruthy();
    expect(within(commandActivities).getByText('定期処方 取込(やまもと内科)')).toBeTruthy();
    expect(
      within(commandActivities).getAllByRole('link', { name: '開く', hidden: true }),
    ).toHaveLength(3);
    const commandTimeline = screen.getByTestId('command-timeline-excerpt-panel');
    expect(within(commandTimeline).getByText('訪問記録を保存')).toBeTruthy();
    expect(within(commandTimeline).getByText('報告書を作成')).toBeTruthy();
    expect(
      within(commandTimeline).getByRole('link', { name: '患者の動きへ', hidden: true }),
    ).toBeTruthy();
  });

  it('syncs active case risks into operational tasks from the Command tab without exposing finding detail', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            generated_at: '2026-07-06T00:00:00.000Z',
            case_id: 'case_1',
            patient_id: 'patient_1',
            overall_status: 'blocked',
            taskable_finding_count: 2,
            skipped_finding_count: 3,
            upserted_task_count: 2,
            resolved_stale_task_count: 1,
            upserted_tasks: [{ id: 'task_1', display_id: 'tsk0000000001' }],
            resolved_stale_tasks: [{ id: 'task_9', display_id: 'tsk0000000009' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { invalidateQueries } = mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: { cases: [buildActivePatientCase()] },
        executeRiskTaskSyncMutation: true,
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const panel = screen.getByTestId('case-risk-task-sync-panel');
    expect(within(panel).getByText('対象: ケース cc0000000001 / 稼働中')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '同期する' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/cases/case_1/risk-cockpit/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      }),
    );
    await waitFor(() => expect(within(panel).getByText('同期済み')).toBeTruthy());
    expect(within(panel).getByText('2件')).toBeTruthy();
    expect(within(panel).getByText('1件')).toBeTruthy();
    expect(within(panel).getByText('3件')).toBeTruthy();
    expect(JSON.stringify(panel.textContent)).not.toContain('task_1');
    expect(JSON.stringify(panel.textContent)).not.toContain('tsk0000000001');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['patient-overview', 'patient_1', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['case-risk-cockpit', 'case_1', 'org_1'],
    });
    expect(toast.success).toHaveBeenCalledWith(
      '未解決リスクをタスクへ同期しました（作成/更新 2件 / 解決 1件）',
    );

    vi.unstubAllGlobals();
  });

  it('disables risk task sync when the patient has no case', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { cases: [] } });

    render(<CardWorkspace patientId="patient_1" />);

    const panel = screen.getByTestId('case-risk-task-sync-panel');
    const button = within(panel).getByRole('button', { name: '同期する' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(within(panel).getByText('対象ケースがありません。')).toBeTruthy();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('keeps risk task sync failures visible inside the Command tab', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: { cases: [buildActivePatientCase()] },
        riskTaskSyncError: new Error('ケースリスクタスク同期APIからの詳細エラー'),
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const panel = screen.getByTestId('case-risk-task-sync-panel');
    expect(within(panel).getByRole('alert').textContent).toContain(
      'ケースリスクタスク同期APIからの詳細エラー',
    );
    expect(within(panel).queryByText('同期済み')).toBeNull();
  });

  it('waives a task-backed case risk next action through the dedicated case-scoped route', async () => {
    let capturedRequestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequestInit = init;
      return new Response(
        JSON.stringify({
          data: {
            task_id: 'task_1',
            display_id: 'tsk0000000001',
            case_id: 'case_1',
            resolution_state: 'waived',
            task_status: 'cancelled',
            updated_count: 1,
            audit_logged: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { invalidateQueries } = mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: { cases: [buildActivePatientCase()] },
        caseRiskCockpit: buildCaseRiskCockpit(),
        executeRiskTaskWaiverMutation: true,
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const actionsPanel = screen.getByTestId('case-risk-actions-panel');
    expect(within(actionsPanel).getByText('同意更新タスクを確認')).toBeTruthy();
    expect(within(actionsPanel).getByText('正本を確認')).toBeTruthy();
    expect(within(actionsPanel).getByText('停止中')).toBeTruthy();
    expect(within(actionsPanel).getAllByRole('link', { name: '対応する' })).toHaveLength(2);

    const panel = screen.getByTestId('case-risk-task-resolution-panel');
    expect(within(panel).getByText('同意更新タスクを確認')).toBeTruthy();
    expect(within(panel).queryByText('正本を確認')).toBeNull();
    const submit = within(panel).getByRole('button', { name: '免除を記録' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(submit.getAttribute('aria-describedby')).toContain('risk-task-waiver-reason-helper');
    expect(within(panel).getByText('免除理由を入力すると記録できます。')).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText('免除理由'), {
      target: { value: '薬剤師確認済みのため今回免除' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/cases/case_1/risk-cockpit/tasks/task_1/resolution',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
          body: JSON.stringify({
            resolution_state: 'waived',
            waiver_reason: '薬剤師確認済みのため今回免除',
            reason_code: 'pharmacist_reviewed',
          }),
        },
      ),
    );
    expect(capturedRequestInit).toBeDefined();
    const body = JSON.parse(String(capturedRequestInit?.body)) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('同意更新タスクを確認');
    expect(JSON.stringify(body)).not.toContain('tsk0000000001');
    expect(JSON.stringify(body)).not.toContain('田中');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['patient-overview', 'patient_1', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['case-risk-cockpit', 'case_1', 'org_1'],
    });
    expect(toast.success).toHaveBeenCalledWith('リスクタスクの免除を記録しました');

    vi.unstubAllGlobals();
  });

  it('keeps risk task waiver failures visible and does not expose non-task next actions as waivable', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: { cases: [buildActivePatientCase()] },
        caseRiskCockpit: buildCaseRiskCockpit({
          next_actions: [
            {
              task_id: null,
              label: '正本を確認',
              priority: 'normal',
              due_at: null,
              action_href: '/patients/patient_1#patient-profile-summary',
            },
          ],
        }),
        riskTaskWaiverError: new Error('免除APIからの詳細エラー'),
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const actionsPanel = screen.getByTestId('case-risk-actions-panel');
    expect(within(actionsPanel).getByText('正本を確認')).toBeTruthy();
    expect(within(actionsPanel).getByRole('link', { name: '対応する' })).toBeTruthy();

    const panel = screen.getByTestId('case-risk-task-resolution-panel');
    expect(within(panel).queryByTestId('case-risk-task-resolution-action')).toBeNull();
    expect(
      within(panel).getByText(
        'タスク化済みの未解決リスクはありません。必要な場合は上の同期を実行してください。',
      ),
    ).toBeTruthy();
    expect(within(panel).getByRole('alert').textContent).toContain('免除APIからの詳細エラー');
  });

  it('keeps the Case Risk Cockpit fetch failure retry target at the PH-OS 44px size', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: { cases: [buildActivePatientCase()] },
        caseRiskCockpitError: new Error('Case Risk Cockpit API error'),
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const panel = screen.getByTestId('case-risk-task-resolution-panel');
    expect(within(panel).getByRole('alert').textContent).toContain('Case Risk Cockpit API error');
    expect(within(panel).getByRole('button', { name: '再試行' }).className).toContain('min-h-11');
  });

  it('does not mix a no-case state with an empty-risk state', () => {
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { cases: [] } });

    render(<CardWorkspace patientId="patient_1" />);

    const panel = screen.getByTestId('case-risk-task-resolution-panel');
    expect(within(panel).getByText('対象ケースがありません。')).toBeTruthy();
    expect(
      within(panel).queryByText(
        'タスク化済みの未解決リスクはありません。必要な場合は上の同期を実行してください。',
      ),
    ).toBeNull();
    const actionsPanel = screen.getByTestId('case-risk-actions-panel');
    expect(within(actionsPanel).getByText('対象ケースがありません。')).toBeTruthy();
    expect(within(actionsPanel).queryByText('横断リスクの次アクションはありません。')).toBeNull();
  });

  it('opens the matching patient detail tab for an initial section hash', async () => {
    window.history.replaceState({}, '', '/patients/patient_1#patient-documents');
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByRole('tab', { name: /共有・文書/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByTestId('patient-profile-summary')).toBeNull();
    expect(await screen.findByTestId('patient-card-documents-panel')).toBeTruthy();
  });

  it('loads a 5-item timeline excerpt for Command and expands to the bounded full timeline on demand', async () => {
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    const initialMovementTimelineConfig = useQueryMock.mock.calls
      .map(([config]) => config as { queryKey?: unknown[]; enabled?: boolean })
      .filter((config) => config.queryKey?.[0] === 'patient-movement-timeline')
      .at(-1);
    expect(initialMovementTimelineConfig).toMatchObject({
      queryKey: ['patient-movement-timeline', 'patient_1', 'org_1', 5],
      enabled: true,
    });

    fireEvent.click(screen.getByRole('tab', { name: /患者の動き/ }));

    expect(
      await screen.findByText(
        '直近5件の患者の動きを先に表示しています。追加履歴は必要な時だけ読み込みます。',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '履歴を追加読み込み（最大40件）' })).toBeTruthy();
    expect(screen.getAllByText('訪問記録を保存').length).toBeGreaterThanOrEqual(1);

    const enabledMovementTimelineConfig = useQueryMock.mock.calls
      .map(([config]) => config as { queryKey?: unknown[]; enabled?: boolean })
      .find(
        (config) => config.queryKey?.[0] === 'patient-movement-timeline' && config.enabled === true,
      );
    expect(enabledMovementTimelineConfig).toMatchObject({
      queryKey: ['patient-movement-timeline', 'patient_1', 'org_1', 5],
      enabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: '履歴を追加読み込み（最大40件）' }));

    await waitFor(() => {
      expect(
        useQueryMock.mock.calls.some(([config]) => {
          const queryConfig = config as { queryKey?: unknown[] };
          return (
            queryConfig.queryKey?.[0] === 'patient-movement-timeline' &&
            queryConfig.queryKey[3] === 40
          );
        }),
      ).toBe(true);
    });
  });

  it('keeps change history separate from the patient movement timeline', async () => {
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.click(screen.getByRole('tab', { name: /履歴・構造化/ }));

    expect(await screen.findByTestId('card-field-revisions')).toBeTruthy();
    expect(screen.getByTestId('patient-structured-care')).toBeTruthy();
    expect(screen.queryByText('直近5件のアクティビティを先に表示しています。')).toBeNull();

    openMovementTab();

    expect((await screen.findAllByText('訪問記録を保存')).length).toBeGreaterThan(0);
  });

  it('uses the shared segment error for patient movement timeline failures without exposing raw error detail', async () => {
    const refetchMovementTimeline = vi.fn();
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        movementTimelineError: new Error('internal stack includes patient name and raw response'),
        movementTimelineRefetch: refetchMovementTimeline,
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openMovementTab();

    expect(await screen.findByText('患者の動きを表示できません')).toBeTruthy();
    expect(screen.getByText(/患者の動きの取得に失敗しました。/)).toBeTruthy();
    expect(screen.getByText(/通信状態または権限を確認して再試行してください。/)).toBeTruthy();
    expect(screen.queryByText(/internal stack includes patient name/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '患者の動きを再取得' }));
    expect(refetchMovementTimeline).toHaveBeenCalledTimes(1);
  });

  it('prefers movement-safe timeline events on the patient movement tab', async () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        movementTimeline: {
          movement_events: [
            {
              id: 'visit_record:visit_unsafe',
              event_type: 'visit_event',
              category: 'visit',
              occurred_at: '2026-06-18T09:00:00.000Z',
              title: '訪問記録を保存',
              summary: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
              href: '/visits/visit_unsafe',
              action_label: '訪問記録へ',
              status: 'completed',
              status_label: '完了',
              actor_name: '佐藤 薬剤師',
              actor_role: null,
              source_channel: null,
              source_label: null,
              related_entity_type: 'visit_record',
              related_entity_id: 'visit_unsafe',
              severity: 'normal',
              badges: [{ label: '完了', tone: 'success' }],
              metadata: [],
              privacy_level: 'summary',
              raw_available: false,
            },
          ],
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openMovementTab();

    expect(
      (
        await screen.findAllByText(
          '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('SOAP本文と訪問内容の詳細')).toBeNull();
    expect(screen.queryByText('SOAP本文あり')).toBeNull();
  });

  it('switches patient detail tabs when section hashes change', async () => {
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByRole('tab', { name: /Command/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('patient-profile-summary')).toBeNull();

    act(() => {
      window.history.pushState({}, '', '/patients/patient_1#patient-profile-summary');
      window.dispatchEvent(new Event('hashchange'));
    });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /正本・在宅運用/ }).getAttribute('aria-selected'),
      ).toBe('true');
    });
    expect(screen.getByTestId('patient-profile-summary')).toBeTruthy();
    expect(screen.getByTestId('patient-contacts-panel')).toBeTruthy();

    act(() => {
      window.history.pushState({}, '', '/patients/patient_1#patient-field-revisions');
      window.dispatchEvent(new Event('hashchange'));
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /履歴・構造化/ }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    expect(screen.getByTestId('card-field-revisions').getAttribute('id')).toBe(
      'patient-field-revisions',
    );
  });

  it.each([
    ['#card-prescription-section', /薬剤・訪問/, 'card-prescription-section'],
    ['#patient-visit-preparation', /薬剤・訪問/, 'card-prescription-section'],
    ['#patient-movement', /患者の動き/, 'patient-movement-panel'],
    ['#inbound-communications', /患者の動き/, 'patient-movement-panel'],
    ['#inbound-signals', /患者の動き/, 'patient-movement-panel'],
    ['#medication-stock-events', /患者の動き/, 'patient-movement-panel'],
    ['#patient-home-operations', /請求・会議/, 'patient-home-operations-panel'],
    ['#patient-billing', /請求・会議/, 'patient-home-operations-panel'],
    ['#patient-conference', /請求・会議/, 'patient-home-operations-panel'],
    ['#patient-structured-care', /履歴・構造化/, 'patient-structured-care'],
  ])('opens %s in the matching patient detail tab', async (hash, tabName, testId) => {
    window.history.replaceState({}, '', `/patients/patient_1${hash}`);
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByRole('tab', { name: tabName }).getAttribute('aria-selected')).toBe('true');
    const target = getVisibleTestId(testId);
    if (hash === '#patient-home-operations') {
      expect(target.getAttribute('id')).toBe('patient-home-operations');
    }
  });

  it('surfaces archived patient state in the pinned patient header', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: {
          archived_at: '2026-06-30T00:00:00.000Z',
          archived_by: 'user_admin',
          archived_by_name: '管理者',
          foundation: {
            summary: { status: 'missing', label: 'アーカイブ中', items: ['read-onlyで確認'] },
            items: [],
            changes_since_last_visit: [],
            latest_labs: [],
            insurances: [],
            archive: {
              archived: true,
              archived_at: '2026-06-30',
              archived_by_name: '管理者',
            },
          },
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const header = screen.getByTestId('patient-header');
    expect(within(header).getByTestId('patient-header-archive-badge').textContent).toContain(
      'アーカイブ中',
    );
    expect(within(header).getByTestId('patient-header-archive-notice').textContent).toContain(
      '復元するまで新規作業・共有・更新には使わないでください',
    );
    openFoundationTab();
    const foundationPanel = screen.getByTestId('patient-foundation-panel');
    expect(within(foundationPanel).getByText('アーカイブ中の患者です')).toBeTruthy();
    expect(within(foundationPanel).queryByText('未確認を作業化')).toBeNull();
  });

  it('surfaces a clear failure state when the patient header summary fetch errors (no false-empty)', () => {
    mockPatientQuery(buildWorkspace(), null, {}, { headerSummaryError: true });

    render(<CardWorkspace patientId="patient_1" />);

    // 取得失敗を「データなし」として黙って隠さず、明示的なエラー帯を出す。
    const errorNotice = screen.getByTestId('patient-header-summary-error');
    expect(errorNotice.textContent).toContain('取得できませんでした');
  });

  it('focuses family consent follow-up links on the patient reply-waiting queue', () => {
    useUIStore.setState({ workspaceRailOpen: true });
    mockPatientQuery(
      buildWorkspace({
        open_exceptions: [
          {
            id: 'exception_consent',
            exception_type: 'family_consent_pending',
            description: 'ご家族の同意待ち(新規契約)',
            severity: 'warning',
            created_at: '2026-06-01T09:30:00.000Z',
          },
        ],
      }),
    );

    render(<CardWorkspace patientId="patient_1" />);

    const blockedReasons = getVisibleTestId('blocked-reasons-panel');
    expect(within(blockedReasons).getByText('家族同意待ち — 確認が必要です')).toBeTruthy();
    expect(within(blockedReasons).queryByText('ご家族の同意待ち(新規契約)')).toBeNull();
    expect(
      within(blockedReasons).getByRole('link', { name: '再連絡する →' }).getAttribute('href'),
    ).toBe('/communications/requests?status=sent&patient_id=patient_1');
  });

  it('focuses awaiting-reply exception links on the patient reply-waiting queue', () => {
    useUIStore.setState({ workspaceRailOpen: true });
    mockPatientQuery(
      buildWorkspace({
        open_exceptions: [
          {
            id: 'exception_reply',
            exception_type: 'awaiting_reply',
            description: '主治医からの返信待ち',
            severity: 'warning',
            created_at: '2026-06-01T09:30:00.000Z',
          },
        ],
      }),
    );

    render(<CardWorkspace patientId="patient_1" />);

    const blockedReasons = getVisibleTestId('blocked-reasons-panel');
    expect(within(blockedReasons).getByText('返信待ち — 再確認できます')).toBeTruthy();
    expect(within(blockedReasons).queryByText('主治医からの返信待ち')).toBeNull();
    expect(
      within(blockedReasons).getByRole('link', { name: '状況を見る →' }).getAttribute('href'),
    ).toBe('/communications/requests?status=sent&patient_id=patient_1');
  });

  it('aligns intervention start with the backend latest-case tie-break (updated_at, created_at, id desc)', () => {
    const sharedUpdatedAt = '2026-06-15T00:00:00.000Z';
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: {
          cases: [
            {
              id: 'case_a',
              status: 'active',
              primary_pharmacist_id: null,
              backup_pharmacist_id: null,
              referral_source: null,
              referral_date: null,
              start_date: '2026-06-01',
              end_date: null,
              end_reason: null,
              notes: null,
              created_at: '2026-06-01T00:00:00.000Z',
              updated_at: sharedUpdatedAt,
              required_visit_support: null,
              care_team_links: [],
            },
            {
              id: 'case_b',
              status: 'active',
              primary_pharmacist_id: null,
              backup_pharmacist_id: null,
              referral_source: null,
              referral_date: null,
              start_date: '2026-06-10',
              end_date: null,
              end_reason: null,
              notes: null,
              // updated_at は case_a と同値。tie-break は created_at desc で case_b が勝つ。
              created_at: '2026-06-10T00:00:00.000Z',
              updated_at: sharedUpdatedAt,
              required_visit_support: null,
              care_team_links: [],
            },
          ],
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    const header = screen.getByTestId('patient-header');
    // tie-break 勝者 case_b の start_date(2026/6/10)が介入開始として表示される。
    expect(within(header).getByText(/2026\/6\/10〜/)).toBeTruthy();
    // 敗者 case_a の start_date(2026/6/1)は介入開始として出さない。
    expect(within(header).queryByText(/2026\/6\/1〜/)).toBeNull();
  });

  it('routes card workspace patient links through buildPatientHref and encodes compare query params', () => {
    const hostileId = 'pt/1?x=y#z';
    const realBuildPatientHref = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockClear();
    vi.mocked(buildPatientHref).mockImplementation(
      (patientId: string, suffix = '') =>
        `/patients/__encoded_${encodeURIComponent(patientId)}__${suffix}`,
    );
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { id: hostileId } });

    try {
      render(<CardWorkspace patientId={hostileId} />);
      openFoundationTab();
      openSharingTab();
      openMedicationTab();

      const calls = vi
        .mocked(buildPatientHref)
        .mock.calls.map(([patientId, suffix]) => [patientId, suffix ?? '']);
      const expectedCalls = [
        [hostileId, '/collaboration'],
        [hostileId, '#patient-profile-summary'],
        [hostileId, '#patient-profile-summary'],
        [hostileId, '/safety-check'],
        [hostileId, '/edit'],
        [hostileId, '#patient-documents'],
        [hostileId, '/mcs'],
        [hostileId, '/prescriptions'],
      ];
      const callSet = new Set(calls.map((call) => JSON.stringify(call)));
      for (const expectedCall of expectedCalls) {
        expect(callSet.has(JSON.stringify(expectedCall))).toBe(true);
      }

      const hrefs = Array.from(document.querySelectorAll('a')).map((link) =>
        link.getAttribute('href'),
      );
      expect(hrefs).toContain(
        `/patients/__encoded_${encodeURIComponent(hostileId)}__/collaboration`,
      );
      expect(hrefs).toContain(
        `/patients/__encoded_${encodeURIComponent(hostileId)}__/safety-check`,
      );
      expect(hrefs).toContain(
        `/patients/__encoded_${encodeURIComponent(hostileId)}__#patient-documents`,
      );
      expect(hrefs).toContain(`/patients/__encoded_${encodeURIComponent(hostileId)}__/mcs`);
      expect(hrefs).toContain(
        `/patients/__encoded_${encodeURIComponent(hostileId)}__/prescriptions`,
      );
      expect(hrefs).toContain(
        `/patients/compare?${new URLSearchParams({ patients: hostileId }).toString()}`,
      );
      expect(hrefs).not.toContain(`/patients/${hostileId}/collaboration`);
    } finally {
      if (realBuildPatientHref)
        vi.mocked(buildPatientHref).mockImplementation(realBuildPatientHref);
      vi.clearAllMocks();
    }
  });

  it('keeps the embedded documents panel in place when document loading fails', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientDocuments: {
          data: undefined,
          error: new Error('文書情報の取得に失敗しました'),
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const documentsPanel = screen.getByTestId('patient-card-documents-panel');
    expect(
      within(documentsPanel).getByRole('heading', { name: '初回訪問文書・交付記録' }),
    ).toBeTruthy();
    expect(within(documentsPanel).getByText('文書情報の取得に失敗しました')).toBeTruthy();
    expect(within(documentsPanel).queryByRole('link', { name: '印刷プレビュー' })).toBeNull();
    expect(within(documentsPanel).queryByText('契約書')).toBeNull();
  });

  it('shows a documents-panel skeleton while first-visit documents are loading', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientDocuments: {
          data: undefined,
          isLoading: true,
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const documentsPanel = screen.getByTestId('patient-card-documents-panel');
    expect(
      within(documentsPanel).getByRole('status', {
        name: '初回訪問文書・交付記録を読み込み中',
      }),
    ).toBeTruthy();
    expect(
      within(documentsPanel).getByRole('heading', { name: '初回訪問文書・交付記録' }),
    ).toBeTruthy();
    expect(
      within(documentsPanel).queryByRole('status', { name: '文書情報を読み込み中...' }),
    ).toBeNull();
    expect(within(documentsPanel).queryByRole('link', { name: '印刷プレビュー' })).toBeNull();
    expect(within(documentsPanel).queryByText('契約書')).toBeNull();
    expect(within(documentsPanel).queryByText('文書情報の取得に失敗しました')).toBeNull();
  });

  it('keeps the embedded documents panel in place when document data is missing', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientDocuments: {
          data: undefined,
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const documentsPanel = screen.getByTestId('patient-card-documents-panel');
    expect(
      within(documentsPanel).getByRole('heading', { name: '初回訪問文書・交付記録' }),
    ).toBeTruthy();
    expect(within(documentsPanel).getByText('文書情報の取得に失敗しました')).toBeTruthy();
    expect(within(documentsPanel).queryByRole('link', { name: '印刷プレビュー' })).toBeNull();
    expect(within(documentsPanel).queryByText('契約書')).toBeNull();
  });

  it('falls back to an empty state when no cycle workspace exists', () => {
    mockPatientQuery(null);

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByRole('heading', { name: '処方カード作業台', level: 1 })).toBeTruthy();
    expect(screen.queryByText('進行中のカードがありません')).toBeNull();
    expect(
      screen.getByText(
        '進行中の処方カードがないため、正本・共有・患者の動きで患者情報を確認してください。',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('case-risk-actions-panel')).toBeTruthy();
    openFoundationTab();
    expect(screen.getByTestId('patient-profile-summary')).toBeTruthy();
    expect(screen.queryByTestId('patient-home-operations-panel')).toBeNull();
    openBillingTab();
    expect(screen.getByTestId('patient-home-operations-panel')).toBeTruthy();
    expect(screen.queryByTestId('card-prescription-section')).toBeNull();
  });

  it('does not hide Case Risk actions when no cycle workspace exists', () => {
    mockPatientQuery(
      null,
      null,
      {},
      {
        patientOverrides: { cases: [buildActivePatientCase()] },
        caseRiskCockpit: buildCaseRiskCockpit(),
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.queryByText('進行中のカードがありません')).toBeNull();
    const actionsPanel = screen.getByTestId('case-risk-actions-panel');
    expect(within(actionsPanel).getByText('同意更新タスクを確認')).toBeTruthy();
    expect(within(actionsPanel).getByText('正本を確認')).toBeTruthy();
    expect(within(actionsPanel).getByText('停止中')).toBeTruthy();
    expect(within(actionsPanel).getAllByRole('link', { name: '対応する' })).toHaveLength(2);
    expect(screen.getByTestId('case-risk-task-sync-panel')).toBeTruthy();
    expect(screen.getByTestId('case-risk-task-resolution-panel')).toBeTruthy();
    expect(screen.queryByText('田中 一郎 raw detail')).toBeNull();
  });

  it('surfaces a degraded banner instead of a false all-clear when home operations fail (FEUX-3)', () => {
    const homeOperationsRefetch = vi.fn();
    mockPatientQuery(null, null, {}, { homeOperationsError: true, homeOperationsRefetch });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    const homeOps = getVisibleTestId('patient-home-operations-panel');
    // 取得失敗を「主要項目 確認済み」(偽の全クリア)に潰さない。
    expect(within(homeOps).queryByText('主要項目 確認済み')).toBeNull();
    expect(within(homeOps).getByText('サーバー集計 取得失敗')).toBeTruthy();

    const banner = screen.getByTestId('patient-home-operations-error');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('サーバー集計を取得できませんでした');

    fireEvent.click(within(banner).getByRole('button', { name: '再試行' }));
    expect(homeOperationsRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the all-clear badge available when home operations load successfully (FEUX-3 guard)', () => {
    mockPatientQuery(null, null, {}, {});

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    // 成功時は劣化バナーを出さない(誤検知防止)。
    expect(screen.queryByTestId('patient-home-operations-error')).toBeNull();
    expect(
      within(getVisibleTestId('patient-home-operations-panel')).queryByText(
        'サーバー集計 取得失敗',
      ),
    ).toBeNull();
  });

  it('creates a draft patient share case from the patient master without sending patient PHI', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url === '/api/patient-share-cases') {
        return {
          ok: true,
          json: async () => ({ id: 'share_case_created', status: 'draft' }),
        };
      }
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { patientShareCaseMutate, invalidateQueries } = mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        executePatientShareCaseMutation: true,
        patientOverrides: {
          cases: [
            {
              id: 'case_1',
              display_id: 'cc0000000001',
              status: 'active',
              primary_pharmacist_id: null,
              backup_pharmacist_id: null,
              referral_source: null,
              referral_date: null,
              start_date: '2026-06-01',
              end_date: null,
              end_reason: null,
              notes: null,
              created_at: '2026-06-01T00:00:00.000Z',
              updated_at: '2026-06-01T00:00:00.000Z',
              required_visit_support: null,
              care_team_links: [],
            },
          ],
        },
        managementPlans: {
          data: [
            {
              id: 'plan_approved',
              case_id: 'case_1',
              title: '田中 一郎 様 管理計画',
              version: 3,
              status: 'approved',
              effective_from: '2026-06-01T00:00:00.000Z',
              updated_at: '2026-06-18T00:00:00.000Z',
            },
            {
              id: 'plan_draft',
              case_id: 'case_1',
              title: '下書き計画',
              version: 4,
              status: 'draft',
              effective_from: null,
              updated_at: '2026-06-18T00:00:00.000Z',
            },
          ],
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const panel = screen.getByTestId('patient-share-case-create-panel');
    expect(
      within(panel).getByRole('option', { name: 'ケース cc0000000001 / 稼働中' }),
    ).toBeTruthy();
    expect(within(panel).queryByText('ケース #CASE_1 / 稼働中')).toBeNull();
    expect(panel.textContent).not.toMatch(/田中 一郎|090-0000-0000|東京都/);
    expect(panel.textContent).not.toContain('田中 一郎 様 管理計画');
    const managementPlanSelect = within(panel).getByLabelText(
      '共有ケース作成の管理計画版',
    ) as HTMLSelectElement;
    expect(within(panel).queryByText('承認済み計画なし')).toBeNull();
    expect(within(panel).getByText('計画 plan_approved / v3')).toBeTruthy();
    expect(within(panel).queryByText('計画 plan_draft / v4')).toBeNull();
    expect(managementPlanSelect.disabled).toBe(false);
    fireEvent.change(within(panel).getByLabelText('共有ケース作成の共有開始日'), {
      target: { value: '2026-06-20' },
    });
    fireEvent.change(within(panel).getByLabelText('共有ケース作成の共有終了日'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(managementPlanSelect, {
      target: { value: 'plan_approved' },
    });
    fireEvent.click(within(panel).getByLabelText('共有範囲 添付閲覧'));
    fireEvent.click(within(panel).getByLabelText('共有範囲 PDF出力'));
    fireEvent.click(within(panel).getByRole('button', { name: '共有ケースを作成' }));

    await waitFor(() => expect(patientShareCaseMutate).toHaveBeenCalledTimes(1));
    const expectedPayload = {
      partnership_id: 'partnership_1',
      base_patient_id: 'patient_1',
      base_case_id: 'case_1',
      starts_at: '2026-06-20',
      ends_at: '2026-12-31',
      shared_management_plan_id: 'plan_approved',
      shared_management_plan_version: 3,
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: true,
        print: false,
        pdf_output: true,
        download: false,
      },
    };
    expect(patientShareCaseMutate).toHaveBeenCalledWith(expectedPayload);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/patient-share-cases', expect.any(Object)),
    );
    const postCall = fetchMock.mock.calls.find(([url]) => url === '/api/patient-share-cases');
    expect(postCall).toBeDefined();
    const init = postCall?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(JSON.parse(String(init.body))).toEqual(expectedPayload);
    expect(String(init.body)).not.toContain('cc0000000001');
    expect(String(init.body)).not.toMatch(/田中 一郎|090-0000-0000|東京都/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/activate'))).toBe(false);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['pharmacy-cooperation-share-cases', 'org_1'],
    });
    vi.unstubAllGlobals();
  });

  it('shows a retryable management plan error instead of a false empty approved-plan option', () => {
    const refetchManagementPlans = vi.fn();
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        managementPlansError: new Error('管理計画書を取得できませんでした'),
        managementPlansRefetch: refetchManagementPlans,
        patientOverrides: {
          cases: [buildActivePatientCase()],
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const panel = screen.getByTestId('patient-share-case-create-panel');
    const managementPlanSelect = within(panel).getByLabelText(
      '共有ケース作成の管理計画版',
    ) as HTMLSelectElement;
    expect(within(panel).queryByText('承認済み計画なし')).toBeNull();
    expect(managementPlanSelect.textContent).toContain('管理計画を取得できませんでした');
    expect(managementPlanSelect.disabled).toBe(true);

    const alert = within(panel).getByRole('alert');
    expect(alert.textContent).toContain('管理計画書を取得できませんでした');
    expect(alert.textContent).toContain('計画を付けずに作成できます');

    const createButton = within(panel).getByRole('button', { name: '共有ケースを作成' });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(panel).getByRole('button', { name: '再試行' }));
    expect(refetchManagementPlans).toHaveBeenCalledTimes(1);
  });

  it('omits a stale selected management plan from the share case payload after refetch errors', () => {
    const queryOptions: NonNullable<Parameters<typeof mockPatientQuery>[3]> = {
      managementPlans: {
        data: [
          {
            id: 'plan_approved',
            case_id: 'case_1',
            title: '田中 一郎 様 管理計画',
            version: 3,
            status: 'approved',
            effective_from: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-18T00:00:00.000Z',
          },
        ],
      },
      patientOverrides: {
        cases: [buildActivePatientCase()],
      },
    };
    const { patientShareCaseMutate } = mockPatientQuery(buildWorkspace(), null, {}, queryOptions);
    const { rerender } = render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const panel = screen.getByTestId('patient-share-case-create-panel');
    const managementPlanSelect = within(panel).getByLabelText(
      '共有ケース作成の管理計画版',
    ) as HTMLSelectElement;
    fireEvent.change(managementPlanSelect, { target: { value: 'plan_approved' } });
    expect(managementPlanSelect.value).toBe('plan_approved');

    queryOptions.managementPlansError = new Error('管理計画書を取得できませんでした');
    const erroredMocks = mockPatientQuery(buildWorkspace(), null, {}, queryOptions);
    rerender(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const erroredPanel = screen.getByTestId('patient-share-case-create-panel');
    const erroredManagementPlanSelect = within(erroredPanel).getByLabelText(
      '共有ケース作成の管理計画版',
    ) as HTMLSelectElement;
    expect(erroredManagementPlanSelect.disabled).toBe(true);
    expect(erroredManagementPlanSelect.textContent).toContain('管理計画を取得できませんでした');
    expect(within(erroredPanel).queryByText('計画 plan_approved / v3')).toBeNull();

    fireEvent.click(within(erroredPanel).getByRole('button', { name: '共有ケースを作成' }));

    expect(patientShareCaseMutate).not.toHaveBeenCalled();
    expect(erroredMocks.patientShareCaseMutate).toHaveBeenCalledTimes(1);
    const payload = erroredMocks.patientShareCaseMutate.mock.calls[0]?.[0];
    expect(payload).toEqual({
      partnership_id: 'partnership_1',
      base_patient_id: 'patient_1',
      base_case_id: 'case_1',
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: false,
        print: false,
        pdf_output: false,
        download: false,
      },
    });
  });

  it('keeps the true empty management plan state distinct from load errors', () => {
    mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        managementPlans: { data: [] },
        patientOverrides: {
          cases: [buildActivePatientCase()],
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const panel = screen.getByTestId('patient-share-case-create-panel');
    expect(within(panel).getByText('承認済み計画なし')).toBeTruthy();
    expect(within(panel).queryByRole('alert')).toBeNull();
    expect(within(panel).queryByRole('button', { name: '再試行' })).toBeNull();
  });

  it('blocks draft patient share case creation when the requested share window is invalid', () => {
    const { patientShareCaseMutate } = mockPatientQuery(
      buildWorkspace(),
      null,
      {},
      {
        patientOverrides: {
          cases: [
            {
              id: 'case_1',
              status: 'active',
              primary_pharmacist_id: null,
              backup_pharmacist_id: null,
              referral_source: null,
              referral_date: null,
              start_date: '2026-06-01',
              end_date: null,
              end_reason: null,
              notes: null,
              created_at: '2026-06-01T00:00:00.000Z',
              updated_at: '2026-06-01T00:00:00.000Z',
              required_visit_support: null,
              care_team_links: [],
            },
          ],
        },
      },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const panel = screen.getByTestId('patient-share-case-create-panel');
    fireEvent.change(within(panel).getByLabelText('共有ケース作成の共有開始日'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(within(panel).getByLabelText('共有ケース作成の共有終了日'), {
      target: { value: '2026-06-20' },
    });
    const button = within(panel).getByRole('button', { name: '共有ケースを作成' });

    expect(within(panel).getByText('終了日は開始日以降を指定してください。')).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(patientShareCaseMutate).not.toHaveBeenCalled();
  });

  it('keeps the server-rendered overview fresh during initial hydration', () => {
    useQueryMock.mockClear();
    mockPatientQuery(buildWorkspace());
    const initialPatient: PatientOverview = {
      id: 'patient_1',
      name: 'SSR 患者',
      name_kana: 'エスエスアール',
      birth_date: '1942-04-12',
      gender: 'male',
      updated_at: '2026-06-01T00:00:00.000Z',
      archived_at: null,
      archived_by: null,
      archived_by_name: null,
      allergy_info: [],
      residences: [],
      contacts: [],
      scheduling_preference: null,
      visit_schedules: [],
      lab_summary: [],
      foundation: {
        summary: { status: 'ready', label: '確認済み', items: [] },
        items: [],
        changes_since_last_visit: [],
        latest_labs: [],
        insurances: [],
        archive: { archived: false, archived_at: null, archived_by_name: null },
      },
      cases: [],
      conditions: [],
      phone: null,
      medical_insurance_number: null,
      care_insurance_number: null,
      billing_support_flag: false,
      primary_pharmacist_id: null,
      backup_pharmacist_id: null,
      primary_staff_id: null,
      backup_staff_id: null,
      notes: null,
      summary_metrics: { open_tasks_count: 0 },
      risk_summary: null,
      visit_brief: buildVisitBrief({ patient: { id: 'patient_1', name: 'SSR 患者' } }),
      jahis_supplemental_records: [],
      workspace: buildWorkspace(),
      privacy: {
        sensitive_fields_masked: false,
        address_fields_masked: false,
        can_view_detail: true,
      },
    };

    render(<CardWorkspace patientId="patient_1" initialPatient={initialPatient} />);

    const overviewQueryOptions = useQueryMock.mock.calls.find(
      ([options]) => options.queryKey?.[0] === 'patient-overview',
    )?.[0];
    expect(overviewQueryOptions).toMatchObject({
      queryKey: ['patient-overview', 'patient_1', 'org_1'],
      initialData: initialPatient,
      staleTime: 30_000,
      enabled: true,
    });
    expect(typeof overviewQueryOptions.initialDataUpdatedAt).toBe('number');
  });

  it('creates a deduplicated foundation review task from a non-ready foundation item', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'task_1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    openFoundationTab();
    const foundationPanel = screen.getByTestId('patient-foundation-panel');
    fireEvent.click(within(foundationPanel).getAllByRole('button', { name: 'タスク化' })[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.any(Object)));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(body).toMatchObject({
      task_type: 'patient_foundation_review',
      title: '正本確認: 保険・公費',
      description: '1件 / 1件確認',
      priority: 'normal',
      dedupe_key: 'patient-foundation-review:patient_1:insurance',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      metadata: {
        source: 'patient_foundation',
        patient_id: 'patient_1',
        item_key: 'insurance',
        item_label: '保険・公費',
        foundation_status: 'needs_confirmation',
        action_href: '/patients/patient_1/edit?section=contact#medical_insurance_number',
        action_label: '保険を確認',
      },
    });

    vi.unstubAllGlobals();
  });

  it('starts the fax original collection mutation from the home operations panel', () => {
    const { faxMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '原本未着',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['FAX先行受付の原本到着が未記録です'],
          quick_actions: [
            {
              key: 'mark_fax_original_collected',
              label: '原本到着を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openMedicationTab();
    fireEvent.click(screen.getByRole('button', { name: /原本到着を記録/ }));

    expect(faxMutate).toHaveBeenCalledWith('intake_0500');
  });

  it('keeps server messages and falls back for prescription home-operation mutation error toasts', () => {
    mockPatientQuery(buildWorkspace());
    const baseMutation = useMutationMock.getMockImplementation();
    const mutationConfigs: Array<{ onError?: (error: Error) => void }> = [];
    useMutationMock.mockImplementation((config: { onError?: (error: Error) => void }) => {
      mutationConfigs.push(config);
      return baseMutation?.(config);
    });

    render(<CardWorkspace patientId="patient_1" />);

    const findMutationByFallback = (fallback: string) => {
      const config = mutationConfigs.find((candidate) =>
        String(candidate.onError).includes(fallback),
      );
      expect(config).toBeTruthy();
      return config;
    };

    const cases = [
      {
        config: findMutationByFallback('FAX原本到着の記録に失敗しました'),
        serverMessage: 'FAX原本APIからの詳細エラー',
        fallback: 'FAX原本到着の記録に失敗しました',
      },
      {
        config: findMutationByFallback('処方せん画像/PDFの保存に失敗しました'),
        serverMessage: '処方せん画像APIからの詳細エラー',
        fallback: '処方せん画像/PDFの保存に失敗しました',
      },
      {
        config: findMutationByFallback('処方せん原本管理の保存に失敗しました'),
        serverMessage: '処方せん原本管理APIからの詳細エラー',
        fallback: '処方せん原本管理の保存に失敗しました',
      },
    ];

    for (const { config, serverMessage, fallback } of cases) {
      config?.onError?.(new Error(serverMessage));
      expect(toast.error).toHaveBeenLastCalledWith(serverMessage);
      config?.onError?.(new Error(''));
      expect(toast.error).toHaveBeenLastCalledWith(fallback);
    }
  });

  it('records an MCS check log from the home operations panel', () => {
    const { mcsCheckLogMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 0,
      top_alerts: [],
      items: [
        {
          key: 'mcs',
          label: 'MCS・外部連携',
          status: '連携あり',
          description: '田中一郎 在宅チーム / 最終確認 2026/06/01',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を管理',
          tone: 'ok',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [
            { label: '最終確認', value: '2026/06/01' },
            { label: '参加状況', value: '参加済' },
          ],
          alerts: [],
          quick_actions: [
            {
              key: 'record_mcs_check_log',
              label: 'MCS確認ログを記録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    fireEvent.click(screen.getByRole('button', { name: /MCS確認ログを記録/ }));
    expect(screen.getByText('MCS確認内容を入力してください。')).toBeTruthy();
    expect(mcsCheckLogMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('区分'), {
      target: { value: 'instruction_check' },
    });
    fireEvent.change(screen.getByLabelText('MCS確認内容'), {
      target: { value: '訪看からの食欲低下共有を確認' },
    });
    fireEvent.change(screen.getByLabelText('次アクション'), {
      target: { value: '医師へ服薬状況を確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: /MCS確認ログを記録/ }));

    expect(mcsCheckLogMutate).toHaveBeenCalledWith({
      patientId: 'patient_1',
      contentType: 'instruction_check',
      summary: '訪看からの食欲低下共有を確認',
      nextAction: '医師へ服薬状況を確認',
    });
  });

  it('shows an accessible 44px pending state for quick-form save actions', () => {
    mockPatientQuery(
      buildWorkspace(),
      {
        generated_at: '2026-06-16T00:00:00.000Z',
        attention_count: 0,
        top_alerts: [],
        items: [
          {
            key: 'mcs',
            label: 'MCS・外部連携',
            status: '連携あり',
            description: '田中一郎 在宅チーム / 最終確認 2026/06/01',
            href: '/patients/patient_1/mcs',
            action_label: 'MCS連携を管理',
            tone: 'ok',
            updated_at: '2026-06-01T00:00:00.000Z',
            metrics: [{ label: '最終確認', value: '2026/06/01' }],
            alerts: [],
            quick_actions: [
              {
                key: 'record_mcs_check_log',
                label: 'MCS確認ログを記録',
                resource_id: 'patient_1',
              },
            ],
          },
        ],
      },
      { mcsCheckLog: true },
    );

    render(<CardWorkspace patientId="patient_1" />);

    openSharingTab();
    const savingButton = screen.getByRole('button', { name: '保存中' });
    expect(savingButton.getAttribute('aria-busy')).toBe('true');
    expect((savingButton as HTMLButtonElement).disabled).toBe(true);
    expect(savingButton.className).toContain('min-h-11');
    expect(screen.getByRole('status', { name: 'MCS確認ログを保存中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中' })).toBeNull();
  });

  it('saves a prescription image or PDF URL from the home operations panel', () => {
    const { prescriptionDocumentMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['処方せん画像/PDFが未保存です'],
          quick_actions: [
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openMedicationTab();
    fireEvent.change(screen.getByLabelText('画像/PDF URL'), {
      target: { value: 'https://example.com/prescriptions/intake_0500.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: /画像\/PDFを保存/ }));

    expect(prescriptionDocumentMutate).toHaveBeenCalledWith({
      intakeId: 'intake_0500',
      documentUrl: 'https://example.com/prescriptions/intake_0500.pdf',
    });
  });

  it('uploads a prescription image or PDF before saving its download URL', async () => {
    const { prescriptionDocumentMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['処方せん画像/PDFが未保存です'],
          quick_actions: [
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: '11111111-1111-4111-8111-111111111111',
            uploadUrl: 'https://uploads.example.com/prescription.pdf',
            headers: { 'x-amz-server-side-encryption': 'AES256' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ etag: 'etag-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: '11111111-1111-4111-8111-111111111111',
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardWorkspace patientId="patient_1" />);

    openMedicationTab();
    const file = new File(['pdf'], 'prescription.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('ファイル'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /画像\/PDFを保存/ }));

    await waitFor(() => {
      expect(prescriptionDocumentMutate).toHaveBeenCalledWith({
        intakeId: 'intake_0500',
        documentUrl:
          'http://localhost:3000/api/files/11111111-1111-4111-8111-111111111111/download',
      });
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/files/presigned-upload',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"patient_id":"patient_1"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://uploads.example.com/prescription.pdf',
      expect.objectContaining({
        method: 'PUT',
        body: file,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/files/complete',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"etag":"etag-1"'),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('records prescription original reconciliation and storage from the home operations panel', () => {
    const { prescriptionOriginalManagementMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [
            { label: '照合', value: '未照合' },
            { label: '保管', value: '未保管' },
          ],
          alerts: ['原本到着後の照合結果が未記録です'],
          quick_actions: [
            {
              key: 'record_prescription_original_management',
              label: '原本管理を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openMedicationTab();
    expect(screen.getByText('保存される原本管理')).toBeTruthy();
    expect(screen.getByLabelText('原本到着日時')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('照合結果'), { target: { value: 'discrepancy' } });
    fireEvent.change(screen.getByLabelText('差異内容'), {
      target: { value: 'FAX記載の日数と原本の日数が異なる' },
    });
    fireEvent.change(screen.getByLabelText('保管場所'), { target: { value: 'headquarters' } });
    fireEvent.change(screen.getByLabelText('電子処方せん'), { target: { value: 'acquired' } });
    fireEvent.change(screen.getByLabelText('結果登録'), { target: { value: 'registered' } });
    fireEvent.change(screen.getByLabelText('引換番号'), { target: { value: 'EP-12345' } });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '医師確認済み' },
    });
    expect(screen.getByText('取得済み / EP-12345')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));

    expect(prescriptionOriginalManagementMutate).toHaveBeenCalledWith({
      intakeId: 'intake_0500',
      originalCollectedAt: expect.any(String),
      reconciliationResult: 'discrepancy',
      discrepancyNote: 'FAX記載の日数と原本の日数が異なる',
      storageLocation: 'headquarters',
      ePrescriptionExchangeNumber: 'EP-12345',
      ePrescriptionAcquiredStatus: 'acquired',
      dispensingResultRegistration: 'registered',
      note: '医師確認済み',
    });
  });

  it('blocks incomplete prescription original management before mutation', async () => {
    const { prescriptionOriginalManagementMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [
            { label: '照合', value: '未照合' },
            { label: '保管', value: '未保管' },
          ],
          alerts: ['原本到着後の照合結果が未記録です'],
          quick_actions: [
            {
              key: 'record_prescription_original_management',
              label: '原本管理を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openMedicationTab();
    fireEvent.change(screen.getByLabelText('照合結果'), { target: { value: 'discrepancy' } });
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '差異ありの場合は差異内容を入力してください。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('差異内容'), {
      target: { value: 'FAX記載の日数と原本の日数が異なる' },
    });
    fireEvent.change(screen.getByLabelText('電子処方せん'), { target: { value: 'pending' } });
    expect(screen.getByText('取得待ち / 引換番号未入力')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '電子処方せん対象では引換番号を入力してください。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('引換番号'), { target: { value: 'EP-12345' } });
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '電子処方せん取得待ちでは調剤結果登録済みにできません。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('電子処方せん'), {
      target: { value: 'not_applicable' },
    });
    fireEvent.change(screen.getByLabelText('保管場所'), { target: { value: 'not_stored' } });
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '照合済みまたは調剤結果登録済みでは保管場所を記録してください。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();
  });

  it('records billing collection metadata from the home operations panel', () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: '未発行/未記録' },
            { label: '次回集金予定', value: '未設定' },
            {
              label: '領収証控えURL',
              value: '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
            },
            {
              label: '請求書控えURL',
              value: '/api/billing-candidates/candidate_1/documents/pdf?kind=invoice',
            },
          ],
          alerts: ['集金ステータスが未記録です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を登録',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.change(screen.getByLabelText('領収証番号'), {
      target: { value: 'R20260616-001' },
    });
    fireEvent.change(screen.getByLabelText('次回集金予定'), {
      target: { value: '2026-06-25T10:30' },
    });
    fireEvent.change(screen.getByLabelText('請求書状態'), {
      target: { value: 'issued' },
    });
    fireEvent.click(screen.getByLabelText('領収証控えを保存する'));
    expect((screen.getByLabelText('請求書控えを保存する') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('領収証 発行済み / 請求書 発行済み')).toBeTruthy();
    expect(screen.getByText('領収証 保存する / 請求書 保存する')).toBeTruthy();
    expect(screen.getByRole('link', { name: '領収証PDF' }).getAttribute('href')).toBe(
      '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
    );
    expect(screen.getByRole('link', { name: '請求書PDF' }).getAttribute('href')).toBe(
      '/api/billing-candidates/candidate_1/documents/pdf?kind=invoice',
    );
    fireEvent.click(screen.getByRole('button', { name: /集金記録を登録/ }));

    expect(billingMutate).toHaveBeenCalledWith({
      candidateId: 'candidate_1',
      expectedUpdatedAt: '2026-06-10T00:00:00.000Z',
      idempotencyKey: expect.stringMatching(/^billing-collection:/),
      status: 'collected',
      billedAmount: 3240,
      collectedAmount: 3240,
      payerName: '長女',
      paymentMethod: 'cash',
      scheduledCollectionAt: new Date('2026-06-25T10:30').toISOString(),
      receiptNumber: 'R20260616-001',
      receiptIssueStatus: 'issued',
      invoiceIssueStatus: 'issued',
      saveReceiptCopy: true,
      saveInvoiceCopy: true,
    });
  });

  it('blocks inconsistent billing collection metadata before mutation', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: '未発行/未記録' },
            { label: '次回集金予定', value: '未設定' },
          ],
          alerts: ['集金ステータスが未記録です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を登録',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'partial' } });
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を登録/ }));

    expect(
      await screen.findByText('一部入金では請求額未満の入金額を入力してください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('requires a receipt number before saving collected billing when receipt issuance is enabled', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: '未発行/未記録' },
            { label: '領収証発行コード', value: 'paper' },
            { label: '次回集金予定', value: '未設定' },
          ],
          alerts: ['領収証番号が未記録です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    expect(screen.getByText('保存される集金履歴')).toBeTruthy();
    expect(screen.getByText('番号未入力')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を更新/ }));

    expect(
      await screen.findByText('領収証発行が必要な集金では領収証番号を入力してください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('requires issued receipt status before saving receipt-managed collection', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: 'R20260616-001' },
            { label: '領収証発行コード', value: 'paper' },
            { label: '領収証状態コード', value: 'not_issued' },
          ],
          alerts: ['領収証が未発行です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を更新/ }));

    expect(
      await screen.findByText('領収証発行が必要な集金では発行状態を発行済みにしてください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('requires issued invoice status before saving invoice-managed billing collection', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: 'R20260616-001' },
            { label: '領収証発行コード', value: 'none' },
            { label: '請求書発行コード', value: 'yes' },
            { label: '請求書状態コード', value: 'not_issued' },
          ],
          alerts: ['請求書が未発行です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'billed' } });
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を更新/ }));

    expect(
      await screen.findByText('請求書発行が必要な請求・集金では発行状態を発行済みにしてください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('records patient billing payment profile metadata from the home operations panel', () => {
    const { billingProfileMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '未設定',
          description: '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '算定候補', value: '0件' },
            { label: '支払設定', value: '未設定' },
            { label: '支払者', value: '未記録' },
          ],
          alerts: ['患者ごとの支払者・支払方法が未設定です'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を登録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('支払者'), {
      target: { value: 'family' },
    });
    fireEvent.change(screen.getByLabelText('支払方法'), {
      target: { value: 'bank_transfer' },
    });
    fireEvent.change(screen.getByLabelText('支払者氏名'), {
      target: { value: '山田 花子' },
    });
    fireEvent.change(screen.getByLabelText('続柄'), {
      target: { value: '長女' },
    });
    fireEvent.change(screen.getByLabelText('集金タイミング'), {
      target: { value: 'month_end' },
    });
    fireEvent.change(screen.getByLabelText('未収許容'), {
      target: { value: 'one_month' },
    });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '月末に長女へ請求' },
    });
    fireEvent.click(screen.getByRole('button', { name: /支払設定を登録/ }));

    expect(billingProfileMutate).toHaveBeenCalledWith({
      patientId: 'patient_1',
      payerType: 'family',
      payerName: '山田 花子',
      payerRelation: '長女',
      billingAddressMode: 'same_as_patient',
      billingAddress: null,
      paymentMethod: 'bank_transfer',
      collectionTiming: 'month_end',
      receiptIssue: 'paper',
      invoiceIssue: 'yes',
      unpaidTolerance: 'one_month',
      note: '月末に長女へ請求',
    });
  });

  it('keeps server messages and falls back for billing home-operation mutation error toasts', () => {
    mockPatientQuery(buildWorkspace());
    const baseMutation = useMutationMock.getMockImplementation();
    const mutationConfigs: Array<{ onError?: (error: Error) => void }> = [];
    useMutationMock.mockImplementation((config: { onError?: (error: Error) => void }) => {
      mutationConfigs.push(config);
      return baseMutation?.(config);
    });

    render(<CardWorkspace patientId="patient_1" />);

    const findMutationByFallback = (fallback: string) => {
      const config = mutationConfigs.find((candidate) =>
        String(candidate.onError).includes(fallback),
      );
      expect(config).toBeTruthy();
      return config;
    };

    const cases = [
      {
        config: findMutationByFallback('集金記録の保存に失敗しました'),
        serverMessage: '集金記録APIからの詳細エラー',
        fallback: '集金記録の保存に失敗しました',
      },
      {
        config: findMutationByFallback('支払設定の保存に失敗しました'),
        serverMessage: '支払設定APIからの詳細エラー',
        fallback: '支払設定の保存に失敗しました',
      },
    ];

    for (const { config, serverMessage, fallback } of cases) {
      config?.onError?.(new Error(serverMessage));
      expect(toast.error).toHaveBeenLastCalledWith(serverMessage);
      config?.onError?.(new Error(''));
      expect(toast.error).toHaveBeenLastCalledWith(fallback);
    }
  });

  it('requires payer details before saving a non-self billing payment profile', async () => {
    const { billingProfileMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '未設定',
          description: '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '算定候補', value: '0件' },
            { label: '支払設定', value: '未設定' },
            { label: '支払者', value: '未記録' },
          ],
          alerts: ['患者ごとの支払者・支払方法が未設定です'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を登録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('支払者'), {
      target: { value: 'family' },
    });
    fireEvent.click(screen.getByRole('button', { name: /支払設定を登録/ }));

    expect(
      await screen.findByText('本人以外の支払者では支払者氏名を入力してください。'),
    ).toBeTruthy();
    expect(billingProfileMutate).not.toHaveBeenCalled();
  });

  it('records a different billing address from the billing payment profile quick form', () => {
    const { billingProfileMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '未設定',
          description: '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '算定候補', value: '0件' },
            { label: '支払設定', value: '未設定' },
            { label: '支払者', value: '未記録' },
          ],
          alerts: ['患者ごとの支払者・支払方法が未設定です'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を登録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.change(screen.getByLabelText('支払者'), {
      target: { value: 'family' },
    });
    fireEvent.change(screen.getByLabelText('支払者氏名'), {
      target: { value: '山田 花子' },
    });
    fireEvent.change(screen.getByLabelText('続柄'), {
      target: { value: '長女' },
    });
    fireEvent.change(screen.getByLabelText('請求先住所区分'), {
      target: { value: 'different' },
    });
    fireEvent.change(screen.getByLabelText('請求先住所'), {
      target: { value: '東京都千代田区1-1-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /支払設定を登録/ }));

    expect(billingProfileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAddressMode: 'different',
        billingAddress: '東京都千代田区1-1-1',
      }),
    );
  });

  it('records a patient-scoped conference note from the home operations panel', () => {
    const { conferenceMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'conference',
          label: 'カンファレンス',
          status: '未登録',
          description:
            '退院前カンファ、担当者会議、デスカンファの予定・議事録・報告書を管理します。',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議を登録',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '報告書', value: '未作成' },
            { label: 'タスク', value: '0件' },
          ],
          alerts: ['カンファレンス予定・記録が未登録です'],
          quick_actions: [
            {
              key: 'record_conference_note',
              label: '会議要点を登録',
              resource_id: 'case_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    expect(screen.getByText('保存される会議連動')).toBeTruthy();
    expect(screen.getByText('対面 / CM')).toBeTruthy();
    expect(screen.getByText('ケアマネ向け報告書')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('会議要点'), {
      target: { value: '退院後の服薬支援と残薬確認を合意した' },
    });
    fireEvent.change(screen.getByLabelText('開催形式'), {
      target: { value: 'mcs' },
    });
    fireEvent.change(screen.getByLabelText('主催者'), {
      target: { value: 'visiting_nurse' },
    });
    fireEvent.change(screen.getByLabelText('報告書用途'), {
      target: { value: 'nurse_share' },
    });
    fireEvent.change(screen.getByLabelText('開催場所'), {
      target: { value: 'MCS 山田太郎さん在宅チーム' },
    });
    fireEvent.change(screen.getByLabelText('議題'), {
      target: { value: '退院後支援と訪問頻度調整' },
    });
    fireEvent.change(screen.getByLabelText('参加者'), {
      target: { value: '佐藤CM / ケアマネ / あおぞら居宅\n高橋看護師 / 訪看 / みどり訪看' },
    });
    fireEvent.change(screen.getByLabelText('薬局参加者'), {
      target: { value: '鈴木薬剤師\n田中事務' },
    });
    fireEvent.change(screen.getByLabelText('訪問頻度変更'), {
      target: { value: '月2回' },
    });
    fireEvent.change(screen.getByLabelText('フォロー期限'), {
      target: { value: '2026-06-17T10:30' },
    });
    fireEvent.click(screen.getByLabelText('フォロー完了'));
    fireEvent.change(screen.getByLabelText('薬局タスク'), {
      target: { value: '報告書作成 / 薬剤師' },
    });
    expect(screen.getByText('タスク 1件')).toBeTruthy();
    expect(screen.getByText('外部 2名 / 薬局 2名')).toBeTruthy();
    expect(screen.getByText('2026-06-17 10:30 / 完了')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));

    expect(conferenceMutate).toHaveBeenCalledWith({
      patientId: 'patient_1',
      caseId: 'case_1',
      noteType: 'service_manager',
      title: '田中 一郎様 サービス担当者会議',
      conferenceDate: expect.any(String),
      conferenceFormat: 'mcs',
      location: 'MCS 山田太郎さん在宅チーム',
      organizer: 'visiting_nurse',
      reportType: 'nurse_share',
      followUpDate: '2026-06-17T10:30',
      followUpCompleted: true,
      agenda: '退院後支援と訪問頻度調整',
      content: '退院後の服薬支援と残薬確認を合意した',
      participantsRaw: '佐藤CM / ケアマネ / あおぞら居宅\n高橋看護師 / 訪看 / みどり訪看',
      pharmacyParticipantsRaw: '鈴木薬剤師\n田中事務',
      visitScheduleChange: '月2回',
      targetDischargeDate: '',
      actionItemsRaw: '報告書作成 / 薬剤師',
    });
  });

  it('keeps server messages and falls back for communication home-operation mutation error toasts', () => {
    mockPatientQuery(buildWorkspace());
    const baseMutation = useMutationMock.getMockImplementation();
    const mutationConfigs: Array<{ onError?: (error: Error) => void }> = [];
    useMutationMock.mockImplementation((config: { onError?: (error: Error) => void }) => {
      mutationConfigs.push(config);
      return baseMutation?.(config);
    });

    render(<CardWorkspace patientId="patient_1" />);

    const findMutationByFallback = (fallback: string) => {
      const config = mutationConfigs.find((candidate) =>
        String(candidate.onError).includes(fallback),
      );
      expect(config).toBeTruthy();
      return config;
    };

    const cases = [
      {
        config: findMutationByFallback('会議要点の保存に失敗しました'),
        serverMessage: '会議要点APIからの詳細エラー',
        fallback: '会議要点の保存に失敗しました',
      },
      {
        config: findMutationByFallback('MCS確認ログの保存に失敗しました'),
        serverMessage: 'MCS確認ログAPIからの詳細エラー',
        fallback: 'MCS確認ログの保存に失敗しました',
      },
    ];

    for (const { config, serverMessage, fallback } of cases) {
      config?.onError?.(new Error(serverMessage));
      expect(toast.error).toHaveBeenLastCalledWith(serverMessage);
      config?.onError?.(new Error(''));
      expect(toast.error).toHaveBeenLastCalledWith(fallback);
    }
  });

  it('blocks incomplete conference quick-note submissions before mutation', () => {
    const { conferenceMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'conference',
          label: 'カンファレンス',
          status: '未登録',
          description:
            '退院前カンファ、担当者会議、デスカンファの予定・議事録・報告書を管理します。',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議を登録',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '報告書', value: '未作成' },
            { label: 'タスク', value: '0件' },
          ],
          alerts: ['カンファレンス予定・記録が未登録です'],
          quick_actions: [
            {
              key: 'record_conference_note',
              label: '会議要点を登録',
              resource_id: 'case_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    openBillingTab();
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '会議名・開催日時・会議要点を入力してください。',
    );
    expect(conferenceMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('会議要点'), {
      target: { value: '退院後の服薬支援と残薬確認を合意した' },
    });
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '会議後の薬局タスクを1件以上入力してください。',
    );
    expect(conferenceMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('薬局タスク'), {
      target: { value: '報告書作成 / 薬剤師' },
    });
    fireEvent.change(screen.getByLabelText('会議種別'), {
      target: { value: 'pre_discharge' },
    });
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '退院前カンファレンスでは退院予定日を入力してください。',
    );
    expect(conferenceMutate).not.toHaveBeenCalled();
  });

  it('maps conference quick-form fields to structured sync sections', () => {
    expect(
      buildConferenceStructuredContent({
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'service_manager',
        title: 'サービス担当者会議',
        conferenceDate: '2026-06-16T09:00',
        conferenceFormat: 'in_person',
        location: '地域包括会議室',
        organizer: 'care_manager',
        reportType: 'care_manager_report',
        followUpDate: '',
        followUpCompleted: false,
        agenda: '訪問頻度と服薬支援方針',
        content: 'ケアプラン変更と服薬支援方針を確認した',
        participantsRaw: '',
        pharmacyParticipantsRaw: '',
        visitScheduleChange: '月2回',
        targetDischargeDate: '',
        actionItemsRaw: '報告書作成 / 薬剤師\n次回訪問日を連絡 / 事務',
      }),
    ).toEqual({
      template: 'service_manager',
      sections: [
        {
          key: 'meeting_purpose',
          label: '会議目的',
          body: 'ケアプラン変更と服薬支援方針を確認した',
        },
        { key: 'agenda', label: '議題', body: '訪問頻度と服薬支援方針' },
        { key: 'location', label: '開催場所', body: '地域包括会議室' },
        {
          key: 'service_adjustments',
          label: 'サービス調整',
          body: '訪問頻度を月2回へ変更',
        },
      ],
    });

    expect(
      buildConferenceStructuredContent({
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'pre_discharge',
        title: '退院前カンファ',
        conferenceDate: '2026-06-16T09:00',
        conferenceFormat: 'in_person',
        location: '',
        organizer: 'hospital',
        reportType: 'physician_report',
        followUpDate: '',
        followUpCompleted: false,
        agenda: '',
        content: '退院後の服薬支援を確認した',
        participantsRaw: '',
        pharmacyParticipantsRaw: '',
        visitScheduleChange: '月1回',
        targetDischargeDate: '2026-06-20',
        actionItemsRaw: '',
      }),
    ).toEqual({
      template: 'pre_discharge',
      sections: [
        { key: 'discharge_background', label: '退院背景', body: '退院後の服薬支援を確認した' },
        { key: 'target_discharge_date', label: '退院予定日', body: '2026-06-20' },
        {
          key: 'next_visit_plan',
          label: '初回訪問計画',
          body: '退院後の初回訪問を月1回で調整',
        },
      ],
    });

    expect(
      buildConferenceStructuredContent({
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'pre_discharge',
        title: '退院前カンファ',
        conferenceDate: '2026-06-16T09:00',
        conferenceFormat: 'in_person',
        location: '',
        organizer: 'hospital',
        reportType: 'physician_report',
        followUpDate: '',
        followUpCompleted: false,
        agenda: '',
        content: '退院後の服薬支援を確認した',
        participantsRaw: '',
        pharmacyParticipantsRaw: '',
        visitScheduleChange: '月1回',
        targetDischargeDate: '',
        actionItemsRaw: '',
      }),
    ).toEqual({
      template: 'pre_discharge',
      sections: [
        { key: 'discharge_background', label: '退院背景', body: '退院後の服薬支援を確認した' },
      ],
    });
  });

  it('parses conference participant lines into attended participant payloads', () => {
    expect(
      parseConferenceParticipants('佐藤CM / ケアマネ / あおぞら居宅\n鈴木薬剤師 / 薬剤師'),
    ).toEqual([
      {
        name: '佐藤CM',
        role: 'ケアマネ',
        organization_name: 'あおぞら居宅',
        attended: true,
      },
      {
        name: '鈴木薬剤師',
        role: '薬剤師',
        attended: true,
      },
    ]);
  });

  // F-081 (card-workspace sub-slice 1/5): PatientCardDocumentsPanel documents GET URL/header hardening.
  function captureDocumentsQueryConfig(hostilePatientId: string) {
    // mockPatientQuery sets up every CardWorkspace query/mutation; we then wrap useQuery to also
    // record the patient-documents config (incl queryFn) without weakening the baseline behavior.
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { id: hostilePatientId } });
    const baseImpl = useQueryMock.getMockImplementation();
    let documentsConfig: { queryKey: unknown[]; queryFn?: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        if (config?.queryKey?.[0] === 'patient-documents') {
          documentsConfig = config;
        }
        return baseImpl?.(config);
      },
    );
    return () => documentsConfig;
  }

  it('fetches patient documents from an encoded patient path with org headers (raw query key)', async () => {
    const hostileId = 'pt/1?x=y#z';
    const getDocumentsConfig = captureDocumentsQueryConfig(hostileId);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId={hostileId} />);
      openSharingTab();

      const config = getDocumentsConfig();
      expect(config?.queryKey).toEqual(['patient-documents', hostileId, 'org_1']);
      await config?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/documents`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patient id %p on the documents GET',
    async (dotId) => {
      const getDocumentsConfig = captureDocumentsQueryConfig(dotId);
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        expect(() => render(<CardWorkspace patientId={dotId} />)).toThrow(RangeError);
        expect(getDocumentsConfig()).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  // F-082 (card-workspace sub-slice 2/5): CardWorkspace overview + home-operations + header-summary GET URL/header hardening.
  function captureWorkspaceQueryConfig(scope: string, patientId: string) {
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { id: patientId } });
    const baseImpl = useQueryMock.getMockImplementation();
    let scopedConfig: { queryKey: unknown[]; queryFn?: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        if (config?.queryKey?.[0] === scope) {
          scopedConfig = config;
        }
        return baseImpl?.(config);
      },
    );
    return () => scopedConfig;
  }

  it.each([
    ['patient-overview', 'overview'],
    ['patient-home-operations', 'home-operations'],
    ['patient-header-summary', 'header-summary'],
  ])('fetches %s from an encoded patient path with org headers', async (scope, segment) => {
    const hostileId = 'pt/1?x=y#z';
    const getConfig = captureWorkspaceQueryConfig(scope, hostileId);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId={hostileId} />);

      const config = getConfig();
      expect(config?.queryKey).toEqual([scope, hostileId, 'org_1']);
      await config?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(hostileId, `/${segment}`);
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/${segment}`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('fetches the patient movement timeline from an encoded patient path with a bounded initial limit and org headers', async () => {
    const hostileId = 'pt/1?x=y#z';
    const getConfig = captureWorkspaceQueryConfig('patient-movement-timeline', hostileId);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ movement_events: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId={hostileId} />);

      const config = getConfig();
      expect(config?.queryKey).toEqual(['patient-movement-timeline', hostileId, 'org_1', 5]);
      await config?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(hostileId, '/movement-timeline');
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/movement-timeline?limit=5`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each([
    ['patient-overview', '.'],
    ['patient-overview', '..'],
    ['patient-home-operations', '.'],
    ['patient-home-operations', '..'],
    ['patient-header-summary', '.'],
    ['patient-header-summary', '..'],
  ])(
    'fails closed without fetching for %s with exact dot-segment patient id %p',
    async (scope, dotId) => {
      const getConfig = captureWorkspaceQueryConfig(scope, dotId);
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        expect(() => render(<CardWorkspace patientId={dotId} />)).toThrow(RangeError);
        expect(getConfig()?.queryKey).toEqual([scope, dotId, 'org_1']);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it('routes workspace patient GETs through the shared patient API path helper return values', async () => {
    const patientId = 'patient_1';
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { id: patientId } });
    const baseImpl = useQueryMock.getMockImplementation();
    const scopedConfigs = new Map<
      string,
      { queryKey: unknown[]; queryFn?: () => Promise<unknown> }
    >();
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        if (
          config?.queryKey?.[0] === 'patient-overview' ||
          config?.queryKey?.[0] === 'patient-home-operations' ||
          config?.queryKey?.[0] === 'patient-header-summary'
        ) {
          scopedConfigs.set(String(config.queryKey[0]), config);
        }
        return baseImpl?.(config);
      },
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath)
      .mockReturnValueOnce('/api/patients/__helper_patient__/overview')
      .mockReturnValueOnce('/api/patients/__helper_patient__/home-operations')
      .mockReturnValueOnce('/api/patients/__helper_patient__/header-summary');

    try {
      render(<CardWorkspace patientId={patientId} />);

      await scopedConfigs.get('patient-overview')?.queryFn?.();
      await scopedConfigs.get('patient-home-operations')?.queryFn?.();
      await scopedConfigs.get('patient-header-summary')?.queryFn?.();

      expect(buildPatientApiPath).toHaveBeenNthCalledWith(1, patientId, '/overview');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(2, patientId, '/home-operations');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(3, patientId, '/header-summary');
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        '/api/patients/__helper_patient__/overview',
        '/api/patients/__helper_patient__/home-operations',
        '/api/patients/__helper_patient__/header-summary',
      ]);
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/overview`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  // F-083 (card-workspace sub-slice 3/5): billing-profile PATCH + mcs/logs POST URL/header hardening.
  // The two target mutationFns are not individually named in the mock, so we capture every useMutation config and
  // locate them by the request each emits. A merged representative input drives BOTH (each reads its own fields).
  function captureAllMutationConfigs(patientId: string) {
    mockPatientQuery(buildWorkspace(), null, {}, { patientOverrides: { id: patientId } });
    const baseImpl = useMutationMock.getMockImplementation();
    const mutationConfigs: Array<{ mutationFn?: (input: unknown) => Promise<unknown> }> = [];
    useMutationMock.mockImplementation(
      (config: { mutationFn?: (input: unknown) => Promise<unknown> }) => {
        mutationConfigs.push(config);
        return baseImpl?.(config);
      },
    );
    return mutationConfigs;
  }

  const F083_INPUT = {
    patientId: 'PLACEHOLDER',
    // billing fields
    payerType: 'self',
    payerName: '山田太郎',
    payerRelation: 'self',
    billingAddressMode: 'same_as_residence',
    billingAddress: '東京都千代田区1-1-1',
    paymentMethod: 'bank_transfer',
    collectionTiming: 'month_end',
    receiptIssue: 'issue',
    invoiceIssue: 'issue',
    unpaidTolerance: 'normal',
    note: '請求メモ',
    // mcs fields
    contentType: 'medication_adherence',
    summary: '服薬確認OK',
    nextAction: '次回訪問で再確認',
  };

  // Execute each captured mutationFn one at a time so we can attribute each emitted request to a config index.
  async function probeMutationUrls(
    mutationConfigs: Array<{ mutationFn?: (input: unknown) => Promise<unknown> }>,
    fetchMock: ReturnType<typeof vi.fn>,
    input: unknown,
  ) {
    const urlByIndex: Array<string | undefined> = [];
    for (let i = 0; i < mutationConfigs.length; i += 1) {
      fetchMock.mockClear();
      try {
        await mutationConfigs[i].mutationFn?.(input);
      } catch {
        // unrelated input contracts throw before fetch; ignored.
      }
      urlByIndex[i] = fetchMock.mock.calls[0] ? String(fetchMock.mock.calls[0][0]) : undefined;
    }
    return urlByIndex;
  }

  it('encodes billing-profile and mcs-logs paths, sends helper-built JSON headers, and preserves exact raw bodies', async () => {
    const hostileId = 'pt/1?x=y#z';
    const enc = encodeURIComponent(hostileId);
    // sentinel that a manual { 'Content-Type', 'x-org-id' } literal can NEVER produce -> proves helper adoption.
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelHeaders);

    const mutationConfigs = captureAllMutationConfigs(hostileId);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId={hostileId} />);

      const input = { ...F083_INPUT, patientId: hostileId };
      const urlByIndex = await probeMutationUrls(mutationConfigs, fetchMock, input);
      const billingIndex = urlByIndex.findIndex((u) => u?.includes('/billing-profile'));
      const mcsIndex = urlByIndex.findIndex((u) => u?.includes('/mcs/logs'));
      expect(billingIndex).toBeGreaterThanOrEqual(0);
      expect(mcsIndex).toBeGreaterThanOrEqual(0);

      // Re-run the two target mutations cleanly so we can inspect their exact request.
      fetchMock.mockClear();
      await mutationConfigs[billingIndex].mutationFn?.(input);
      const [billingUrl, billingInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      fetchMock.mockClear();
      await mutationConfigs[mcsIndex].mutationFn?.(input);
      const [mcsUrl, mcsInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      // encoded URLs, helper-built headers (identity proves the helper, not an equal-shaped literal).
      expect(billingUrl).toBe(`/api/patients/${enc}/billing-profile`);
      expect(billingInit.method).toBe('PATCH');
      expect(billingInit.headers).toBe(sentinelHeaders);
      expect(mcsUrl).toBe(`/api/patients/${enc}/mcs/logs`);
      expect(mcsInit.method).toBe('POST');
      expect(mcsInit.headers).toBe(sentinelHeaders);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      for (const url of [billingUrl, mcsUrl]) {
        expect(url).not.toContain('?x=y');
        expect(url).not.toContain('#z');
        expect(url).not.toContain('%25');
        expect(url).not.toContain(`/${hostileId}/`);
      }

      // exact billing body (all fields preserved; patient id NOT serialized).
      const billingBody = JSON.parse(billingInit.body as string);
      expect(billingBody).toEqual({
        payer_type: 'self',
        payer_name: '山田太郎',
        payer_relation: 'self',
        billing_address_mode: 'same_as_residence',
        billing_address: '東京都千代田区1-1-1',
        payment_method: 'bank_transfer',
        collection_timing: 'month_end',
        receipt_issue: 'issue',
        invoice_issue: 'issue',
        unpaid_tolerance: 'normal',
        note: '請求メモ',
      });
      expect(billingInit.body as string).not.toContain(hostileId);

      // mcs body: exact key set + values; occurred_at is a generated ISO timestamp (deterministic shape).
      const mcsBody = JSON.parse(mcsInit.body as string);
      expect(Object.keys(mcsBody).sort()).toEqual([
        'content_type',
        'next_action',
        'occurred_at',
        'summary',
      ]);
      expect(mcsBody).toMatchObject({
        content_type: 'medication_adherence',
        summary: '服薬確認OK',
        next_action: '次回訪問で再確認',
      });
      expect(mcsBody.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(mcsInit.body as string).not.toContain(hostileId);
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed: billing-profile and mcs-logs mutationFns reject RangeError before fetch for dot id %p',
    async (dotId) => {
      // 1) probe with a safe id to locate the two target config indices (useMutation order is deterministic).
      const probeConfigs = captureAllMutationConfigs('patient_probe');
      const probeFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
      vi.stubGlobal('fetch', probeFetch);
      render(<CardWorkspace patientId="patient_probe" />);
      const probeUrls = await probeMutationUrls(probeConfigs, probeFetch, {
        ...F083_INPUT,
        patientId: 'patient_probe',
      });
      const billingIndex = probeUrls.findIndex((u) => u?.includes('/billing-profile'));
      const mcsIndex = probeUrls.findIndex((u) => u?.includes('/mcs/logs'));
      vi.unstubAllGlobals();
      vi.clearAllMocks();
      expect(billingIndex).toBeGreaterThanOrEqual(0);
      expect(mcsIndex).toBeGreaterThanOrEqual(0);

      // 2) dot render (same deterministic order) -> the two target mutationFns must fail closed before fetch.
      const dotConfigs = captureAllMutationConfigs(dotId);
      const dotFetch = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', dotFetch);
      try {
        expect(() => render(<CardWorkspace patientId={dotId} />)).toThrow(RangeError);
        expect(dotConfigs[billingIndex]).toBeDefined();
        expect(dotConfigs[mcsIndex]).toBeDefined();
        expect(dotFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  // F-084 (card-workspace sub-slice 4/6): prescription-intakes PATCH x3 (fax string-arg + 2 object-arg) +
  // billing-candidates/collection PATCH (object-arg, must preserve Idempotency-Key). Mixed input contracts:
  // drive each config with the fax string AND the two object fixtures so every target fires with a valid contract.
  const F084_INTAKE_INPUT = {
    intakeId: 'PLACEHOLDER',
    documentUrl: 'https://files.example.com/rx.pdf',
    originalCollectedAt: '2026-06-02T00:00:00.000Z',
    reconciliationResult: 'matched' as const,
    discrepancyNote: null,
    storageLocation: 'store' as const,
    ePrescriptionExchangeNumber: null,
    ePrescriptionAcquiredStatus: 'pending' as const,
    dispensingResultRegistration: 'pending' as const,
    note: '原本確認メモ',
  };
  const F084_BILLING_INPUT = {
    candidateId: 'PLACEHOLDER',
    idempotencyKey: 'idem-key-abc',
    status: 'collected',
    expectedUpdatedAt: '2026-06-01T00:00:00.000Z',
    billedAmount: 1000,
    collectedAmount: 1000,
    paymentMethod: 'cash',
    payerName: '山田太郎',
    scheduledCollectionAt: null,
  };

  async function runEachWith(
    mutationConfigs: Array<{ mutationFn?: (input: unknown) => Promise<unknown> }>,
    args: unknown[],
  ) {
    for (const config of mutationConfigs) {
      for (const arg of args) {
        try {
          await config.mutationFn?.(arg);
        } catch {
          // wrong-contract executions throw or build noise URLs; filtered out by exact-URL match below.
        }
      }
    }
  }

  it('encodes intake/billing PATCH paths, sends helper JSON headers (billing keeps Idempotency-Key), preserves bodies', async () => {
    const hostileIntake = 'in/1?x=y#z';
    const encIntake = encodeURIComponent(hostileIntake);
    const hostileCand = 'cand/9?a=b#c';
    const encCand = encodeURIComponent(hostileCand);
    const idemKey = F084_BILLING_INPUT.idempotencyKey;
    // merging impl proves both helper adoption AND extra-header propagation.
    vi.mocked(buildOrgJsonHeaders).mockImplementation(
      (org: string, extra?: Record<string, string>) => ({
        'x-org-id': org,
        'x-test-helper': 'buildOrgJsonHeaders',
        ...extra,
      }),
    );

    const mutationConfigs = captureAllMutationConfigs('patient_1');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId="patient_1" />);

      await runEachWith(mutationConfigs, [
        hostileIntake, // fax (string contract)
        { ...F084_INTAKE_INPUT, intakeId: hostileIntake }, // document + original-management (object contract)
        { ...F084_BILLING_INPUT, candidateId: hostileCand }, // billing (object contract)
      ]);

      const calls = fetchMock.mock.calls.map(
        ([url, init]) => [String(url), init] as [string, RequestInit],
      );
      const intakeCalls = calls.filter(([u]) => u === `/api/prescription-intakes/${encIntake}`);
      const billingCalls = calls.filter(
        ([u]) => u === `/api/billing-candidates/${encCand}/collection`,
      );

      // all three prescription-intakes PATCHes hit the encoded path with helper headers and no Idempotency-Key.
      expect(intakeCalls.length).toBeGreaterThanOrEqual(3);
      const intakeBodies = intakeCalls.map(([, init]) => {
        expect(init.method).toBe('PATCH');
        expect(init.headers).toEqual({
          'x-org-id': 'org_1',
          'x-test-helper': 'buildOrgJsonHeaders',
        });
        expect(String(init.body)).not.toContain(hostileIntake);
        return JSON.parse(String(init.body));
      });
      // exact bodies discriminated by their distinctive keys.
      const faxBody = intakeBodies.find(
        (b) => Object.keys(b).length === 1 && 'original_collected_at' in b,
      );
      const documentBody = intakeBodies.find((b) => 'original_document_url' in b);
      const mgmtBody = intakeBodies.find((b) => 'original_management' in b);
      expect(faxBody.original_collected_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(documentBody).toEqual({ original_document_url: 'https://files.example.com/rx.pdf' });
      expect(mgmtBody).toMatchObject({
        original_collected_at: '2026-06-02T00:00:00.000Z',
        original_management: { reconciliation_result: 'matched', discrepancy_note: null },
      });

      // billing keeps Idempotency-Key in headers (helper extra) and never serializes ids into the body.
      expect(billingCalls.length).toBeGreaterThanOrEqual(1);
      const [, billingInit] = billingCalls[0];
      expect(billingInit.method).toBe('PATCH');
      expect(billingInit.headers).toEqual({
        'x-org-id': 'org_1',
        'x-test-helper': 'buildOrgJsonHeaders',
        'Idempotency-Key': idemKey,
      });
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1', {
        'Idempotency-Key': idemKey,
      });
      expect(String(billingInit.body)).not.toContain(hostileCand);
      expect(String(billingInit.body)).not.toContain(idemKey);
      const billingBody = JSON.parse(String(billingInit.body));
      expect(billingBody).toMatchObject({
        status: 'collected',
        billed_amount: 1000,
        collected_amount: 1000,
        payment_method: 'cash',
        payer_name: '山田太郎',
      });

      for (const [u] of [...intakeCalls, ...billingCalls]) {
        expect(u).not.toContain('%25');
      }
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed: intake/billing mutationFns reject RangeError before fetch for dot id %p',
    async (dotId) => {
      const mutationConfigs = captureAllMutationConfigs('patient_1');
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      try {
        render(<CardWorkspace patientId="patient_1" />);

        // run every config with the dot id in all three contracts; collect rejections.
        const rejections: unknown[] = [];
        for (const config of mutationConfigs) {
          for (const arg of [
            dotId,
            { ...F084_INTAKE_INPUT, intakeId: dotId },
            { ...F084_BILLING_INPUT, candidateId: dotId },
          ]) {
            await config.mutationFn?.(arg).catch((e: unknown) => rejections.push(e));
          }
        }

        // the encoded dot path would be a no-op for encodeURIComponent, so encodePathSegment must fail closed:
        // at least the 4 target mutations (fax + document + original-management + billing) reject RangeError.
        const rangeErrors = rejections.filter((e) => e instanceof RangeError);
        expect(rangeErrors.length).toBeGreaterThanOrEqual(4);
        // and no malformed dot request reached fetch for the guarded endpoints.
        for (const call of fetchMock.mock.calls) {
          const url = String(call[0]);
          expect(url).not.toContain(`/api/prescription-intakes/${dotId}`);
          expect(url).not.toContain(`/api/billing-candidates/${dotId}/`);
        }
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  // F-085 (card-workspace sub-slice 5/6): prescription upload helper - presigned-upload + complete POST headers via
  // buildOrgJsonHeaders (external S3 PUT untouched) + download URL fileId via encodePathSegment.
  function mockUploadWorkspace() {
    return mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['処方せん画像/PDFが未保存です'],
          quick_actions: [
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });
  }

  function triggerPrescriptionUpload() {
    openMedicationTab();
    const file = new File(['pdf'], 'prescription.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('ファイル'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /画像\/PDFを保存/ }));
    return file;
  }

  it('uploads via encoded download URL + helper JSON headers, keeps external PUT headers, preserves exact bodies', async () => {
    const presignId = 'file_raw_42';
    const completeId = 'file/1?x=y#z';
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);

    const { prescriptionDocumentMutate } = mockUploadWorkspace();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: presignId,
            uploadUrl: 'https://uploads.example.com/prescription.pdf',
            headers: { 'x-amz-server-side-encryption': 'AES256' },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ etag: 'etag-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: completeId } }) });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId="patient_1" />);
      const file = triggerPrescriptionUpload();

      await waitFor(() => {
        expect(prescriptionDocumentMutate).toHaveBeenCalledWith({
          intakeId: 'intake_0500',
          documentUrl: `http://localhost:3000/api/files/${encodeURIComponent(completeId)}/download`,
        });
      });
      const docUrl = prescriptionDocumentMutate.mock.calls[0][0].documentUrl as string;
      expect(docUrl).not.toContain('?x=y');
      expect(docUrl).not.toContain('#z');
      expect(docUrl).not.toContain('%25');

      // presigned-upload: helper headers + exact body.
      const [presignUrl, presignInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(presignUrl).toBe('/api/files/presigned-upload');
      expect(presignInit.headers).toBe(sentinel);
      expect(JSON.parse(String(presignInit.body))).toEqual({
        purpose: 'prescription',
        patient_id: 'patient_1',
        file_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: file.size,
      });

      // external S3 PUT: headers come from the presign response, NOT the org helper.
      const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(putUrl).toBe('https://uploads.example.com/prescription.pdf');
      expect(putInit.headers).toEqual({ 'x-amz-server-side-encryption': 'AES256' });
      expect(putInit.headers).not.toBe(sentinel);

      // complete: helper headers + exact body (file_id is the presign id, not the completed id).
      const [completeUrl, completeInit] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(completeUrl).toBe('/api/files/complete');
      expect(completeInit.headers).toBe(sentinel);
      expect(JSON.parse(String(completeInit.body))).toEqual({ file_id: presignId, etag: 'etag-1' });

      // exactly 3 requests (presign + S3 PUT + complete) and the helper invoked exactly twice with the real org.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenNthCalledWith(2, 'org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed: dot-segment completed file id never builds a malformed download URL or mutates (%p)',
    async (dotId) => {
      const { prescriptionDocumentMutate } = mockUploadWorkspace();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              id: 'file_raw_42',
              uploadUrl: 'https://uploads.example.com/prescription.pdf',
              headers: { 'x-amz-server-side-encryption': 'AES256' },
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, headers: new Headers({ etag: 'etag-1' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: dotId } }) });
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<CardWorkspace patientId="patient_1" />);
        triggerPrescriptionUpload();

        // the helper completes all 3 fetches, then encodePathSegment(dotId) throws building the download URL;
        // PrescriptionDocumentQuickForm catches it and surfaces the exact RangeError message (fail-closed proof).
        expect(await screen.findByText('Path segment cannot be a dot segment')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(prescriptionDocumentMutate).not.toHaveBeenCalled();
        for (const call of fetchMock.mock.calls) {
          expect(String(call[0])).not.toContain(`/api/files/${dotId}/download`);
        }
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  // F-089 (card-workspace sub-slice 6/6 FINAL): converge the 4 static-collection callsites onto org header helpers.
  // (The /api/tasks foundation POST exclusion is already locked by the existing foundation-task test, which asserts its
  //  headers === { 'content-type': 'application/json' } with NO x-org-id.)
  it('converges static-collection GET/POST callsites onto buildOrgHeaders/buildOrgJsonHeaders', async () => {
    const getSentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    const jsonSentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(getSentinel);
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(jsonSentinel);

    mockPatientQuery(buildWorkspace());
    const baseQuery = useQueryMock.getMockImplementation();
    const baseMutation = useMutationMock.getMockImplementation();
    const queryConfigs: Array<{ queryKey?: unknown[]; queryFn?: () => Promise<unknown> }> = [];
    const mutationConfigs: Array<{ mutationFn?: (input: unknown) => Promise<unknown> }> = [];
    useQueryMock.mockImplementation(
      (config: { queryKey?: unknown[]; queryFn?: () => Promise<unknown> }) => {
        queryConfigs.push(config);
        return baseQuery?.(config);
      },
    );
    useMutationMock.mockImplementation(
      (config: { mutationFn?: (input: unknown) => Promise<unknown> }) => {
        mutationConfigs.push(config);
        return baseMutation?.(config);
      },
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CardWorkspace patientId="patient_1" />);
      openSharingTab();

      // --- 2 static GETs use buildOrgHeaders (exact URLs) ---
      const pharmacyCfg = queryConfigs.find((c) => c.queryKey?.[0] === 'pharmacy-partnerships');
      fetchMock.mockClear();
      await pharmacyCfg?.queryFn?.();
      {
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/pharmacy-partnerships?status=active&limit=20');
        expect(init.headers).toBe(getSentinel);
      }

      const mgmtCfg = queryConfigs.find((c) => c.queryKey?.[0] === 'management-plans');
      const effectiveCaseId = mgmtCfg?.queryKey?.[1] as string;
      fetchMock.mockClear();
      await mgmtCfg?.queryFn?.();
      {
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`/api/management-plans?case_id=${encodeURIComponent(effectiveCaseId)}`);
        expect(init.headers).toBe(getSentinel);
      }
      // exactly the two executed GET queryFns called buildOrgHeaders, each with the real org.
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(2, 'org_1');

      // --- 2 static JSON POSTs use buildOrgJsonHeaders (locate by URL) ---
      const shareInput = {
        caseId: 'case_1',
        baseSiteId: 'site_1',
        partnerPharmacyId: 'partner_1',
        effectiveFrom: null,
        effectiveTo: null,
      };
      const conferenceInput = {
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'service_manager',
        title: '担当者会議',
        conferenceDate: '2026-06-01',
        conferenceFormat: 'in_person',
        location: '',
        organizer: 'care_manager',
        reportType: 'care_manager_report',
        followUpDate: '',
        followUpCompleted: false,
        agenda: '',
        content: '会議メモ',
        participantsRaw: '佐藤CM:care_manager',
        pharmacyParticipantsRaw: '鈴木薬剤師',
        visitScheduleChange: '',
        targetDischargeDate: '',
        actionItemsRaw: '',
      };
      const probe = async (input: unknown, urlPart: string) => {
        for (const config of mutationConfigs) {
          fetchMock.mockClear();
          try {
            await config.mutationFn?.(input);
          } catch {
            // unrelated mutation input contracts throw before fetch; ignored.
          }
          const call = fetchMock.mock.calls[0];
          if (call && String(call[0]).includes(urlPart)) {
            return fetchMock.mock.calls[0] as [string, RequestInit];
          }
        }
        return undefined;
      };

      const shareCall = await probe(shareInput, '/api/patient-share-cases');
      expect(shareCall?.[0]).toBe('/api/patient-share-cases');
      expect(shareCall?.[1]?.method).toBe('POST');
      expect(shareCall?.[1]?.headers).toBe(jsonSentinel);
      // patient-share-cases body is the raw input, unchanged.
      expect(JSON.parse(String(shareCall?.[1]?.body))).toEqual(shareInput);

      const conferenceCall = await probe(conferenceInput, '/api/conference-notes');
      expect(conferenceCall?.[0]).toBe('/api/conference-notes');
      expect(conferenceCall?.[1]?.method).toBe('POST');
      expect(conferenceCall?.[1]?.headers).toBe(jsonSentinel);
      // body still flows through unchanged (header-only slice): the transformed fields are all preserved.
      const conferenceBody = JSON.parse(String(conferenceCall?.[1]?.body));
      expect(conferenceBody).toMatchObject({
        note_type: 'service_manager',
        conference_type: 'service_manager',
        title: '担当者会議',
        patient_id: 'patient_1',
        case_id: 'case_1',
        content: '会議メモ',
        follow_up_completed: false,
      });
      expect(conferenceBody.conference_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Array.isArray(conferenceBody.participants)).toBe(true);
      expect(conferenceBody.metadata).toBeTruthy();

      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
