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
    safetyError = false,
    safetyTags = ['allergy'],
    hiddenSafetyTagCount = 0,
  }: {
    patientContext?: CapturePatientContext | null;
    patientPending?: boolean;
    patientError?: boolean;
    safetyError?: boolean;
    safetyTags?: string[];
    hiddenSafetyTagCount?: number;
  } = {}) {
    useQueryMock.mockImplementation(
      (config: { queryKey?: readonly unknown[]; queryFn?: () => Promise<unknown> }) => {
        if (config.queryKey?.[0] === 'visit-capture-patient-safety') {
          return {
            data: safetyError
              ? undefined
              : {
                  safety: {
                    visible_safety_tags: safetyTags,
                    hidden_safety_tag_count: hiddenSafetyTagCount,
                  },
                },
            isPending: false,
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

  it('routes fallback patient detail fetches through the shared patient API path helper', async () => {
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
        return jsonResponse({}, 500);
      }
      if (url === '/api/visit-records/visit_1') {
        return jsonResponse({ patient_id: patientId });
      }
      if (url === '/api/patients/__helper_pt__') {
        return jsonResponse({ data: { name: '田中 一郎' } });
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
        return jsonResponse({ visit_ended_at: '2026-04-09T01:45:00.000Z' });
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

  it('fails closed when safety tags cannot be loaded', () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    mockCaptureQueries({ safetyError: true });

    render(<EvidenceCaptureContent visitId="visit_1" />);

    expect(screen.getByTestId('visit-header-safety-unavailable').textContent).toContain(
      '安全タグを取得できません',
    );
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
