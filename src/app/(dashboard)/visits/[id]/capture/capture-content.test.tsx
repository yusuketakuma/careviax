// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { jsonResponse } from '@/test/fetch-test-utils';
import { EvidenceCaptureContent } from './capture-content';
import type { CapturePatientContext } from './capture.shared';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const saveEvidenceDraftMock = vi.hoisted(() => vi.fn());
const setupEvidenceAutoSyncMock = vi.hoisted(() => vi.fn());
const syncEvidenceDraftsMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const clientLogWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/offline/evidence-drafts', () => ({
  saveEvidenceDraft: saveEvidenceDraftMock,
  setupEvidenceAutoSync: setupEvidenceAutoSyncMock,
  syncEvidenceDrafts: syncEvidenceDraftsMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

describe('EvidenceCaptureContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function capturePatientContext(
    overrides: Partial<CapturePatientContext> = {},
  ): CapturePatientContext {
    return {
      patientId: 'patient_1',
      patientName: '田中 一郎',
      visitDateTimeLabel: '4月9日 10:00',
      visitRecordId: null,
      visitRecordVersion: null,
      visitStartedAt: null,
      visitEndedAt: null,
      ...overrides,
    };
  }

  function mockCaptureQueries({
    patientContext = capturePatientContext(),
    patientPending = false,
    patientError = false,
    safetyPending = false,
    safetyError = false,
    safetyTags = ['allergy'],
    hiddenSafetyTagCount = 0,
  }: {
    patientContext?: CapturePatientContext | null;
    patientPending?: boolean;
    patientError?: boolean;
    safetyPending?: boolean;
    safetyError?: boolean;
    safetyTags?: string[];
    hiddenSafetyTagCount?: number;
  } = {}) {
    useQueryMock.mockImplementation(
      (config: { queryKey?: readonly unknown[]; queryFn?: () => Promise<unknown> }) => {
        if (config.queryKey?.[0] === 'patient-header-summary') {
          return {
            data: safetyError
              ? undefined
              : {
                  tags: safetyTags,
                  hiddenCount: hiddenSafetyTagCount,
                },
            isPending: safetyPending,
            isError: safetyError,
            error: safetyError ? new Error('safety unavailable') : null,
          };
        }
        return {
          data: patientContext,
          isPending: patientPending,
          isError: patientError,
          error: patientError ? new Error('patient unavailable') : null,
        };
      },
    );
  }

  it('does not persist evidence files without organization context', async () => {
    useOrgIdMock.mockReturnValue('');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({ patientContext: null });

    const { container } = render(
      <EvidenceCaptureContent visitId="visit_1" initialPatientContext={capturePatientContext()} />,
    );
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input!, {
      target: {
        files: [new File(['photo'], 'visit-photo.jpg', { type: 'image/jpeg' })],
      },
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '組織情報を取得できませんでした。再読み込みしてから撮影してください。',
      );
    });
    expect(saveEvidenceDraftMock).not.toHaveBeenCalled();
    expect(syncEvidenceDraftsMock).not.toHaveBeenCalled();
  });

  it('keeps evidence-save failures PHI-safe', async () => {
    const poisonError = new Error('患者Aの証跡写真 / 090-1234-5678 / token=secret');
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    saveEvidenceDraftMock.mockRejectedValue(poisonError);
    mockCaptureQueries();

    const { container } = render(<EvidenceCaptureContent visitId="visit_1" />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input!, {
      target: {
        files: [new File(['photo'], 'visit-photo.jpg', { type: 'image/jpeg' })],
      },
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenLastCalledWith('写真を保存できませんでした');
    });
    expect(clientLogWarnMock).toHaveBeenLastCalledWith(
      'visit_capture.evidence_save_failed',
      poisonError,
      {
        route: '/visits/[id]/capture',
        entityType: 'visit_evidence',
        code: 'VISIT_EVIDENCE_CAPTURE_SAVE_FAILED',
      },
    );
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonError.message);
  });

  it('unwraps the schedule detail data envelope before resolving patient context', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    let patientQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey?: readonly unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey?.[0] === 'visit-capture-patient') patientQueryFn = config.queryFn;
        return { data: null, isPending: false, isError: false, error: null };
      },
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/visit-schedules/visit_1') {
        return jsonResponse({
          data: {
            patient_id: 'patient_1',
            scheduled_date: '2026-04-09T00:00:00.000Z',
            time_window_start: '1970-01-01T10:00:00.000Z',
            case_: { patient: { name: '田中 一郎' } },
            visit_record: null,
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);
      await expect(patientQueryFn?.()).resolves.toMatchObject({
        patientId: 'patient_1',
        patientName: '田中 一郎',
      });
      expect(fetchMock).not.toHaveBeenCalledWith('/api/visit-records/visit_1', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back after a mixed-root schedule response and uses the shared patient path helper', async () => {
    const patientId = 'pt/1?tab=x#frag';
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_pt__');

    let patientQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey?: readonly unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey?.[0] === 'visit-capture-patient') {
          patientQueryFn = config.queryFn;
        }
        return { data: null, isPending: false, isError: false, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/visit-schedules/visit_1') {
        return jsonResponse({ data: { patient_id: 'wrong_patient' }, legacy_patient_id: true });
      }
      if (url === '/api/visit-records/visit_1') {
        return jsonResponse({ data: { patient_id: patientId } });
      }
      if (url === '/api/patients/__helper_pt__') {
        return jsonResponse({ data: { id: patientId, name: '田中 一郎' } });
      }
      return jsonResponse({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);
      await expect(patientQueryFn?.()).resolves.toEqual({
        patientId,
        patientName: '田中 一郎',
        visitDateTimeLabel: null,
        visitRecordId: 'visit_1',
        visitRecordVersion: null,
        visitStartedAt: null,
        visitEndedAt: null,
      });

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId);
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_pt__', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}`, expect.anything());
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('keeps the shared patient-header query cache on the full API summary shape', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    const headerSummary = {
      patient_id: 'patient_1',
      name: '田中 一郎',
      safety: {
        visible_safety_tags: ['allergy'],
        hidden_safety_tag_count: 1,
      },
    };
    let safetyQueryFn: (() => Promise<unknown>) | undefined;
    let safetyQueryKey: readonly unknown[] | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey?: readonly unknown[]; queryFn?: () => Promise<unknown> }) => {
        if (config.queryKey?.[0] === 'patient-header-summary') {
          safetyQueryFn = config.queryFn;
          safetyQueryKey = config.queryKey;
          return { data: undefined, isPending: true, isError: false, error: null };
        }
        return {
          data: capturePatientContext(),
          isPending: false,
          isError: false,
          error: null,
        };
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => jsonResponse({ data: headerSummary })),
    );

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);

      await expect(safetyQueryFn?.()).resolves.toEqual({ tags: ['allergy'], hiddenCount: 1 });
      expect(safetyQueryKey).toEqual(['patient-header-summary', 'patient_1', 'org_1']);
      expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1', '/header-summary');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('records visit end through PATCH only when the visit record version and start are known', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({
      patientContext: capturePatientContext({
        visitRecordId: 'record_1',
        visitRecordVersion: 3,
        visitStartedAt: '2026-04-09T01:00:00.000Z',
        visitEndedAt: null,
      }),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-09T01:45:00.000Z'));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/visit-records/record_1' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toMatchObject({
          version: 3,
          visit_ended_at: '2026-04-09T01:45:00.000Z',
        });
        return jsonResponse({
          data: {
            id: 'record_1',
            version: 4,
            visit_started_at: '2026-04-09T01:00:00.000Z',
            visit_ended_at: '2026-04-09T01:45:00.000Z',
          },
        });
      }
      return jsonResponse({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);
      fireEvent.click(screen.getByRole('button', { name: '訪問終了を記録' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/visit-records/record_1',
          expect.objectContaining({ method: 'PATCH' }),
        );
      });
      expect(toastSuccessMock).toHaveBeenCalledWith('訪問終了を記録しました');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('keeps visit-end failures PHI-safe', async () => {
    const poisonMessage = '患者Aの訪問終了 / 090-1234-5678 / token=secret';
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({
      patientContext: capturePatientContext({
        visitRecordId: 'record_1',
        visitRecordVersion: 3,
        visitStartedAt: '2026-04-09T01:00:00.000Z',
        visitEndedAt: null,
      }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ message: poisonMessage }), { status: 500 }),
      ),
    );

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);
      fireEvent.click(screen.getByRole('button', { name: '訪問終了を記録' }));

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenLastCalledWith('訪問終了を記録できませんでした');
      });
      expect(clientLogWarnMock).toHaveBeenLastCalledWith(
        'visit_capture.visit_end_failed',
        expect.any(Error),
        {
          route: '/visits/[id]/capture',
          entityType: 'visit_record',
          code: 'VISIT_CAPTURE_END_RECORD_FAILED',
        },
      );
      expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonMessage);
      expect(
        JSON.stringify(clientLogWarnMock.mock.calls.map(([, , context]) => context)),
      ).not.toContain(poisonMessage);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pins patient identity, visit time, and safety tags in the capture header', () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({
      patientContext: capturePatientContext({ visitDateTimeLabel: '4月9日 10:00' }),
      safetyTags: ['allergy'],
      hiddenSafetyTagCount: 1,
    });

    render(<EvidenceCaptureContent visitId="visit_1" />);

    expect(screen.getByTestId('capture-patient-safety-header')).toBeTruthy();
    expect(screen.getByTestId('capture-patient-name').textContent).toContain('田中 一郎 様');
    expect(screen.getByTestId('capture-patient-name').textContent).toContain('4月9日 10:00');
    expect(screen.getByTestId('visit-header-safety-tags').textContent).toContain('アレルギー');
    expect(screen.getByTestId('visit-header-safety-tags').textContent).toContain('+1');
  });

  it('fails closed while safety tags are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({ safetyPending: true });

    render(<EvidenceCaptureContent visitId="visit_1" />);

    expect(screen.getByTestId('capture-safety-loading').textContent).toContain('安全タグを確認中');
    expect(screen.getByTestId('capture-shutter')).toHaveProperty('disabled', true);
    expect(screen.getByText(/患者安全情報を確認中のため撮影できません/)).toBeTruthy();
  });

  it('fails closed when safety tags cannot be loaded', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({ safetyError: true });

    const { container } = render(<EvidenceCaptureContent visitId="visit_1" />);

    expect(screen.getByTestId('visit-header-safety-unavailable').textContent).toContain(
      '安全タグを取得できません',
    );
    expect(screen.getByTestId('capture-shutter')).toHaveProperty('disabled', true);
    expect(screen.getByText(/患者安全情報を確認できないため撮影できません/)).toBeTruthy();

    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [new File(['photo'], 'visit-photo.jpg', { type: 'image/jpeg' })],
      },
    });
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '患者安全情報を確認できないため撮影できません。通信状態を確認して再読み込みしてください。',
      );
    });
    expect(saveEvidenceDraftMock).not.toHaveBeenCalled();
  });

  it('disables the shutter and prevents evidence persistence when the patient is unresolved', () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({
      patientContext: capturePatientContext({ patientId: null, patientName: null }),
    });

    render(<EvidenceCaptureContent visitId="visit_1" />);

    const shutter = screen.getByTestId('capture-shutter');
    expect(shutter).toHaveProperty('disabled', true);
    expect(shutter.getAttribute('aria-describedby')).toBe('capture-shutter-disabled-reason');
    expect(screen.getByText('患者情報を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/患者情報を確認できないため撮影できません/)).toBeTruthy();
    fireEvent.click(shutter);
    expect(saveEvidenceDraftMock).not.toHaveBeenCalled();
  });
});
