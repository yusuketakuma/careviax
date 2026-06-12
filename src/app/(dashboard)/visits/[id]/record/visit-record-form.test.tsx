// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitRecordForm } from './visit-record-form';

const {
  routerBackMock,
  routerPushMock,
  loadDraftMock,
  saveDraftMock,
  clearDraftMock,
  setupAutoSyncMock,
  enqueueForSyncMock,
  syncOnlineStatusMock,
  refreshSyncStateMock,
  toastErrorMock,
  toastSuccessMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  routerBackMock: vi.fn(),
  routerPushMock: vi.fn(),
  loadDraftMock: vi.fn(),
  saveDraftMock: vi.fn(),
  clearDraftMock: vi.fn(),
  setupAutoSyncMock: vi.fn(),
  enqueueForSyncMock: vi.fn(),
  syncOnlineStatusMock: vi.fn(),
  refreshSyncStateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
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
  listEvidenceDraftSummaries: vi.fn(async () => []),
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
  CdsAlertPanel: () => null,
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
    refreshSyncStateMock.mockResolvedValue(undefined);

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/visit-schedules/schedule_partial') {
          return new Response(
            JSON.stringify({
              id: 'schedule_partial',
              patient_id: 'patient_1',
              cycle_id: null,
              scheduled_date: '2026-04-09',
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
          return new Response(JSON.stringify({ id: 'record_1', patient_id: 'patient_1' }), {
            status: 201,
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
