// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath, buildPatientDuplicateCheckApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildAdminFacilityUnitsApiPath } from '@/lib/facilities/api-paths';
import { buildOrgMembersApiPath } from '@/lib/org-members/api-paths';
import { PatientForm } from './patient-form';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const routerBackMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const allowNavigationMock = vi.hoisted(() => vi.fn());
// 実 hook は allowNavigation 関数を直接返す。mock も同形にする(分割代入しない)。
const unsavedGuardMock = vi.hoisted(() => vi.fn(() => allowNavigationMock));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBackMock,
    push: routerPushMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from 'sonner';

vi.mock('@/lib/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: unsavedGuardMock,
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return {
    ...actual,
    buildPatientApiPath: vi.fn(actual.buildPatientApiPath),
    buildPatientDuplicateCheckApiPath: vi.fn(actual.buildPatientDuplicateCheckApiPath),
  };
});

vi.mock('@/lib/facilities/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/facilities/api-paths')>();
  return {
    ...actual,
    buildAdminFacilityUnitsApiPath: vi.fn(actual.buildAdminFacilityUnitsApiPath),
  };
});

vi.mock('@/lib/org-members/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/org-members/api-paths')>();
  return {
    ...actual,
    buildOrgMembersApiPath: vi.fn(actual.buildOrgMembersApiPath),
  };
});

describe('PatientForm', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/patients/new');
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(buildOrgHeaders).mockClear();
    vi.mocked(buildOrgJsonHeaders).mockClear();
    vi.mocked(buildPatientHref).mockClear();
    vi.mocked(buildPatientApiPath).mockClear();
    vi.mocked(buildPatientDuplicateCheckApiPath).mockClear();
    vi.mocked(buildAdminFacilityUnitsApiPath).mockClear();
    vi.mocked(buildOrgMembersApiPath).mockClear();
  });

  function fillRequiredPatientFields() {
    fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
    fireEvent.change(screen.getByLabelText('フリガナ *'), { target: { value: 'ヤマダ タロウ' } });
    fireEvent.change(screen.getByLabelText('生年月日 *'), { target: { value: '1950-01-01' } });
    fireEvent.change(screen.getByLabelText('性別 *'), { target: { value: 'male' } });
  }

  it('shows a label-only summary while keeping field-level error messages after an empty submit', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });

    render(<PatientForm />);

    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(screen.getByText('必須の4項目を入力してください')).toBeTruthy();
    });

    const summary = document.getElementById('patient-form-error-summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('氏名');
    expect(screen.getByRole('tab', { name: '基本' }).getAttribute('data-active')).not.toBeNull();
    expect(screen.getByRole('tab', { name: '住所・保険' }).getAttribute('data-active')).toBeNull();
    expect(screen.queryByText('氏名：氏名は必須です')).toBeNull();
    expect(screen.getByText('氏名は必須です')).toBeTruthy();
    expect(screen.getByText('フリガナは必須です')).toBeTruthy();
  });

  it('groups edit fields into compact information tabs', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });

    render(<PatientForm />);

    expect(screen.getByRole('tab', { name: '基本' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '住所・保険' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '依頼元' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '訪問' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '生活・薬学' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '連携' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '住所・保険' }));

    expect(screen.getByText('連絡先・保険情報')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '生活・薬学' }));

    expect(screen.getByText('生活背景')).toBeTruthy();
    expect(screen.getByText('算定前提')).toBeTruthy();
    expect(screen.getByText('服薬支援')).toBeTruthy();
    expect(screen.getByText('医療処置')).toBeTruthy();
    expect(screen.getByLabelText('単一建物の医療患者数')).toBeTruthy();
    expect(screen.queryByText('在宅薬学総合体制加算2 関連確認')).toBeNull();
    expect(screen.queryByText('根拠確認日')).toBeNull();
    expect(screen.queryByText('レセプト摘要・確認メモ')).toBeNull();
  });

  it('opens the visit tab from a section query and field hash shortcut', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    window.history.replaceState(
      null,
      '',
      '/patients/patient_1/edit?section=visit#intake.parking_available',
    );

    render(<PatientForm patientId="patient_1" />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '訪問' }).getAttribute('data-active')).not.toBeNull();
    });
    expect(screen.getByLabelText('駐車スペース')).toBeTruthy();
  });

  it('opens the care tab from a section query and field hash shortcut', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    window.history.replaceState(
      null,
      '',
      '/patients/patient_1/edit?section=care#intake.care_level',
    );

    render(<PatientForm patientId="patient_1" />);

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: '生活・薬学' }).getAttribute('data-active'),
      ).not.toBeNull();
    });
    expect(screen.getByLabelText('介護認定')).toBeTruthy();
  });

  it('renders the patient-level care team selects in edit mode and pre-populates current assignments', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const key = options.queryKey[1];
      if (key === 'care-team-pharmacists') {
        return {
          data: [
            { id: 'ph1', name: '薬剤 太郎' },
            { id: 'ph2', name: '薬剤 次郎' },
          ],
          isLoading: false,
        };
      }
      if (key === 'care-team-staff') {
        return { data: [{ id: 'st1', name: '事務 花子' }], isLoading: false };
      }
      return { data: [], isLoading: false };
    });

    render(
      <PatientForm
        patientId="patient_1"
        defaultValues={{ primary_pharmacist_id: 'ph1', primary_staff_id: 'st1' }}
      />,
    );

    const careTeam = screen.getByTestId('patient-care-team');
    expect(careTeam).toBeTruthy();

    const primaryPharmacist = screen.getByLabelText('主担当薬剤師') as HTMLSelectElement;
    const backupPharmacist = screen.getByLabelText('副担当薬剤師') as HTMLSelectElement;
    const primaryStaff = screen.getByLabelText('主担当スタッフ') as HTMLSelectElement;
    const backupStaff = screen.getByLabelText('副担当スタッフ') as HTMLSelectElement;

    // 薬剤師候補は薬剤師クエリ、スタッフ候補はスタッフクエリから供給される。
    // 主/副の2 select に同じ候補が並ぶため複数一致する。
    expect(within(careTeam).getAllByText('薬剤 太郎').length).toBe(2);
    expect(within(careTeam).getAllByText('事務 花子').length).toBe(2);

    // 現在値で pre-populate され、未選択の副担当は空（'' での null 上書き=消失を防ぐ）。
    expect(primaryPharmacist.value).toBe('ph1');
    expect(primaryStaff.value).toBe('st1');
    expect(backupPharmacist.value).toBe('');
    expect(backupStaff.value).toBe('');
  });

  it('renders the care team selects in create mode so a team can be assigned at registration', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const key = options.queryKey[1];
      if (key === 'care-team-pharmacists') {
        return { data: [{ id: 'ph1', name: '薬剤 太郎' }], isLoading: false };
      }
      if (key === 'care-team-staff') {
        return { data: [{ id: 'st1', name: '事務 花子' }], isLoading: false };
      }
      return { data: [], isLoading: false };
    });

    render(<PatientForm />);

    const careTeam = screen.getByTestId('patient-care-team');
    expect(careTeam).toBeTruthy();
    // 候補は新規登録時も org メンバーから供給される（任意・未設定可）。
    expect(within(careTeam).getByLabelText('主担当薬剤師')).toBeTruthy();
    expect(within(careTeam).getByLabelText('主担当スタッフ')).toBeTruthy();
    expect(within(careTeam).getAllByText('薬剤 太郎').length).toBe(2);
    expect(within(careTeam).getAllByText('事務 花子').length).toBe(2);
  });

  it('surfaces care team fetch failures instead of showing empty member selects', () => {
    useOrgIdMock.mockReturnValue('org_1');
    const pharmacistsRefetch = vi.fn();
    const staffRefetch = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const key = options.queryKey[1];
      if (key === 'care-team-pharmacists') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('薬剤師一覧の取得に失敗しました'),
          refetch: pharmacistsRefetch,
        };
      }
      if (key === 'care-team-staff') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('スタッフ一覧の取得に失敗しました'),
          refetch: staffRefetch,
        };
      }
      return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<PatientForm />);

    const careTeam = screen.getByTestId('patient-care-team');
    expect(within(careTeam).getByText('薬剤師一覧の取得に失敗しました')).toBeTruthy();
    expect(within(careTeam).getByText('スタッフ一覧の取得に失敗しました')).toBeTruthy();

    const primaryPharmacist = within(careTeam).getByLabelText('主担当薬剤師') as HTMLSelectElement;
    const primaryStaff = within(careTeam).getByLabelText('主担当スタッフ') as HTMLSelectElement;
    expect(primaryPharmacist.disabled).toBe(true);
    expect(primaryPharmacist.options[0]?.text).toBe('薬剤師候補を取得できません');
    expect(primaryStaff.disabled).toBe(true);
    expect(primaryStaff.options[0]?.text).toBe('スタッフ候補を取得できません');

    const retryButtons = within(careTeam).getAllByRole('button', { name: '再試行' });
    fireEvent.click(retryButtons[0]);
    fireEvent.click(retryButtons[1]);
    expect(pharmacistsRefetch).toHaveBeenCalledTimes(1);
    expect(staffRefetch).toHaveBeenCalledTimes(1);
  });

  it('delegates patient-form lookup query paths and tenant headers to shared helpers', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    const queryConfigs: Array<{ queryKey: unknown[]; queryFn?: () => Promise<unknown> }> = [];
    useQueryMock.mockImplementation(
      (options: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        queryConfigs.push(options);
        return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
      },
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    render(<PatientForm />);

    for (const key of ['facilities', 'service-areas', 'care-team-pharmacists', 'care-team-staff']) {
      const query = queryConfigs.find((config) => config.queryKey[1] === key);
      await query?.queryFn?.();
    }

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/facilities', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/service-areas', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacists', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/org/members?eligible=staff', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(buildOrgHeaders).toHaveBeenCalledTimes(4);
    expect(buildOrgHeaders).toHaveBeenNthCalledWith(1, 'org_1');
    const staffParams = vi.mocked(buildOrgMembersApiPath).mock.calls[0]?.[0];
    expect(staffParams?.toString()).toBe('eligible=staff');
  });

  it('shows server-side duplicate candidates and resubmits with duplicate acknowledgement', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          message: '重複している可能性がある患者が存在します',
          details: {
            duplicate_type: 'patient_identity',
            duplicates: [
              {
                id: 'patient_existing',
                name: '山田 太郎',
                name_kana: 'ヤマダ タロウ',
                birth_date: '1950-01-01T00:00:00.000Z',
                gender: 'male',
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'patient_new' }),
      } as Response);

    render(<PatientForm />);
    fillRequiredPatientFields();

    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(screen.getByText('同名の患者が存在します:')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'それでも登録する' }));
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody).toMatchObject({
      name: '山田 太郎',
      duplicate_acknowledged: true,
    });
  });

  it('falls back when patient registration failure has an empty server message', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: '' }),
    } as Response);

    render(<PatientForm />);
    fillRequiredPatientFields();

    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('登録に失敗しました');
    });
  });

  it('submits edit PATCH through the shared patient API path with expected_updated_at', async () => {
    const hostilePatientId = 'pt/1?tab=x#frag';
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_pt__');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: hostilePatientId }),
    } as Response);

    render(
      <PatientForm
        patientId={hostilePatientId}
        defaultValues={{
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
        }}
        expectedUpdatedAt="2026-03-30T09:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(buildPatientApiPath).toHaveBeenCalledWith(hostilePatientId);
    expect(buildOrgJsonHeaders).toHaveBeenCalledWith('org_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/patients/__helper_pt__');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: '山田 太郎',
      expected_updated_at: '2026-03-30T09:00:00.000Z',
    });
    expect(url).not.toContain('?tab=x');
    expect(url).not.toContain('#frag');
  });

  it('runs qualification check from the current edit form through the shared patient API path', async () => {
    const hostilePatientId = 'pt/1?tab=x#frag';
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_pt__/qualification-check',
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          valid: true,
          identityMatch: 'matched',
          payerName: '東京健保',
          copayRatio: 0.1,
          warnings: [],
        },
      }),
    } as Response);

    render(
      <PatientForm
        patientId={hostilePatientId}
        defaultValues={{
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
          medical_insurance_number: '12345678',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '住所・保険' }));
    fireEvent.click(screen.getByRole('button', { name: '資格確認' }));

    await waitFor(() => {
      expect(screen.getByText('資格確認OK: 東京健保 / 負担割合 10%')).toBeTruthy();
    });
    expect(buildPatientApiPath).toHaveBeenCalledWith(hostilePatientId, '/qualification-check');
    expect(buildOrgHeaders).toHaveBeenCalledWith('org_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/patients/__helper_pt__/qualification-check');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-org-id': 'org_1' });
    expect(init.body).toBeUndefined();
    expect(url).not.toContain('?tab=x');
    expect(url).not.toContain('#frag');
  });

  it('surfaces qualification check failures near the insurance field instead of treating them as empty', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 501,
      json: async () => ({ message: 'オンライン資格確認はまだ有効化されていません' }),
    } as Response);

    render(
      <PatientForm
        patientId="patient_1"
        defaultValues={{
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '住所・保険' }));
    fireEvent.click(screen.getByRole('button', { name: '資格確認' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'オンライン資格確認はまだ有効化されていません',
      );
    });
  });

  it('encodes the selected facility id for the unit query before fetching', async () => {
    const hostileFacilityId = 'fac/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');
    const queryConfigs: Array<{ queryKey: unknown[]; queryFn?: () => Promise<unknown> }> = [];
    useQueryMock.mockImplementation(
      (options: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        queryConfigs.push(options);
        return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
      },
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    render(
      <PatientForm
        defaultValues={{
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
          facility_id: hostileFacilityId,
        }}
      />,
    );

    const facilityUnitsQuery = queryConfigs.find(
      (config) => config.queryKey[1] === 'facility-units',
    );
    expect(facilityUnitsQuery?.queryKey).toEqual([
      'patient-form',
      'facility-units',
      'org_1',
      hostileFacilityId,
    ]);

    await facilityUnitsQuery?.queryFn?.();

    expect(buildAdminFacilityUnitsApiPath).toHaveBeenCalledWith(hostileFacilityId);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/facilities/${encodeURIComponent(hostileFacilityId)}/units`);
    expect(url).not.toContain('?x=y');
    expect(url).not.toContain('#z');
    expect(init.headers).toMatchObject({ 'x-org-id': 'org_1' });
  });

  it.each(['.', '..'])(
    'fails closed without fetching facility units for exact dot-segment facility id %p',
    async (facilityId) => {
      useOrgIdMock.mockReturnValue('org_1');
      const queryConfigs: Array<{ queryKey: unknown[]; queryFn?: () => Promise<unknown> }> = [];
      useQueryMock.mockImplementation(
        (options: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
          queryConfigs.push(options);
          return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
        },
      );
      const fetchMock = vi.mocked(fetch);

      render(
        <PatientForm
          defaultValues={{
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            birth_date: '1950-01-01',
            gender: 'male',
            facility_id: facilityId,
          }}
        />,
      );

      const facilityUnitsQuery = queryConfigs.find(
        (config) => config.queryKey[1] === 'facility-units',
      );
      await expect(facilityUnitsQuery?.queryFn?.()).rejects.toThrow(RangeError);
      expect(buildAdminFacilityUnitsApiPath).toHaveBeenCalledWith(facilityId);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('surfaces facility unit fetch failures instead of showing an empty unit list', () => {
    useOrgIdMock.mockReturnValue('org_1');
    const refetch = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[1] === 'facility-units') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('ユニット一覧の取得に失敗しました'),
          refetch,
        };
      }
      return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <PatientForm
        defaultValues={{
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
          facility_id: 'fac_1',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '住所・保険' }));

    expect(screen.getByRole('alert').textContent).toContain('ユニット一覧の取得に失敗しました');
    expect(screen.queryByText(/この施設には登録済みユニットがありません/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces service area fetch failures instead of hiding visit coverage checks', () => {
    useOrgIdMock.mockReturnValue('org_1');
    const refetch = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[1] === 'service-areas') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('訪問エリア設定の取得に失敗しました'),
          refetch,
        };
      }
      return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <PatientForm
        defaultValues={{
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
          address: '東京都新宿区',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '住所・保険' }));

    expect(screen.getByRole('alert').textContent).toContain('訪問エリア設定の取得に失敗しました');
    expect(screen.queryByText(/登録住所が既存の訪問エリアに一致していません/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('guards unsaved changes while dirty and bypasses navigation on cancel', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    render(<PatientForm />);

    const lastEnabled = () => {
      const calls = unsavedGuardMock.mock.calls as unknown as Array<[{ enabled: boolean }]>;
      return calls.at(-1)?.[0]?.enabled;
    };
    // 初期(未変更)は guard 無効。
    expect(lastEnabled()).toBe(false);

    // 入力で dirty → guard 有効(離脱防止が効く)。
    fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
    expect(lastEnabled()).toBe(true);

    // キャンセルは離脱を許可(allowNavigation で bypass)してから戻る。
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(allowNavigationMock).toHaveBeenCalled();
    expect(routerBackMock).toHaveBeenCalled();
  });

  it('overlays a stepper: step 1 is registerable and 次へ/戻る move steps (tabs preserved)', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    render(<PatientForm />);

    // Step1 は基本のみで登録可能の明示 + 基本タブが現在ステップ(選択中)。
    expect(screen.getByText(/基本情報だけで登録できます/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: '基本', selected: true })).toBeTruthy();

    // 次へ: 住所・保険 で step2 を activate(Tabs を内部維持)。
    fireEvent.click(screen.getByRole('button', { name: /次へ: 住所・保険/ }));
    expect(screen.getByRole('tab', { name: '住所・保険', selected: true })).toBeTruthy();

    // 戻る で step1 に戻る。
    fireEvent.click(screen.getByRole('button', { name: '← 戻る' }));
    expect(screen.getByRole('tab', { name: '基本', selected: true })).toBeTruthy();
  });

  it('offers an open-existing-patient link in the duplicate alert (keeping それでも登録する)', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });
    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation((id: string) => `/patients/__sentinel_${id}__`);
    try {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          message: '重複',
          details: {
            duplicate_type: 'patient_identity',
            duplicates: [
              {
                id: 'patient_existing',
                name: '山田 太郎',
                name_kana: 'ヤマダ タロウ',
                birth_date: '1950-01-01T00:00:00.000Z',
                gender: 'male',
              },
            ],
          },
        }),
      } as Response);

      render(<PatientForm />);
      fillRequiredPatientFields();
      fireEvent.click(screen.getByRole('button', { name: '登録する' }));

      await waitFor(() => {
        expect(screen.getByText('同名の患者が存在します:')).toBeTruthy();
      });

      // 「それでも登録する」は維持。
      expect(screen.getByRole('button', { name: 'それでも登録する' })).toBeTruthy();
      // 「既存患者を開く」で患者詳細へ遷移。
      fireEvent.click(screen.getByRole('button', { name: '既存患者を開く' }));
      expect(routerPushMock).toHaveBeenCalledWith('/patients/__sentinel_patient_existing__');
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([['patient_existing']]);
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
    }
  });

  it('ignores a superseded duplicate-check response after the inputs change (stale race)', async () => {
    vi.useFakeTimers();
    try {
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockReturnValue({ data: [], isLoading: false });
      const fetchMock = vi.mocked(fetch);

      // 1本目の重複チェック: 後で stale なレスポンスを解決できるよう保留にする
      let resolveFirst: ((res: Response) => void) | undefined;
      let firstSignal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_url, init) => {
        firstSignal = (init as RequestInit | undefined)?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      });
      // 2本目以降は保留(解決しない)
      fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

      render(<PatientForm />);
      fillRequiredPatientFields();

      // 500ms デバウンス経過 → 1本目の checkDuplicate 発火
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(fetchMock).toHaveBeenCalled();
      expect(buildOrgHeaders).toHaveBeenCalledWith('org_1');
      const duplicateParams = vi.mocked(buildPatientDuplicateCheckApiPath).mock.calls[0]?.[0];
      expect(duplicateParams?.toString()).toBe(
        'name=%E5%B1%B1%E7%94%B0+%E5%A4%AA%E9%83%8E&date_of_birth=1950-01-01&gender=male',
      );
      expect(firstSignal?.aborted).toBe(false);

      // 入力変更 → 直前 effect の cleanup が controller.abort() を呼ぶ
      fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 次郎' } });
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(firstSignal?.aborted).toBe(true);

      // abort 後に 1本目の stale レスポンスを解決 → guard により setDuplicates されない
      await act(async () => {
        resolveFirst?.({
          ok: true,
          json: async () => ({
            duplicates: [
              {
                id: 'patient_stale',
                name: '山田 太郎',
                name_kana: 'ヤマダ タロウ',
                birth_date: '1950-01-01T00:00:00.000Z',
                gender: 'male',
              },
            ],
          }),
        } as Response);
        vi.advanceTimersByTime(0);
      });

      expect(screen.queryByText('同名の患者が存在します:')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
