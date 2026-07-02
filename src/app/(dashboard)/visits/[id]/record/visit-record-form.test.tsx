// @vitest-environment jsdom

import { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { VisitRecordForm } from './visit-record-form';

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
  listEvidenceDraftSummariesForScheduleMock,
  toastErrorMock,
  toastSuccessMock,
  toastInfoMock,
  fetchUrls,
  cdsAlertPanelCalls,
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
  listEvidenceDraftSummariesForScheduleMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
  fetchUrls: [] as string[],
  cdsAlertPanelCalls: [] as Array<{ isUnavailable?: boolean; isLoading?: boolean }>,
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
    warning: vi.fn(),
  },
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
      isOffline: false,
      pendingSyncCount: 0,
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

// p0_23 未同期写真バッジ用(IndexedDB は jsdom で使えないためモック)
vi.mock('@/lib/offline/evidence-drafts', () => ({
  listEvidenceDraftSummariesForSchedule: listEvidenceDraftSummariesForScheduleMock,
}));

vi.mock('@/lib/visit-location', () => ({
  captureVisitGeoPoint: vi.fn(),
  getVisitLocationPermissionState: vi.fn().mockResolvedValue('unavailable'),
  getVisitLocationTrackingPreference: vi.fn().mockReturnValue(false),
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

vi.mock('@/components/features/visits/residual-medication-form', () => ({
  ResidualMedicationForm: () => <div data-testid="residual-medication-form" />,
}));

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
  VisitMedicationManagementSection: () => <div data-testid="medication-management-section" />,
}));

vi.mock('@/components/features/visits/patient-care-team-source-panel', () => ({
  PatientCareTeamSourcePanel: () => null,
}));

vi.mock('@/components/features/visits/visit-report-readiness-panel', () => ({
  VisitReportReadinessPanel: () => null,
}));

vi.mock('@/components/features/visits/visit-attachments-field', () => ({
  VisitAttachmentsField: () => null,
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderVisitRecordForm() {
  return render(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />, {
    wrapper: createWrapper(),
  });
}

describe('VisitRecordForm carry-item acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDraftMock.mockResolvedValue(null);
    saveDraftMock.mockResolvedValue(undefined);
    clearDraftMock.mockResolvedValue(undefined);
    setupAutoSyncMock.mockReturnValue(vi.fn());
    useNetworkOnlineMock.mockReturnValue(true);
    refreshSyncStateMock.mockResolvedValue(undefined);
    refreshSyncCountMock.mockResolvedValue(undefined);
    listEvidenceDraftSummariesForScheduleMock.mockResolvedValue([]);
    cdsAlertPanelCalls.length = 0;
    visitRecordPostBodies.length = 0;
    fetchUrls.length = 0;

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return new Response(
            JSON.stringify({
              id: 'schedule_partial',
              patient_id: 'patient_1',
              cycle_id: null,
              scheduled_date: '2026-04-09',
              time_window_start: '1970-01-01T09:00:00.000Z',
              schedule_status: 'ready',
              visit_type: 'regular',
              carry_items_status: 'partial',
              recurrence_rule: null,
            }),
            { status: 200 },
          );
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
                  intake_context: null,
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
              record: {
                id: 'record_1',
                version: 1,
                patient_id: 'patient_1',
              },
            }),
            { status: 201 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces a retryable warning instead of silently dropping the visit-preparation pack on fetch failure', async () => {
    // 準備パック取得失敗を「処方変更/その他薬/前回記録なし」に潰さず、再読込導線つきで明示する。
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return new Response(
            JSON.stringify({
              id: 'schedule_partial',
              patient_id: 'patient_1',
              cycle_id: null,
              scheduled_date: '2026-04-09',
              time_window_start: '1970-01-01T09:00:00.000Z',
              schedule_status: 'ready',
              visit_type: 'regular',
              carry_items_status: 'ready',
              recurrence_rule: null,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    const visitTimeLabels = await screen.findAllByText(/4\/9 09:00/);
    expect(visitTimeLabels.length).toBeGreaterThan(0);
    expect(await screen.findByText('訪問準備情報を読み込めませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('blocks the visit form with a retryable error when the schedule cannot be loaded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url === '/api/visit-schedules/schedule_partial') {
        return new Response(JSON.stringify({ message: 'schedule failed' }), { status: 500 });
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
                previous_visit: null,
                facility_parallel_context: null,
                intake_context: null,
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderVisitRecordForm();

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('訪問予定を読み込めませんでした');
    expect(alert.textContent).toContain('訪問予定と患者情報を確認できないため');
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByTestId('medication-management-section')).toBeNull();
    expect(screen.queryByText('訪問時チェック')).toBeNull();
    expect(
      screen.queryByRole('checkbox', {
        name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
      }),
    ).toBeNull();
    expect(fetchUrls.some((url) => url === '/api/cds/check')).toBe(false);
    expect(fetchUrls).not.toContain('/api/visit-preparations/schedule_partial');
    expect(visitRecordPostBodies).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    await waitFor(() => {
      expect(
        fetchUrls.filter((url) => url === '/api/visit-schedules/schedule_partial'),
      ).toHaveLength(2);
    });
  });

  it('passes an unavailable CDS state when schedule is loaded but safety alerts fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return new Response(
            JSON.stringify({
              id: 'schedule_partial',
              patient_id: 'patient_1',
              cycle_id: 'cycle_1',
              scheduled_date: '2026-04-09',
              time_window_start: '1970-01-01T09:00:00.000Z',
              schedule_status: 'ready',
              visit_type: 'regular',
              carry_items_status: 'ready',
              recurrence_rule: null,
            }),
            { status: 200 },
          );
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
                  previous_visit: null,
                  facility_parallel_context: null,
                  intake_context: null,
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url === '/api/cds/check') {
          return new Response(JSON.stringify({ message: 'cds failed' }), { status: 500 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    expect(await screen.findByTestId('cds-alerts-unavailable')).toBeTruthy();
    expect(screen.getByText('訪問時チェック')).toBeTruthy();
    expect(cdsAlertPanelCalls.some((call) => call.isUnavailable === true)).toBe(true);
  });

  it('syncs offline state on mount and when network status changes', async () => {
    const { rerender } = renderVisitRecordForm();

    await waitFor(() => {
      expect(syncOnlineStatusMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(refreshSyncCountMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(listEvidenceDraftSummariesForScheduleMock).toHaveBeenCalledWith('schedule_partial');
    });
    expect(refreshSyncStateMock).not.toHaveBeenCalled();

    syncOnlineStatusMock.mockClear();
    useNetworkOnlineMock.mockReturnValue(false);
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);

    await waitFor(() => {
      expect(syncOnlineStatusMock).toHaveBeenCalledTimes(1);
    });

    syncOnlineStatusMock.mockClear();
    useNetworkOnlineMock.mockReturnValue(true);
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);

    await waitFor(() => {
      expect(syncOnlineStatusMock).toHaveBeenCalledTimes(1);
    });
  });

  it('logs count refresh failures without rejecting from the polling timer', async () => {
    refreshSyncCountMock.mockRejectedValue(new Error('IndexedDB unavailable'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderVisitRecordForm();

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        '[offline-sync] sync count refresh failed',
        expect.any(Error),
      );
    });
    expect(refreshSyncStateMock).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('announces and clears the required partial carry-item acknowledgement error', async () => {
    renderVisitRecordForm();

    const checkbox = await screen.findByRole('checkbox', {
      name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
    });
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        '持参物一部未確定の確認：持参物一部未確定の確認が必要です',
      );
    });
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    expect(checkbox.getAttribute('aria-describedby')).toBe(
      'carry-item-warning-acknowledgement-error',
    );
    expect(document.getElementById('carry-item-warning-acknowledgement-error')?.textContent).toBe(
      '持参物一部未確定の確認が必要です',
    );

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.queryByText('持参物一部未確定の確認が必要です')).toBeNull();
    });
    expect(checkbox.getAttribute('aria-invalid')).toBe('false');
    expect(checkbox.getAttribute('aria-describedby')).toBeNull();
  });

  it('clears the carry-item acknowledgement error when the outcome no longer requires it', async () => {
    renderVisitRecordForm();

    await screen.findByRole('checkbox', {
      name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
    });
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('持参物一部未確定の確認が必要です')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));

    await waitFor(() => {
      expect(screen.queryByText('持参物一部未確定の確認が必要です')).toBeNull();
    });
    expect(
      screen.queryByRole('checkbox', {
        name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
      }),
    ).toBeNull();
  });

  it('requires a relation when the receipt receiver name is entered', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('受領者名'), {
      target: { value: '山田 花子' },
    });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(document.body.textContent).toContain('受領者の続柄：受領者の続柄を選択してください');
    });
    expect(visitRecordPostBodies).toHaveLength(0);
  });

  it('omits the default receipt timestamp when no receiver identity was entered', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(visitRecordPostBodies[0]).toMatchObject({
      outcome_status: 'postponed',
      structured_soap: {
        previous_visit_reuse: {
          source_visit_record_id: 'record_prev',
          source_visit_record_version: 3,
          source_visit_record_updated_at: '2026-04-01T03:00:00.000Z',
          carry_forward_items: ['眠気の継続確認'],
        },
      },
    });
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_person_name');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_person_relation');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_at');
    expect(fetchUrls.some((url) => url.includes('/labs'))).toBe(false);
  });

  it('shows billing collection context without posting billing fields as visit record data', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect(screen.getByTestId('visit-billing-collection-context')).toBeTruthy();
    });

    expect(screen.getByText('集金確認')).toBeTruthy();
    expect(screen.getByText('今回徴収')).toBeTruthy();
    expect(screen.getByText('3,240円')).toBeTruthy();
    expect(screen.getByText('前回未収分')).toBeTruthy();
    expect(screen.getByText('1,080円')).toBeTruthy();
    expect(screen.getByText('合計徴収額')).toBeTruthy();
    expect(screen.getByText('4,320円')).toBeTruthy();
    expect(screen.getByText('現金')).toBeTruthy();
    expect(screen.getByText('紙 / 未発行')).toBeTruthy();
    const billingCandidateHref = screen
      .getByRole('link', { name: '請求候補を開く' })
      .getAttribute('href');
    expect(billingCandidateHref).toContain('candidate_id=candidate_current');
    expect(billingCandidateHref).toContain('workflow_from=visit_record');
    expect(billingCandidateHref).toContain('schedule_id=schedule_partial');

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(visitRecordPostBodies[0]).not.toHaveProperty('billing_collection_context');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('current_collection_amount');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_number');
  });
});

describe('VisitRecordForm patient-detail reflect (⑤)', () => {
  const patientPatchBodies: unknown[] = [];
  const patientPatchUrls: string[] = [];
  let schedulePatientId = 'patient_1';

  beforeEach(() => {
    vi.clearAllMocks();
    loadDraftMock.mockResolvedValue(null);
    saveDraftMock.mockResolvedValue(undefined);
    clearDraftMock.mockResolvedValue(undefined);
    setupAutoSyncMock.mockReturnValue(vi.fn());
    refreshSyncStateMock.mockResolvedValue(undefined);
    refreshSyncCountMock.mockResolvedValue(undefined);
    listEvidenceDraftSummariesForScheduleMock.mockResolvedValue([]);
    cdsAlertPanelCalls.length = 0;
    visitRecordPostBodies.length = 0;
    patientPatchBodies.length = 0;
    patientPatchUrls.length = 0;
    schedulePatientId = 'patient_1';
    vi.mocked(buildPatientApiPath).mockImplementation(
      (patientId, suffix = '') => `/api/patients/${encodeURIComponent(patientId)}${suffix}`,
    );

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url === '/api/visit-schedules/schedule_partial') {
          return new Response(
            JSON.stringify({
              id: 'schedule_partial',
              patient_id: schedulePatientId,
              cycle_id: null,
              scheduled_date: '2026-04-09',
              time_window_start: '1970-01-01T09:00:00.000Z',
              schedule_status: 'ready',
              visit_type: 'regular',
              carry_items_status: 'partial',
              recurrence_rule: null,
            }),
            { status: 200 },
          );
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
                  previous_visit: null,
                  facility_parallel_context: null,
                  intake_context: null,
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
              record: { id: 'record_1', version: 1, patient_id: schedulePatientId },
            }),
            { status: 201 },
          );
        }
        if (url.startsWith('/api/patients/') && method === 'PATCH') {
          patientPatchUrls.push(url);
          patientPatchBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(JSON.stringify({ id: schedulePatientId }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderForm() {
    return render(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />, {
      wrapper: createWrapper(),
    });
  }

  async function waitForPatientHydrated() {
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        schedulePatientId,
      );
    });
  }

  it('反映チェック時、保存後に入力した患者情報を患者詳細へ PATCH する', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    await waitFor(() => {
      expect(patientPatchBodies).toHaveLength(1);
    });
    expect(patientPatchBodies[0]).toEqual({
      intake: { care_level: '要介護3', medication_manager: 'family' },
      source_visit_record_id: 'record_1',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('確認した内容を患者詳細に反映しました');
  });

  it('患者詳細反映 PATCH を共有 patient API path helper 経由にする', async () => {
    schedulePatientId = 'pt/1?tab=x#frag';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_reflect__');

    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(patientPatchUrls).toEqual(['/api/patients/__helper_reflect__']);
    });
    expect(buildPatientApiPath).toHaveBeenCalledWith(schedulePatientId);
    expect(patientPatchUrls).not.toContain(`/api/patients/${schedulePatientId}`);
  });

  it('反映チェック無しなら患者詳細へ PATCH しない', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
    // 反映チェックを入れずに保存する
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(patientPatchBodies).toHaveLength(0);
  });

  it('反映チェック有でも入力が空なら PATCH しない', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(patientPatchBodies).toHaveLength(0);
  });
});
