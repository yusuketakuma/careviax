// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

import { PatientPackagingCard } from './patient-packaging-card';

setupDomTestEnv();

describe('PatientPackagingCard', () => {
  it('renders packaging settings with a semantic section heading and shared action row', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          packaging_profile: {
            default_packaging_method: 'medication_box',
            medication_box_color: '赤',
            notes: '朝だけ別包',
            special_instructions: '手渡し順に注意',
            cognitive_note: '飲み忘れ傾向あり',
            updated_at: '2026-06-01T10:00:00.000Z',
          },
          effective_summary: 'お薬BOX 赤',
        },
      },
      isLoading: false,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<PatientPackagingCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '配薬設定' }).tagName).toBe('H2');
    expect(screen.getByText('お薬BOX')).toBeTruthy();
    expect(screen.getByText('BOX色 赤')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('shows an error state instead of an empty editable form when settings fail to load', () => {
    const refetch = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<PatientPackagingCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByText('取得できません')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '配薬設定を表示できません' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByText('既定の配薬方法は未設定です')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  type CapturedConfig = {
    queryKey?: unknown[];
    queryFn?: () => Promise<unknown>;
    mutationFn?: () => Promise<unknown>;
  };

  function captureConfigs() {
    const queryConfigs: CapturedConfig[] = [];
    const mutationConfigs: CapturedConfig[] = [];
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockImplementation((config: CapturedConfig) => {
      queryConfigs.push(config);
      return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    });
    useMutationMock.mockImplementation((config: CapturedConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    return { queryConfigs, mutationConfigs };
  }

  function okFetch() {
    return vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
  }

  it('fetches packaging settings from an encoded patient path with org headers', async () => {
    const hostileId = 'pt/1?x=y#z';
    const { queryConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientPackagingCard patientId={hostileId} orgId="org_1" />);

      expect(queryConfigs[0]?.queryKey).toEqual(['patient-packaging', 'org_1', hostileId]);
      await queryConfigs[0]?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/packaging`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('saves packaging settings via PUT to an encoded path with JSON headers, preserving every non-empty field', async () => {
    const hostileId = 'pt/1?x=y#z';
    const mutationConfigs: CapturedConfig[] = [];
    const invalidateQueries = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    // non-empty server profile so the PUT body locks every field, not just EMPTY_FORM defaults.
    useQueryMock.mockReturnValue({
      data: {
        data: {
          packaging_profile: {
            default_packaging_method: 'medication_box',
            medication_box_color: '赤',
            notes: '朝だけ別包',
            special_instructions: '手渡し順に注意',
            cognitive_note: '飲み忘れ傾向あり',
            updated_at: '2026-06-01T10:00:00.000Z',
          },
          effective_summary: 'お薬BOX 赤',
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useMutationMock.mockImplementation((config: CapturedConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });

    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientPackagingCard patientId={hostileId} orgId="org_1" />);

      await mutationConfigs[0]?.mutationFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/packaging`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PUT');
      expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
      const body = init.body as string;
      // patient id lives only in the URL path; every non-empty packaging field is preserved verbatim.
      expect(body).not.toContain(hostileId);
      expect(JSON.parse(body)).toEqual({
        default_packaging_method: 'medication_box',
        medication_box_color: '赤',
        notes: '朝だけ別包',
        special_instructions: '手渡し順に注意',
        cognitive_note: '飲み忘れ傾向あり',
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes packaging reads and writes through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath)
      .mockReturnValueOnce('/api/patients/__helper_patient_1__/packaging')
      .mockReturnValueOnce('/api/patients/__helper_patient_1__/packaging');
    const { queryConfigs, mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientPackagingCard patientId={patientId} orgId="org_1" />);

      await queryConfigs[0]?.queryFn?.();
      await mutationConfigs[0]?.mutationFn?.();

      expect(buildPatientApiPath).toHaveBeenNthCalledWith(1, patientId, '/packaging');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(2, patientId, '/packaging');
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/patients/__helper_patient_1__/packaging', {
        headers: buildOrgHeaders('org_1'),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/patients/__helper_patient_1__/packaging', {
        method: 'PUT',
        headers: buildOrgJsonHeaders('org_1'),
        body: expect.any(String),
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}/packaging`, {
        headers: buildOrgHeaders('org_1'),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p on GET and PUT',
    async (dotId) => {
      const { queryConfigs, mutationConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientPackagingCard patientId={dotId} orgId="org_1" />);

        await expect(queryConfigs[0]?.queryFn?.()).rejects.toThrow(RangeError);
        await expect(mutationConfigs[0]?.mutationFn?.()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
