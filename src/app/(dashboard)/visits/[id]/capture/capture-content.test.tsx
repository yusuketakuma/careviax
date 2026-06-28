// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { EvidenceCaptureContent } from './capture-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const setupEvidenceAutoSyncMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/offline/evidence-drafts', () => ({
  saveEvidenceDraft: vi.fn(),
  setupEvidenceAutoSync: setupEvidenceAutoSyncMock,
  syncEvidenceDrafts: vi.fn(),
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
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('EvidenceCaptureContent', () => {
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
        return { ok: false, json: () => Promise.resolve({}) } as Response;
      }
      if (url === '/api/visit-records/visit_1') {
        return { ok: true, json: () => Promise.resolve({ patient_id: patientId }) } as Response;
      }
      if (url === '/api/patients/__helper_pt__') {
        return { ok: true, json: () => Promise.resolve({ name: '田中 一郎' }) } as Response;
      }
      return { ok: false, json: () => Promise.resolve({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<EvidenceCaptureContent visitId="visit_1" />);
      await expect(patientQueryFn?.()).resolves.toEqual({
        patientId,
        patientName: '田中 一郎',
        visitRecordId: 'visit_1',
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
});
