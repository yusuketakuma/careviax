// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

import { PatientCareTeamPanel } from './patient-care-team-panel';
import { toast } from 'sonner';

setupDomTestEnv();

describe('PatientCareTeamPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders care team editing with a semantic section heading and shared actions', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] } });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientCareTeamPanel
        patientId="patient_1"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            display_id: 'cc0000000777',
            status: 'active',
            care_team_links: [
              {
                id: 'link_1',
                external_professional_id: null,
                role: 'physician',
                name: '佐藤医師',
                organization_name: '千代田クリニック',
                department: '在宅診療',
                phone: '03-0000-0000',
                email: null,
                fax: null,
                address: null,
                is_primary: true,
                notes: '主治医',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '多職種連携先' }).tagName).toBe('H2');
    expect(screen.getByDisplayValue('佐藤医師')).toBeTruthy();
    expect(screen.getByDisplayValue('千代田クリニック')).toBeTruthy();
    expect(screen.getByText('ケース cc0000000777 / active')).toBeTruthy();
    expect(screen.queryByText('ケース 123456 / active')).toBeNull();
    expect(screen.getByLabelText('多職種連携先のケース')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の他職種マスター')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の役割')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の氏名')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の所属')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の部署')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の電話番号')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目のメール')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目のFAX')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の住所')).toBeTruthy();
    expect(screen.getByLabelText('多職種連携先1件目の連絡メモ')).toBeTruthy();
    const quickCreateButton = screen.getByRole('button', {
      name: '多職種連携先1件目の他職種マスターを新規登録',
    });
    const deleteButton = screen.getByRole('button', { name: '多職種連携先1件目を削除' });
    for (const button of [quickCreateButton, deleteButton]) {
      expect(button.getAttribute('aria-label')).not.toMatch(/佐藤|千代田|03-0000-0000|主治医/);
    }
    expect(screen.getByRole('button', { name: /行追加/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();

    fireEvent.click(quickCreateButton);

    expect(screen.getByLabelText('職種')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加の氏名')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加の所属')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加の部署')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加の電話')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加のメール')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加のFAX')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加の住所')).toBeTruthy();
    expect(screen.getByLabelText('他職種マスター追加のメモ')).toBeTruthy();
  });

  it('shows reliability warnings returned by the care-team save API', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] } });
    useMutationMock
      .mockReturnValueOnce({ mutate: vi.fn(), isPending: false })
      .mockImplementationOnce((config) => ({
        mutate: () =>
          config.onSuccess?.({
            warnings: [
              {
                code: 'CARE_TEAM_RELIABILITY_UNREADY',
                severity: 'warning',
                message: '緊急連絡先あり / 不足: 訪看、ケアマネ / 報告FAX未登録: 医師',
              },
            ],
          }),
        isPending: false,
      }));

    render(
      <PatientCareTeamPanel
        patientId="patient_1"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            care_team_links: [
              {
                id: 'link_1',
                external_professional_id: null,
                role: 'physician',
                name: '佐藤医師',
                organization_name: '千代田クリニック',
                department: '在宅診療',
                phone: '03-0000-0000',
                email: null,
                fax: null,
                address: null,
                is_primary: true,
                notes: '主治医',
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(toast.warning).toHaveBeenCalledWith(
      '緊急連絡先あり / 不足: 訪看、ケアマネ / 報告FAX未登録: 医師',
    );
  });

  it('shows when external professional master options are truncated', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: 'external_1',
            profession_type: 'nurse',
            name: '訪問 看護',
            organization_name: 'あおば訪看',
            department: null,
            phone: null,
            email: null,
            fax: null,
            address: null,
            notes: null,
          },
        ],
        total_count: 3,
        visible_count: 1,
        hidden_count: 2,
        truncated: true,
        count_basis: 'external_professionals',
      },
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientCareTeamPanel
        patientId="patient_1"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            care_team_links: [],
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        '他職種マスターの候補は先頭1件のみ表示中です。他2件は検索条件を絞って確認してください。',
      ),
    ).toBeTruthy();
  });

  type CapturedConfig = {
    queryKey?: unknown[];
    queryFn?: () => Promise<unknown>;
    mutationFn?: () => Promise<unknown>;
  };

  function buildCases() {
    return [
      {
        id: 'case_active_123456',
        display_id: 'cc0000000777',
        status: 'active' as const,
        care_team_links: [] as never[],
      },
    ];
  }

  function captureConfigs() {
    const queryConfigs: CapturedConfig[] = [];
    const mutationConfigs: CapturedConfig[] = [];
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockImplementation((config: CapturedConfig) => {
      queryConfigs.push(config);
      return { data: { data: [] } };
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

  it('fetches external professional options with org headers (static path)', async () => {
    const { queryConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientCareTeamPanel patientId="patient_1" orgId="org_1" cases={buildCases()} />);

      await queryConfigs[0]?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/admin/external-professionals');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('posts a quick-create master with JSON org headers (static path)', async () => {
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientCareTeamPanel patientId="patient_1" orgId="org_1" cases={buildCases()} />);

      // quickCreateMutation is the first useMutation in the component.
      await mutationConfigs[0]?.mutationFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/admin/external-professionals');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
      // body is the raw quick-create draft, preserved field-for-field by the slice.
      expect(JSON.parse(init.body as string)).toEqual({
        profession_type: 'physician',
        name: '',
        organization_name: '',
        department: '',
        phone: '',
        email: '',
        fax: '',
        address: '',
        notes: '',
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('saves the care team to an encoded patient path with JSON headers and a raw case_id body', async () => {
    const hostileId = 'pt/1?x=y#z';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientCareTeamPanel patientId={hostileId} orgId="org_1" cases={buildCases()} />);

      // saveMutation is the second useMutation in the component.
      await mutationConfigs[1]?.mutationFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/care-team`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PUT');
      expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
      const body = init.body as string;
      // patient id lives only in the URL path; the body is preserved exactly (raw case_id, empty links).
      expect(body).not.toContain(hostileId);
      expect(body).not.toContain('cc0000000777');
      expect(JSON.parse(body)).toEqual({ case_id: 'case_active_123456', links: [] });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes care-team saves through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/care-team',
    );
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientCareTeamPanel patientId={patientId} orgId="org_1" cases={buildCases()} />);

      await mutationConfigs[1]?.mutationFn?.();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/care-team');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/care-team', {
        method: 'PUT',
        headers: buildOrgJsonHeaders('org_1'),
        body: expect.any(String),
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}/care-team`, {
        method: 'PUT',
        headers: buildOrgJsonHeaders('org_1'),
        body: expect.any(String),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p on care-team save',
    async (dotId) => {
      const { mutationConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientCareTeamPanel patientId={dotId} orgId="org_1" cases={buildCases()} />);

        await expect(mutationConfigs[1]?.mutationFn?.()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it('surfaces a retryable error instead of silently empty professional options when the master fetch fails', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({ data: undefined, isError: true, refetch });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientCareTeamPanel
        patientId="patient_1"
        orgId="org_1"
        cases={[{ id: 'case_active_123456', status: 'active', care_team_links: [] }]}
      />,
    );

    expect(screen.getByText('他職種マスターを読み込めませんでした')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalled();
  });
});
