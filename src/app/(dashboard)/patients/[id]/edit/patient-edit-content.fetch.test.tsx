// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const patientFormMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/features/patients/patient-form', () => ({
  PatientForm: (props: unknown) => {
    patientFormMock(props);
    return <div>patient form</div>;
  },
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

import { PatientEditContent } from './patient-edit-content';

setupDomTestEnv();

function buildPatientEditPayload(patientId = 'patient_1') {
  return {
    id: patientId,
    name: '患者',
    name_kana: 'カンジャ',
    birth_date: '1980-01-01T00:00:00.000Z',
    gender: 'male',
    phone: null,
    medical_insurance_number: null,
    care_insurance_number: null,
    billing_support_flag: false,
    allergy_info: null,
    notes: null,
    updated_at: '2026-03-30T09:00:00.000Z',
    primary_pharmacist_id: null,
    backup_pharmacist_id: null,
    primary_staff_id: null,
    backup_staff_id: null,
    residences: [],
    cases: [],
    intake_edit_target: null,
    intake_edit_snapshot: null,
    scheduling_preference: null,
    workspace: { unused: 'must-not-enter-patient-edit-cache' },
  };
}

describe('PatientEditContent patient overview fetch', () => {
  it('shows a patient-edit skeleton instead of a generic spinner while loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<PatientEditContent patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '患者編集フォームを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('patient form')).toBeNull();
    expect(patientFormMock).not.toHaveBeenCalled();
  });

  it('separates a failed overview read from a missing patient and offers retry', () => {
    const refetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('患者名を含む生のサーバー詳細'),
      refetch,
    });

    render(<PatientEditContent patientId="patient_1" />);

    expect(screen.getByText('患者情報を表示できません')).toBeTruthy();
    expect(
      screen.getByText(/患者情報の取得に失敗しました。\s*通信状態を確認して再試行してください。/),
    ).toBeTruthy();
    expect(screen.queryByText('患者情報が見つかりません')).toBeNull();
    expect(screen.queryByText('患者名を含む生のサーバー詳細')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows not-found only when the overview has no data and no read error', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientEditContent patientId="patient_1" />);

    expect(screen.getByText('患者情報が見つかりません')).toBeTruthy();
    expect(screen.queryByText('患者情報を表示できません')).toBeNull();
  });

  it('routes patient overview reads through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/overview',
    );
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: buildPatientEditPayload(patientId) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientEditContent patientId={patientId} />);

      expect(captured?.queryKey).toEqual(['patient-overview', patientId, 'org_1']);
      expect(captured).toMatchObject({
        enabled: true,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      });

      await captured?.queryFn?.();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/overview');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/overview', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}/overview`, {
        headers: { 'x-org-id': 'org_1' },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes the successful edit redirect through the shared patient href helper', () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_patient_1__');
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        name: '患者',
        name_kana: 'カンジャ',
        birth_date: '1980-01-01T00:00:00.000Z',
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        allergy_info: null,
        notes: null,
        updated_at: '2026-03-30T09:00:00.000Z',
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        primary_staff_id: null,
        backup_staff_id: null,
        residences: [],
        cases: [],
        intake_edit_target: null,
        intake_edit_snapshot: null,
        scheduling_preference: null,
      },
      isLoading: false,
      error: null,
    });

    render(<PatientEditContent patientId={patientId} />);

    expect(buildPatientHref).toHaveBeenCalledWith(patientId);
    expect(patientFormMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId,
        redirectTo: '/patients/__helper_patient_1__',
        expectedUpdatedAt: '2026-03-30T09:00:00.000Z',
      }),
    );
    expect(patientFormMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo: `/patients/${patientId}`,
      }),
    );
  });

  it('refreshes exact Patient and canonical CareCase authority for OCC recovery', async () => {
    const initial = buildPatientEditPayload();
    const refreshed = {
      ...initial,
      updated_at: '2026-03-30T10:00:00.000Z',
      cases: [{ id: 'case_2', required_visit_support: null }],
      intake_edit_target: {
        care_case_id: 'case_2',
        expected_care_case_version: 9,
      },
      intake_edit_snapshot: {
        care_case_id: 'case_2',
        required_visit_support: null,
      },
    };
    const refetch = vi.fn().mockResolvedValue({ isSuccess: true, data: refreshed });
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: initial, isLoading: false, error: null, refetch });

    render(<PatientEditContent patientId="patient_1" />);

    const props = patientFormMock.mock.calls.at(-1)?.[0] as {
      onRefreshConcurrencyAuthority?: (context: {
        patientId: string;
        conflictType: 'stale_patient';
      }) => Promise<unknown>;
    };
    await expect(
      props.onRefreshConcurrencyAuthority?.({
        patientId: 'patient_1',
        conflictType: 'stale_patient',
      }),
    ).resolves.toEqual({
      expectedUpdatedAt: '2026-03-30T10:00:00.000Z',
      selectedCareCase: { id: 'case_2', version: 9 },
    });
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps hostile patient ids encoded in the URL path segment only', async () => {
    const hostileId = 'pt/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: buildPatientEditPayload(hostileId) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientEditContent patientId={hostileId} />);

      expect(captured?.queryKey).toEqual(['patient-overview', hostileId, 'org_1']);

      await captured?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/overview`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual({ 'x-org-id': 'org_1' });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');

      let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured = config;
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientEditContent patientId={dotId} />);
        await expect(captured?.queryFn?.()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it('keeps API messages from failed patient overview reads', async () => {
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: '患者編集APIからの詳細エラー' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientEditContent patientId="patient_1" />);

      await expect(captured?.queryFn?.()).rejects.toThrow('患者編集APIからの詳細エラー');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('retains only fields consumed by patient edit defaults', async () => {
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      captured = config;
      return { data: undefined, isLoading: true, error: null };
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: buildPatientEditPayload(),
        }),
      ),
    );

    try {
      render(<PatientEditContent patientId="patient_1" />);
      await expect(captured?.queryFn?.()).resolves.toEqual({
        id: 'patient_1',
        name: '患者',
        name_kana: 'カンジャ',
        birth_date: '1980-01-01T00:00:00.000Z',
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        allergy_info: null,
        notes: null,
        updated_at: '2026-03-30T09:00:00.000Z',
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        primary_staff_id: null,
        backup_staff_id: null,
        residences: [],
        cases: [],
        intake_edit_target: null,
        intake_edit_snapshot: null,
        scheduling_preference: null,
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each([
    [
      'mixed root fields',
      () => ({ data: buildPatientEditPayload(), legacy_patient: buildPatientEditPayload() }),
    ],
    ['unexpected overview patient', () => ({ data: buildPatientEditPayload('another_patient') })],
    [
      'invalid patient gender',
      () => ({ data: { ...buildPatientEditPayload(), gender: 'unknown' } }),
    ],
  ])('rejects malformed patient edit 2xx payloads: %s', async (_label, buildPayload) => {
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      captured = config;
      return { data: undefined, isLoading: true, error: null };
    });

    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(buildPayload())));

    try {
      render(<PatientEditContent patientId="patient_1" />);
      await expect(captured?.queryFn?.()).rejects.toThrow('患者情報の取得に失敗しました');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
