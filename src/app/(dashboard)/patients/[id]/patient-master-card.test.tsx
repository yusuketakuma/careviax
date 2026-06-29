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
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

import { PatientMasterCard } from './patient-master-card';

setupDomTestEnv();

function buildPatient(): Parameters<typeof PatientMasterCard>[0]['patient'] {
  return {
    id: 'patient_1',
    name: '山田花子',
    name_kana: 'ヤマダハナコ',
    birth_date: '1950-04-01T00:00:00.000Z',
    gender: 'female',
    phone: '090-0000-0000',
    medical_insurance_number: '123456',
    care_insurance_number: '987654',
    billing_support_flag: true,
    allergy_info: [{ drug_name: 'ペニシリン', category: 'drug', severity: 'severe' }],
    notes: '初回訪問前に家族へ連絡',
    residences: [
      {
        id: 'residence_1',
        address: '東京都千代田区1-1-1',
        building_id: '山田家',
        facility_id: null,
        facility_unit_id: null,
        unit_name: '101',
        is_primary: true,
      },
    ],
    cases: [],
  };
}

describe('PatientMasterCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    vi.mocked(buildPatientApiPath).mockImplementation((patientId, suffix = '') => {
      if (patientId === '.' || patientId === '..') {
        throw new RangeError('Patient id cannot be a dot segment');
      }
      return `/api/patients/${encodeURIComponent(patientId)}${suffix}`;
    });
  });

  it('groups patient master fields by information type with bordered sections', () => {
    render(<PatientMasterCard orgId="org_1" patient={buildPatient()} />);

    expect(screen.getByRole('heading', { level: 2, name: '患者マスタ' }).tagName).toBe('H2');

    for (const name of [
      'A. 基本属性',
      'B. 連絡・住所',
      'C. 保険',
      'D. アレルギー',
      'E. 補助メモ',
    ]) {
      const group = screen.getByRole('group', { name });
      expect(group.className).toContain('border-border/70');
      expect(group.className).toContain('rounded-2xl');
    }

    expect(screen.getByLabelText('性別')).toBeTruthy();
    expect(screen.getByLabelText('氏名')).toBeTruthy();
    expect(screen.getByLabelText('フリガナ')).toBeTruthy();
    expect(screen.getByLabelText('生年月日')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();
    expect(screen.getByLabelText('住所')).toBeTruthy();
    expect(screen.getByLabelText('施設')).toBeTruthy();
    expect(screen.getByLabelText('ユニット')).toBeTruthy();
    expect(screen.getByLabelText('同時訪問グループID')).toBeTruthy();
    expect(screen.getByLabelText('部屋番号等')).toBeTruthy();
    expect(screen.getByLabelText('医療保険番号')).toBeTruthy();
    expect(screen.getByLabelText('介護保険番号')).toBeTruthy();
    expect(screen.getByLabelText('アレルギー1件目の名称')).toBeTruthy();
    expect(screen.getByLabelText('アレルギー1件目の区分')).toBeTruthy();
    expect(screen.getByLabelText('アレルギー1件目の重症度')).toBeTruthy();
    const allergyDelete = screen.getByRole('button', { name: 'アレルギー1件目を削除' });
    expect(allergyDelete.getAttribute('aria-label')).not.toMatch(/山田|ペニシリン|123456|987654/);
    expect(screen.getByLabelText('患者メモ')).toBeTruthy();
  });

  it('shows allergy category/severity labels, not raw enums, in the closed select triggers', () => {
    // bare <SelectValue /> は category 'drug' / severity 'severe' の生 enum を初期表示で漏らす。
    // 明示 children で常に日本語ラベル('薬剤'/'重度')を表示することを固定する(SSR enum 漏れ封止)。
    render(<PatientMasterCard orgId="org_1" patient={buildPatient()} />);

    const categoryTrigger = screen.getByLabelText('アレルギー1件目の区分');
    expect(categoryTrigger.textContent).toContain('薬剤');
    expect(categoryTrigger.textContent).not.toContain('drug');

    const severityTrigger = screen.getByLabelText('アレルギー1件目の重症度');
    expect(severityTrigger.textContent).toContain('重度');
    expect(severityTrigger.textContent).not.toContain('severe');
  });

  type Patient = Parameters<typeof PatientMasterCard>[0]['patient'];
  type CapturedConfig = {
    queryKey?: unknown[];
    queryFn?: () => Promise<unknown>;
    mutationFn?: () => Promise<unknown>;
  };

  function buildPatientWith(overrides: { id?: string; facilityId?: string | null }): Patient {
    const base = buildPatient();
    return {
      ...base,
      id: overrides.id ?? base.id,
      residences: [
        {
          ...base.residences[0],
          facility_id: overrides.facilityId ?? null,
        },
      ],
    };
  }

  function captureConfigs() {
    const queryConfigs: CapturedConfig[] = [];
    const mutationConfigs: CapturedConfig[] = [];
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockImplementation((config: CapturedConfig) => {
      queryConfigs.push(config);
      return { data: { data: [] }, isLoading: false };
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

  it('fetches the static facilities list with org headers', async () => {
    const { queryConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientMasterCard orgId="org_1" patient={buildPatientWith({})} />);

      // facilitiesQuery is the first useQuery in the component.
      await queryConfigs[0]?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/facilities');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('encodes the facility id segment for the units query with org headers', async () => {
    const hostileFacilityId = 'fac/9?a=b#c';
    const { queryConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <PatientMasterCard
          orgId="org_1"
          patient={buildPatientWith({ facilityId: hostileFacilityId })}
        />,
      );

      // facilityUnitsQuery is the second useQuery; its key carries the raw selected facility id.
      expect(queryConfigs[1]?.queryKey).toEqual([
        'patient-master-facility-units',
        'org_1',
        hostileFacilityId,
      ]);
      await queryConfigs[1]?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/admin/facilities/${encodeURIComponent(hostileFacilityId)}/units`);
      expect(url).not.toContain('?a=b');
      expect(url).not.toContain('#c');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('encodes the patient id segment for the qualification-check POST with org headers', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <PatientMasterCard orgId="org_1" patient={buildPatientWith({ id: hostilePatientId })} />,
      );

      // qualificationCheckMutation is the first useMutation in the component.
      await mutationConfigs[0]?.mutationFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(hostilePatientId, '/qualification-check');
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostilePatientId)}/qualification-check`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('encodes the patient id segment for the PATCH save with JSON headers and no id leak in the body', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <PatientMasterCard orgId="org_1" patient={buildPatientWith({ id: hostilePatientId })} />,
      );

      // saveMutation is the second useMutation in the component.
      await mutationConfigs[1]?.mutationFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(hostilePatientId);
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostilePatientId)}`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
      const body = init.body as string;
      // the patient id lives only in the URL path, never in the PATCH payload.
      expect(body).not.toContain(hostilePatientId);
      expect(JSON.parse(body)).toMatchObject({ name: '山田花子', name_kana: 'ヤマダハナコ' });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patient id %p on qualification-check and save',
    async (dotId) => {
      const { mutationConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientMasterCard orgId="org_1" patient={buildPatientWith({ id: dotId })} />);

        await expect(mutationConfigs[0]?.mutationFn?.()).rejects.toThrow(RangeError);
        await expect(mutationConfigs[1]?.mutationFn?.()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment facility id %p on the units query',
    async (dotId) => {
      const { queryConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(
          <PatientMasterCard orgId="org_1" patient={buildPatientWith({ facilityId: dotId })} />,
        );

        await expect(queryConfigs[1]?.queryFn?.()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  function mockQueryErrorFor(errorKey: string, refetch: () => void) {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((config: CapturedConfig) => {
      if (config.queryKey?.[0] === errorKey) {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error(
            errorKey === 'patient-master-facilities'
              ? '施設マスターの取得に失敗しました'
              : 'ユニット一覧の取得に失敗しました',
          ),
          refetch,
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });
  }

  it('surfaces a retryable error instead of an empty facility dropdown when the facilities fetch fails', () => {
    // false-empty 封止: 取得失敗を空オプションに畳まず、エラー文言 + 再試行(refetch) を出す。
    const refetch = vi.fn();
    mockQueryErrorFor('patient-master-facilities', refetch);

    render(<PatientMasterCard orgId="org_1" patient={buildPatientWith({})} />);

    expect(screen.getByText('施設マスターの取得に失敗しました')).toBeTruthy();
    const retry = screen.getAllByRole('button', { name: '再試行' })[0];
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a retryable error instead of an empty unit dropdown when the units fetch fails', () => {
    const refetch = vi.fn();
    mockQueryErrorFor('patient-master-facility-units', refetch);

    render(<PatientMasterCard orgId="org_1" patient={buildPatientWith({ facilityId: 'fac_1' })} />);

    expect(screen.getByText('ユニット一覧の取得に失敗しました')).toBeTruthy();
    const retry = screen.getAllByRole('button', { name: '再試行' })[0];
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('routes patient API mutations through the shared patient API path helper return values', async () => {
    const patientId = 'patient_1';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath)
      .mockReturnValueOnce('/api/patients/__helper_patient__/qualification-check')
      .mockReturnValueOnce('/api/patients/__helper_patient__');

    try {
      render(<PatientMasterCard orgId="org_1" patient={buildPatientWith({ id: patientId })} />);

      await mutationConfigs[0]?.mutationFn?.();
      await mutationConfigs[1]?.mutationFn?.();

      expect(buildPatientApiPath).toHaveBeenNthCalledWith(1, patientId, '/qualification-check');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(2, patientId);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        '/api/patients/__helper_patient__/qualification-check',
      );
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/patients/__helper_patient__');
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/qualification-check`,
        expect.anything(),
      );
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}`, expect.anything());
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
