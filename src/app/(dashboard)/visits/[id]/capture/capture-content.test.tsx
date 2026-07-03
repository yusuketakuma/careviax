// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { jsonResponse } from '@/test/fetch-test-utils';
import { EvidenceCaptureContent } from './capture-content';

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

  it('does not persist evidence files without organization context', async () => {
    useOrgIdMock.mockReturnValue('');
    setupEvidenceAutoSyncMock.mockReturnValue(undefined);
    useQueryMock.mockReturnValue({ data: null, isPending: false, error: null });

    const { container } = render(
      <EvidenceCaptureContent
        visitId="visit_1"
        initialPatientContext={{
          patientId: 'patient_1',
          patientName: '田中 一郎',
          visitRecordId: null,
          visitRecordVersion: null,
          visitStartedAt: null,
          visitEndedAt: null,
        }}
      />,
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
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      patientQueryFn = config.queryFn;
      return { data: null, isPending: false, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/visit-schedules/visit_1') {
        return jsonResponse({}, 500);
      }
      if (url === '/api/visit-records/visit_1') {
        return jsonResponse({ patient_id: patientId });
      }
      if (url === '/api/patients/__helper_pt__') {
        return jsonResponse({ name: '田中 一郎' });
      }
      return jsonResponse({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);
      await expect(patientQueryFn?.()).resolves.toEqual({
        patientId,
        patientName: '田中 一郎',
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
    useQueryMock.mockReturnValue({
      data: {
        patientId: 'patient_1',
        patientName: '田中 一郎',
        visitRecordId: 'record_1',
        visitRecordVersion: 3,
        visitStartedAt: '2026-04-09T01:00:00.000Z',
        visitEndedAt: null,
      },
      isPending: false,
      error: null,
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
});
