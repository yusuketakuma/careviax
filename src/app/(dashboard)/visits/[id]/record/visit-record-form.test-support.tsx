// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { SyncQueueItemSummary } from '@/lib/stores/sync-engine';
import type {
  VisitMedicationStockObservationDraft,
  VisitMedicationStockObservationDraftErrors,
} from '@/types/medication-stock';

const {
  routerBackMock,
  routerPushMock,
  visitRecordPostBodies,
  loadDraftMock,
  saveDraftMock,
  clearDraftMock,
  setupAutoSyncMock,
  enqueueForSyncMock,
  syncOnlineStatusMock,
  useNetworkOnlineMock,
  refreshSyncCountMock,
  refreshSyncStateMock,
  offlineStoreState,
  listEvidenceDraftSummariesForScheduleMock,
  toastErrorMock,
  toastSuccessMock,
  toastInfoMock,
  toastWarningMock,
  clientLogWarnMock,
  captureVisitGeoPointMock,
  getVisitLocationPermissionStateMock,
  getVisitLocationTrackingPreferenceMock,
  fetchUrls,
  cdsAlertPanelCalls,
  medicationManagementSectionCalls,
  patientCareTeamSourcePanelCalls,
  medicationStockPanelCalls,
  visitReportReadinessPanelCalls,
  submitVisitMedicationStockObservationsMock,
} = vi.hoisted(() => ({
  routerBackMock: vi.fn(),
  routerPushMock: vi.fn(),
  visitRecordPostBodies: [] as unknown[],
  loadDraftMock: vi.fn(),
  saveDraftMock: vi.fn(),
  clearDraftMock: vi.fn(),
  setupAutoSyncMock: vi.fn(),
  enqueueForSyncMock: vi.fn(),
  syncOnlineStatusMock: vi.fn(),
  useNetworkOnlineMock: vi.fn(),
  refreshSyncCountMock: vi.fn(),
  refreshSyncStateMock: vi.fn(),
  offlineStoreState: {
    isOffline: false,
    pendingSyncCount: 0,
    pendingQueue: [] as SyncQueueItemSummary[],
  },
  listEvidenceDraftSummariesForScheduleMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastWarningMock: vi.fn(),
  clientLogWarnMock: vi.fn(),
  captureVisitGeoPointMock: vi.fn(),
  getVisitLocationPermissionStateMock: vi.fn(),
  getVisitLocationTrackingPreferenceMock: vi.fn(),
  fetchUrls: [] as string[],
  cdsAlertPanelCalls: [] as Array<{ isUnavailable?: boolean; isLoading?: boolean }>,
  medicationManagementSectionCalls: [] as Array<{
    preparationSourceStatus?: 'loading' | 'error' | 'stale' | 'ready';
    preparationSourceUpdatedAt?: number;
    onRetryPreparation?: () => void;
    prescriptionChanges?: { added: string[] } | null;
  }>,
  patientCareTeamSourcePanelCalls: [] as Array<{
    contacts: Array<{ id: string; name: string }>;
  }>,
  visitReportReadinessPanelCalls: [] as Array<{
    items: Array<{ key: string; description: string; done: boolean }>;
  }>,
  medicationStockPanelCalls: [] as Array<{
    patientId: string | null | undefined;
    writeEnabled?: boolean;
    drafts?: readonly VisitMedicationStockObservationDraft[];
    validationErrors?: VisitMedicationStockObservationDraftErrors;
    submissionState?: { status: string; message?: string };
    onDraftsChange?: (drafts: VisitMedicationStockObservationDraft[]) => void;
    onRetrySubmission?: () => void;
  }>,
  submitVisitMedicationStockObservationsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBackMock,
    push: routerPushMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
    warning: toastWarningMock,
  },
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/hooks/use-network-online', () => ({
  useNetworkOnline: useNetworkOnlineMock,
}));

vi.mock('@/lib/hooks/use-media-query', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/lib/hooks/use-speech-recognition', () => ({
  useSpeechRecognition: () => ({
    activeField: null,
    error: null,
    interimTranscript: '',
    isListening: false,
    isSupported: false,
    transcript: '',
    toggleListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/use-soap-draft', () => ({
  useSoapDraft: () => ({
    loadDraft: loadDraftMock,
    saveDraft: saveDraftMock,
    clearDraft: clearDraftMock,
  }),
}));

vi.mock('@/lib/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: () => vi.fn(),
}));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: (selector: (state: unknown) => unknown) =>
    selector({
      isOffline: offlineStoreState.isOffline,
      pendingSyncCount: offlineStoreState.pendingSyncCount,
      pendingQueue: offlineStoreState.pendingQueue,
      syncOnlineStatus: syncOnlineStatusMock,
      refreshSyncCount: refreshSyncCountMock,
      refreshSyncState: refreshSyncStateMock,
    }),
}));

vi.mock('@/lib/stores/sync-engine', () => ({
  enqueueForSync: enqueueForSyncMock,
  registerVisitRecordConflict: vi.fn(),
  setupAutoSync: setupAutoSyncMock,
}));

// p0_23 未同期写真バッジ用
vi.mock('@/lib/offline/evidence-drafts', () => ({
  listEvidenceDraftSummariesForSchedule: listEvidenceDraftSummariesForScheduleMock,
}));

vi.mock('@/lib/visit-location', () => ({
  captureVisitGeoPoint: captureVisitGeoPointMock,
  getVisitLocationPermissionState: getVisitLocationPermissionStateMock,
  getVisitLocationTrackingPreference: getVisitLocationTrackingPreferenceMock,
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children, id }: PropsWithChildren<{ id?: string }>) => (
      <div id={id}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const context = React.useContext(SelectContext);
      return <span>{context.value ?? placeholder}</span>;
    },
    SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectItem: ({ value, children }: PropsWithChildren<{ value: string }>) => {
      const context = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

vi.mock('@/components/features/visits/soap-voice-field-toggle', () => ({
  SoapVoiceFieldToggle: () => null,
}));

vi.mock('@/components/features/visits/soap-step-wizard', () => ({
  SoapStepWizard: () => <div data-testid="soap-step-wizard" />,
}));

vi.mock('@/components/features/visits/voice-soap-assist', () => ({
  VoiceSoapAssist: () => null,
}));

vi.mock('@/components/features/visits/facility-visit-record-switcher', () => ({
  FacilityVisitRecordSwitcher: () => null,
}));

vi.mock('@/components/features/visits/visit-medication-management-section', () => ({
  VisitMedicationManagementSection: (props: {
    preparationSourceStatus?: 'loading' | 'error' | 'stale' | 'ready';
    preparationSourceUpdatedAt?: number;
    onRetryPreparation?: () => void;
    prescriptionChanges?: { added: string[] } | null;
  }) => {
    medicationManagementSectionCalls.push(props);
    return (
      <div data-testid="medication-management-section">
        <span data-testid="medication-management-preparation-status">
          {props.preparationSourceStatus ?? 'ready'}
        </span>
        <span data-testid="medication-management-prescription-changes">
          {props.prescriptionChanges?.added.join(' / ') ?? ''}
        </span>
        {props.preparationSourceStatus === 'error' ? (
          <div role="alert">
            訪問準備情報を読み込めませんでした
            <button type="button" onClick={props.onRetryPreparation}>
              再読み込み
            </button>
          </div>
        ) : null}
      </div>
    );
  },
}));

vi.mock('@/components/features/visits/visit-medication-stock-observation-panel', () => ({
  VisitMedicationStockObservationPanel: (props: {
    patientId: string | null | undefined;
    writeEnabled?: boolean;
    drafts?: readonly VisitMedicationStockObservationDraft[];
    validationErrors?: VisitMedicationStockObservationDraftErrors;
    submissionState?: { status: string; message?: string };
    onDraftsChange?: (drafts: VisitMedicationStockObservationDraft[]) => void;
    onRetrySubmission?: () => void;
  }) => {
    medicationStockPanelCalls.push(props);
    const validDraft: VisitMedicationStockObservationDraft = {
      client_observation_id: 'obs_stock_1',
      stock_item_id: 'stock_1',
      unit: '枚',
      kind: 'observed_absolute',
      quantity_input: '4',
      used_quantity_input: '',
      usage_quantity_input: '',
      usage_period_days_input: '',
      last_used_date: '2026-04-09',
      unobserved_reason_code: '',
      source_preset: 'pharmacist_counted',
    };
    const invalidDraft: VisitMedicationStockObservationDraft = {
      ...validDraft,
      quantity_input: '',
      source_preset: '',
    };
    const firstValidationError = Object.values(props.validationErrors ?? {})[0]?.quantity_input;
    return (
      <div data-testid="visit-medication-stock-observation-panel">
        <span data-testid="visit-medication-stock-submission-state">
          {props.submissionState?.status ?? 'idle'}
        </span>
        <span data-testid="visit-medication-stock-validation-error">
          {firstValidationError ?? ''}
        </span>
        <button type="button" onClick={() => props.onDraftsChange?.([validDraft])}>
          残数観測テスト入力
        </button>
        <button type="button" onClick={() => props.onDraftsChange?.([invalidDraft])}>
          残数観測不正入力
        </button>
        <button type="button" onClick={props.onRetrySubmission}>
          残数観測再試行
        </button>
      </div>
    );
  },
}));

vi.mock('@/lib/visits/medication-stock-observation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/visits/medication-stock-observation')>();
  return {
    ...actual,
    submitVisitMedicationStockObservations: submitVisitMedicationStockObservationsMock,
  };
});

vi.mock('@/components/features/visits/patient-care-team-source-panel', () => ({
  PatientCareTeamSourcePanel: (props: { contacts: Array<{ id: string; name: string }> }) => {
    patientCareTeamSourcePanelCalls.push(props);
    return <div data-testid="patient-care-team-source-panel">{props.contacts[0]?.name ?? ''}</div>;
  },
}));

vi.mock('@/components/features/visits/visit-report-readiness-panel', () => ({
  VisitReportReadinessPanel: (props: {
    items: Array<{ key: string; description: string; done: boolean }>;
  }) => {
    visitReportReadinessPanelCalls.push(props);
    return null;
  },
}));

vi.mock('@/components/features/visits/visit-attachments-field', () => ({
  VisitAttachmentsField: ({ onAddFiles }: { onAddFiles: (files: File[]) => void }) => (
    <button
      type="button"
      onClick={() =>
        onAddFiles([
          new File(['pdf'], 'visit-evidence.pdf', {
            type: 'application/pdf',
            lastModified: 1_775_000_000_000,
          }),
        ])
      }
    >
      添付テスト追加
    </button>
  ),
}));

vi.mock('@/components/features/cds/alert-panel', () => ({
  CdsAlertPanel: (props: { isUnavailable?: boolean; isLoading?: boolean }) => {
    cdsAlertPanelCalls.push({
      isUnavailable: props.isUnavailable,
      isLoading: props.isLoading,
    });
    return props.isUnavailable ? <div data-testid="cds-alerts-unavailable" /> : null;
  },
}));

vi.mock('./visit-completion-readiness-warning', () => ({
  VisitCompletionReadinessWarning: () => null,
}));

setupDomTestEnv();

export function scheduleDetailResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      data: {
        id: 'schedule_partial',
        patient_id: 'patient_1',
        case_id: 'case_1',
        case_version: 7,
        cycle_id: null,
        scheduled_date: '2026-04-09',
        time_window_start: '1970-01-01T09:00:00.000Z',
        schedule_status: 'ready',
        visit_type: 'regular',
        carry_items_status: 'ready',
        recurrence_rule: null,
        ...overrides,
      },
    }),
    { status: 200 },
  );
}

export function registerDefaultVisitRecordFormHooks() {
  beforeEach(() => {
    vi.clearAllMocks();
    captureVisitGeoPointMock.mockReset();
    getVisitLocationPermissionStateMock.mockReset().mockResolvedValue('unavailable');
    getVisitLocationTrackingPreferenceMock.mockReset().mockReturnValue(false);
    loadDraftMock.mockResolvedValue(null);
    saveDraftMock.mockResolvedValue(undefined);
    clearDraftMock.mockResolvedValue(undefined);
    setupAutoSyncMock.mockReturnValue(vi.fn());
    useNetworkOnlineMock.mockReturnValue(true);
    refreshSyncStateMock.mockResolvedValue(undefined);
    refreshSyncCountMock.mockResolvedValue(undefined);
    submitVisitMedicationStockObservationsMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          visit_record_id: 'record_1',
          observations: [
            {
              client_observation_id: 'obs_stock_1',
              stock_item_id: 'stock_1',
              stock_event_id: 'event_1',
              observation_context_id: 'context_1',
              event_type: 'visit_observation',
              observation_kind: 'observed_absolute',
              quantity_kind: 'observed_absolute',
              snapshot: {
                current_quantity: 4,
                stock_risk_level: 'ok',
                calculated_at: '2026-04-09T01:00:00.000Z',
              },
              idempotent_replay: false,
            },
          ],
        },
        meta: {
          generated_at: '2026-04-09T01:00:00.000Z',
          applied_count: 1,
          replay_count: 0,
        },
      },
    });
    offlineStoreState.isOffline = false;
    offlineStoreState.pendingSyncCount = 0;
    offlineStoreState.pendingQueue = [];
    listEvidenceDraftSummariesForScheduleMock.mockResolvedValue([]);
    cdsAlertPanelCalls.length = 0;
    medicationManagementSectionCalls.length = 0;
    patientCareTeamSourcePanelCalls.length = 0;
    medicationStockPanelCalls.length = 0;
    visitReportReadinessPanelCalls.length = 0;
    visitRecordPostBodies.length = 0;
    fetchUrls.length = 0;

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse({ carry_items_status: 'partial' });
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          return new Response(
            JSON.stringify({
              data: {
                pack: {
                  care_team: [],
                  billing_blockers: [],
                  conference_context: [],
                  medication_period: null,
                  prescription_changes: null,
                  previous_visit: {
                    id: 'record_prev',
                    summary: '前回は眠気を確認',
                    structured_reuse: {
                      source_visit_record_id: 'record_prev',
                      source_visit_record_version: 3,
                      source_visit_record_updated_at: '2026-04-01T03:00:00.000Z',
                      subjective: ['眠気あり'],
                      objective: [],
                      assessment: [],
                      plan: [],
                      handoff: {
                        next_check_items: ['眠気の継続確認'],
                        ongoing_monitoring: [],
                        decision_rationale: null,
                      },
                      carry_forward_items: ['眠気の継続確認'],
                    },
                  },
                  facility_parallel_context: null,
                  intake_context: { initial_transition_management_expected: null },
                  billing_collection_context: {
                    candidate_id: 'candidate_current',
                    billing_month: '2026-03-01T00:00:00.000Z',
                    billing_name: '在宅患者訪問薬剤管理指導料',
                    candidate_status: 'confirmed',
                    current_billed_amount: 3240,
                    current_collection_amount: 3240,
                    previous_unpaid_amount: 1080,
                    total_collection_amount: 4320,
                    collected_amount: 0,
                    payer_name: '山田 次郎',
                    payer_relation: '長男',
                    collection_method: 'cash',
                    collection_method_label: '現金',
                    collection_timing: 'per_visit',
                    collection_timing_label: '毎回',
                    scheduled_collection_at: '2026-03-27T01:00:00.000Z',
                    collected_at: null,
                    receipt_issue: 'paper',
                    receipt_issue_label: '紙',
                    receipt_issue_status: 'not_issued',
                    receipt_issue_status_label: '未発行',
                    receipt_number: null,
                    collector_user_id: 'user_billing',
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url === '/api/visit-records') {
          visitRecordPostBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(
            JSON.stringify({
              data: {
                record: {
                  id: 'record_1',
                  version: 1,
                  patient_id: 'patient_1',
                },
              },
            }),
            { status: 201 },
          );
        }
        if (url.endsWith('/header-summary')) {
          // Pinned 安全タグ用の患者ヘッダサマリー(visible_safety_tags は critical 保証済み)。
          return new Response(
            JSON.stringify({
              data: {
                patient_id: 'patient_1',
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                safety: {
                  safety_tags: ['allergy', 'renal', 'fall'],
                  visible_safety_tags: ['allergy'],
                  hidden_safety_tag_count: 2,
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}

export function getVisitRecordFormTestMocks() {
  return {
    routerBackMock,
    routerPushMock,
    visitRecordPostBodies,
    loadDraftMock,
    saveDraftMock,
    clearDraftMock,
    setupAutoSyncMock,
    enqueueForSyncMock,
    syncOnlineStatusMock,
    useNetworkOnlineMock,
    refreshSyncCountMock,
    refreshSyncStateMock,
    offlineStoreState,
    listEvidenceDraftSummariesForScheduleMock,
    toastErrorMock,
    toastSuccessMock,
    toastInfoMock,
    toastWarningMock,
    clientLogWarnMock,
    captureVisitGeoPointMock,
    getVisitLocationPermissionStateMock,
    getVisitLocationTrackingPreferenceMock,
    fetchUrls,
    cdsAlertPanelCalls,
    medicationManagementSectionCalls,
    patientCareTeamSourcePanelCalls,
    medicationStockPanelCalls,
    visitReportReadinessPanelCalls,
    submitVisitMedicationStockObservationsMock,
  };
}
