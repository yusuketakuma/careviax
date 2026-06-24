// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';

const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Actual-backed spies so URL/header teeth prove helper adoption via return-value identity.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

import { CasesTab } from './cases-tab';

setupDomTestEnv();

type QueryOptions = {
  queryKey: unknown;
  queryFn?: () => unknown;
};

function buildPatient(overrides?: { patientId?: string; caseId?: string; status?: string }) {
  return {
    id: overrides?.patientId ?? 'patient_1',
    name: '山田花子',
    cases: [
      {
        id: overrides?.caseId ?? 'case_abcdef',
        status: overrides?.status ?? 'active',
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        referral_source: '居宅介護支援事業所',
        referral_date: '2026-06-01',
        start_date: '2026-06-02',
        end_date: null,
        end_reason: null,
        notes: '初回訪問を調整中',
        required_visit_support: null,
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
        care_team_links: [],
      },
    ],
  };
}

// CasesTab save/transition handlers are fire-and-forget onClick closures (not useMutation), so an
// exact-dot RangeError surfaces only as an unhandled rejection. Capture it at the process level
// (temporarily detaching Vitest's own listeners) so we can assert fail-before-fetch at the callsite.
async function captureUnhandledRejections(trigger: () => void): Promise<unknown[]> {
  const priorListeners = process.listeners('unhandledRejection');
  priorListeners.forEach((listener) => process.off('unhandledRejection', listener));
  const captured: unknown[] = [];
  const handler = (reason: unknown) => captured.push(reason);
  process.on('unhandledRejection', handler);
  try {
    trigger();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off('unhandledRejection', handler);
    priorListeners.forEach((listener) => process.on('unhandledRejection', listener));
  }
  return captured;
}

describe('CasesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] } });
  });

  it('renders case groups with semantic headings and grouped actions', () => {
    useQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: 'pharmacist_1',
            name: '佐藤薬剤師',
            site_name: '本店',
          },
        ],
      },
    });

    render(<CasesTab orgId="org_1" patient={buildPatient()} />);

    expect(screen.getByRole('button', { name: 'ケース追加' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'ケース #ABCDEF' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 3, name: 'ケース情報' }).tagName).toBe('H3');
    expect(screen.getByRole('button', { name: 'ケース情報を保存' })).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目の紹介元')).toBeTruthy();
    expect(screen.getByLabelText('主担当薬剤師')).toBeTruthy();
    expect(screen.getByText('居宅介護支援事業所')).toBeTruthy();
  });

  it('fetches the pharmacist roster with the org-header helper', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    let queryFn: (() => unknown) | undefined;
    useQueryMock.mockImplementation(({ queryFn: nextQueryFn }: QueryOptions) => {
      queryFn = nextQueryFn;
      return { data: { data: [] } };
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CasesTab orgId="org_1" patient={buildPatient()} />);
      await queryFn?.();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pharmacists');
      expect(init.headers).toBe(sentinelHeaders);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('creates a case with json helper headers, raw patient_id body, and raw-id invalidation', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const sentinelJsonHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelJsonHeaders);
    const invalidateQueries = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CasesTab orgId="org_1" patient={buildPatient({ patientId: hostilePatientId })} />);
      fireEvent.click(screen.getByRole('button', { name: 'ケース追加' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/cases');
      expect(init.method).toBe('POST');
      expect(init.headers).toBe(sentinelJsonHeaders);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      // raw hostile patient id stays verbatim in the JSON body
      expect(JSON.parse(init.body as string)).toEqual({ patient_id: hostilePatientId });

      // raw patient id flows into the invalidation key set (getPatientCareQueryKeys)
      await waitFor(() =>
        expect(invalidateQueries).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['patient', hostilePatientId, 'org_1'] }),
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves a case with a single-encoded caseId, json helper headers, and raw-id invalidation', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const hostileCaseId = 'case/9?a=b#c';
    const sentinelJsonHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelJsonHeaders);
    const invalidateQueries = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <CasesTab
          orgId="org_1"
          patient={buildPatient({ patientId: hostilePatientId, caseId: hostileCaseId })}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'ケース情報を保存' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/cases/case%2F9%3Fa%3Db%23c');
      expect(url).not.toContain('%25'); // single-encode
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinelJsonHeaders);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      // exact structured PATCH body (null pharmacist ids map to '', dates slice to YYYY-MM-DD);
      // also proves the raw caseId never leaks into the body
      expect(JSON.parse(init.body as string)).toEqual({
        primary_pharmacist_id: '',
        backup_pharmacist_id: '',
        referral_source: '居宅介護支援事業所',
        referral_date: '2026-06-01',
        start_date: '2026-06-02',
        end_date: '',
        end_reason: '',
        notes: '初回訪問を調整中',
      });
      expect(init.body as string).not.toContain(hostileCaseId);

      await waitFor(() =>
        expect(invalidateQueries).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['patient', hostilePatientId, 'org_1'] }),
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('transitions a case with a single-encoded caseId and json helper headers', async () => {
    const hostileCaseId = 'case/9?a=b#c';
    const sentinelJsonHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelJsonHeaders);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CasesTab orgId="org_1" patient={buildPatient({ caseId: hostileCaseId })} />);
      // active -> on_hold transition button opens the confirm dialog
      fireEvent.click(screen.getByRole('button', { name: '保留へ' }));
      fireEvent.click(await screen.findByRole('button', { name: '変更する' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/cases/case%2F9%3Fa%3Db%23c/transition');
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinelJsonHeaders);
      expect(JSON.parse(init.body as string)).toEqual({ from: 'active', to: 'on_hold' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'fails closed before any fetch when saving a case with the exact dot id %p',
    async (dotId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<CasesTab orgId="org_1" patient={buildPatient({ caseId: dotId })} />);
        const rejections = await captureUnhandledRejections(() => {
          fireEvent.click(screen.getByRole('button', { name: 'ケース情報を保存' }));
        });

        expect(rejections.some((reason) => reason instanceof RangeError)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(['.', '..'])(
    'fails closed before any fetch when transitioning a case with the exact dot id %p',
    async (dotId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<CasesTab orgId="org_1" patient={buildPatient({ caseId: dotId })} />);
        // active -> on_hold opens the confirm dialog; confirm triggers handleTransition(dotId)
        fireEvent.click(screen.getByRole('button', { name: '保留へ' }));
        const confirmButton = await screen.findByRole('button', { name: '変更する' });
        const rejections = await captureUnhandledRejections(() => {
          fireEvent.click(confirmButton);
        });

        expect(rejections.some((reason) => reason instanceof RangeError)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
