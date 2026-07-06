// @vitest-environment jsdom

import { type PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { VisitRecordForm, fetchVisitRecordCdsAlerts } from './visit-record-form';

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
  offlineStoreState: {
    isOffline: false,
    pendingSyncCount: 0,
  },
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
      isOffline: offlineStoreState.isOffline,
      pendingSyncCount: offlineStoreState.pendingSyncCount,
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

function renderVisitRecordForm() {
  return render(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />, {
    wrapper: createQueryClientWrapper(),
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
    offlineStoreState.isOffline = false;
    offlineStoreState.pendingSyncCount = 0;
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
        if (url.endsWith('/header-summary')) {
          // Pinned 安全タグ用の患者ヘッダサマリー(visible_safety_tags は critical 保証済み)。
          return new Response(
            JSON.stringify({
              safety: { visible_safety_tags: ['allergy'], hidden_safety_tag_count: 2 },
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

  it('surfaces API error messages when visit CDS alerts fail to load', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: '処方安全アラートの閲覧権限がありません' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVisitRecordCdsAlerts('cycle_1', 'org_1')).rejects.toThrow(
      '処方安全アラートの閲覧権限がありません',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/cds/check', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({ cycleId: 'cycle_1' }),
    });
  });

  it('shows a visit-record skeleton instead of generic loading text while schedule loads', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderVisitRecordForm();

    expect(screen.getByRole('status', { name: '訪問記録フォームを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByRole('button', { name: '訪問完了' })).toBeNull();
    expect(screen.queryByTestId('medication-management-section')).toBeNull();
    expect(screen.queryByText('訪問時チェック')).toBeNull();
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

    // 臨床画面の一次日付は和式表記(SSOT 7.8: MM/DD 単独禁止)。
    const visitTimeLabels = await screen.findAllByText(/4月9日 09:00/);
    expect(visitTimeLabels.length).toBeGreaterThan(0);
    expect(await screen.findByText('訪問準備情報を読み込めませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('pins the allergy safety tag in the visit mode headers (SSOT 4.1)', async () => {
    renderVisitRecordForm();

    // md+/mobile 両ヘッダに critical 保証済みの安全タグ(アレルギー)と +N が常時表示される。
    const tagGroups = await screen.findAllByTestId('visit-header-safety-tags');
    expect(tagGroups.length).toBeGreaterThan(0);
    for (const group of tagGroups) {
      expect(group.textContent).toContain('アレルギー');
      expect(group.textContent).toContain('+2');
    }
    expect(screen.queryByTestId('visit-header-safety-unavailable')).toBeNull();
    // md+ ヘッダは AppHeader の下で sticky になり、入力中も安全タグが隠れない(SSOT 2.3)。
    const modeHeader = screen.getByTestId('visit-mode-header');
    expect(modeHeader.className).toContain('sticky');
    expect(modeHeader.className).toContain('top-14');
  });

  it('fails closed in the header when safety tags cannot be loaded', async () => {
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
              carry_items_status: 'none',
              recurrence_rule: null,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/header-summary')) {
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          // 500 は form が明示ハンドリング済みの経路(retryable warning)。pack:null は crash する。
          return new Response(JSON.stringify({ message: 'skip' }), { status: 500 });
        }
        return new Response(JSON.stringify({ alerts: [] }), { status: 200 });
      }),
    );

    renderVisitRecordForm();

    // 取得失敗を「タグなし」に潰さない(fail-close)。
    const warnings = await screen.findAllByTestId('visit-header-safety-unavailable');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].textContent).toContain('「なし」とは判断しない');
    expect(screen.queryByTestId('visit-header-safety-tags')).toBeNull();
  });

  it('keeps 訪問完了 as the single primary submit with no green fill (SSOT 5.1)', async () => {
    renderVisitRecordForm();

    // md+ 固定バーと mobile ウィザードの双方(jsdom は media query 非適用で両方 DOM に載る)。
    const completeButtons = await screen.findAllByRole('button', { name: '訪問完了' });
    expect(completeButtons.length).toBeGreaterThan(0);
    for (const button of completeButtons) {
      // 完了アクションも Primary(--primary)。done 緑の主操作塗りは禁止。
      expect(button.className).not.toContain('bg-state-done');
      expect(button.getAttribute('type')).toBe('submit');
    }
    // inline の重複 submit(旧 ActionRail の「保存」)は存在しない(主操作導線の一本化)。
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    // md+ の「次へ」はスクロール補助(outline)へ降格され、塗りの主操作は訪問完了のみ。
    const nextButtons = screen.getAllByRole('button', { name: '次へ' });
    expect(nextButtons.some((button) => !button.className.includes('bg-primary'))).toBe(true);
  });

  it('defaults the visit date to the JST business date on a device timezone behind Japan (SSOT 2.8)', async () => {
    // 既定訪問日は端末ローカル TZ ではなく JST 業務日を正本にする。format(new Date(),...) だと
    // Asia/Tokyo より遅れた TZ では前日の既定日になってしまう回帰を固定する。
    const originalTz = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu'; // UTC-10、JST より遅れ
    // Date のみ偽装し(setTimeout/rAF は実タイマーのまま)、react-query の非同期解決を妨げない。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-04T02:00:00+09:00'));
    try {
      // 前提確認: ランタイム TZ が実際に JST より遅れている(偽ガード検知)。
      expect(new Date('2026-07-04T00:00:00+09:00').getDate()).toBe(3);

      renderVisitRecordForm();

      const visitDateInput = (await screen.findByLabelText(/訪問日/)) as HTMLInputElement;
      // JST 業務日(2026-07-04)。端末ローカル日付(2026-07-03)にならない。
      expect(visitDateInput.value).toBe('2026-07-04');
    } finally {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
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
    expect(screen.queryByRole('button', { name: '訪問完了' })).toBeNull();
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
      expect(listEvidenceDraftSummariesForScheduleMock).toHaveBeenCalledWith(
        'schedule_partial',
        'org_1',
      );
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
    refreshSyncCountMock.mockRejectedValue(
      new Error('IndexedDB unavailable patient=患者A token=secret'),
    );
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderVisitRecordForm();

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith('[offline-sync] sync count refresh failed');
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('患者A');
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('token=secret');
    expect(refreshSyncStateMock).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('debounces important visit draft autosave for five seconds after the latest edit', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: '眠気が強い' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(saveDraftMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: '眠気が改善' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(saveDraftMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(saveDraftMock).toHaveBeenCalledTimes(1);
      expect(saveDraftMock.mock.calls[0]?.[0]).toMatchObject({
        subjective: { free_text: '眠気が改善' },
      });
      expect(JSON.stringify(saveDraftMock.mock.calls)).not.toContain('眠気が強い');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not autosave an untouched empty draft after hydration or hidden transition', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 5_000);
    saveDraftMock.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(saveDraftMock).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('cancels pending autosave after manual draft save', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: '手動保存前の入力' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: '一時保存' })[0]!);
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(saveDraftMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending autosave after keyboard draft save', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: 'ショートカット保存前の入力' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      await act(async () => {
        fireEvent.keyDown(window, { key: 's', metaKey: true });
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(saveDraftMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expose raw draft-save error messages in toast text', async () => {
    saveDraftMock.mockRejectedValueOnce(new Error('patient=患者A token=secret'));
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('オフライン下書きの保存に失敗しました');
    });
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain('患者A');
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain('token=secret');
  });

  it('polls sync count only while pending work exists in a visible tab', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation(() => 123 as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const { rerender } = renderVisitRecordForm();

    await waitFor(() => {
      expect(refreshSyncCountMock).toHaveBeenCalled();
    });

    setIntervalSpy.mockClear();
    offlineStoreState.pendingSyncCount = 0;
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5_000);

    offlineStoreState.pendingSyncCount = 2;
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);

    offlineStoreState.pendingSyncCount = 0;
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
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

    fireEvent.click(screen.getByRole('button', { name: '訪問完了' }));

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

    fireEvent.click(screen.getByRole('button', { name: '訪問完了' }));

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

  it('keeps server messages and falls back for visit record save error toasts', async () => {
    const baseFetch = globalThis.fetch as typeof fetch;
    const responseMessages = ['訪問記録APIからの詳細エラー', ''];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/visit-records') {
          visitRecordPostBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(JSON.stringify({ message: responseMessages.shift() ?? '' }), {
            status: 500,
          });
        }
        return baseFetch(input, init);
      }),
    );

    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenLastCalledWith('訪問記録APIからの詳細エラー');
    });

    toastErrorMock.mockClear();
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenLastCalledWith('保存に失敗しました');
    });
    expect(visitRecordPostBodies).toHaveLength(2);
  });

  it('does not infer visit end time from form save alone', async () => {
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
    expect(visitRecordPostBodies[0]).not.toHaveProperty('visit_ended_at');
  });

  it('posts visit end time only after the explicit end action', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-09T02:30:00.000Z'));
    try {
      renderVisitRecordForm();

      await waitFor(() => {
        expect(
          (document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value,
        ).toBe('patient_1');
      });

      fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));
      vi.setSystemTime(new Date('2026-04-09T03:05:00.000Z'));
      fireEvent.click(screen.getByRole('button', { name: '訪問終了を記録' }));
      fireEvent.click(screen.getByRole('button', { name: '延期' }));
      fireEvent.submit(document.querySelector('form')!);

      await waitFor(() => {
        expect(visitRecordPostBodies).toHaveLength(1);
      });
      expect(visitRecordPostBodies[0]).toMatchObject({
        visit_started_at: '2026-04-09T02:30:00.000Z',
        visit_ended_at: '2026-04-09T03:05:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves a local draft immediately after explicit visit start and end actions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-09T02:30:00.000Z'));
    try {
      renderVisitRecordForm();

      await waitFor(() => {
        expect(
          (document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value,
        ).toBe('patient_1');
      });

      saveDraftMock.mockClear();
      fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));

      await waitFor(() => {
        expect(saveDraftMock).toHaveBeenCalledTimes(1);
      });
      expect(saveDraftMock.mock.calls[0]?.[2]).toMatchObject({
        visitStartedAt: '2026-04-09T02:30:00.000Z',
      });

      vi.setSystemTime(new Date('2026-04-09T03:05:00.000Z'));
      fireEvent.click(screen.getByRole('button', { name: '訪問終了を記録' }));

      await waitFor(() => {
        expect(saveDraftMock).toHaveBeenCalledTimes(2);
      });
      expect(saveDraftMock.mock.calls[1]?.[2]).toMatchObject({
        visitStartedAt: '2026-04-09T02:30:00.000Z',
        visitEndedAt: '2026-04-09T03:05:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
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
      wrapper: createQueryClientWrapper(),
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
    // header-summary query も同 helper を suffix 付きで呼ぶため、mockReturnValueOnce だと
    // そちらが先に消費する。suffix なし(反映 PATCH)だけ sentinel へ差し替える。
    const { buildPatientApiPath: actualBuildPatientApiPath } =
      await vi.importActual<typeof import('@/lib/patient/api-paths')>('@/lib/patient/api-paths');
    vi.mocked(buildPatientApiPath).mockImplementation((patientId: string, suffix = '') =>
      suffix === ''
        ? '/api/patients/__helper_reflect__'
        : actualBuildPatientApiPath(patientId, suffix),
    );
    try {
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
    } finally {
      vi.mocked(buildPatientApiPath).mockImplementation(actualBuildPatientApiPath);
    }
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
