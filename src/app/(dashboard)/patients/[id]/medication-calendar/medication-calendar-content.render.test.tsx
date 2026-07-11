// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

import { MedicationCalendarContent } from './medication-calendar-content';

setupDomTestEnv();

const PROVIDER_PROFILE = {
  id: 'profile_1',
  org_id: 'org_1',
  patient_id: 'patient_1',
  drug_master_id: null,
  drug_name: 'アムロジピン錠5mg',
  dose: '1錠',
  frequency: '毎朝食後',
  start_date: '2026-04-01T00:00:00.000Z',
  end_date: null,
  prescriber: null,
  is_current: true,
  source: 'manual',
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

const CONSUMED_PROFILE = {
  id: 'profile_1',
  drug_name: 'アムロジピン錠5mg',
  dose: '1錠',
  frequency: '毎朝食後',
  start_date: '2026-04-01T00:00:00.000Z',
  end_date: null,
};

describe('MedicationCalendarContent states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('shows a calendar-shape skeleton (not a spinner phrase) while loading', () => {
    useQueryMock.mockReturnValue({ isLoading: true, error: null, data: undefined });

    render(<MedicationCalendarContent patientId="patient_1" />);

    expect(screen.getByTestId('medication-calendar-loading')).toBeTruthy();
    // 旧スピナー文言で偽の空表示にしない。
    expect(screen.queryByText('服薬カレンダーを読み込んでいます...')).toBeNull();
  });

  it('surfaces fetch failure with a tokenized alert + retry, not a raw error string', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      isLoading: false,
      error: new Error('raw-internal-detail'),
      data: undefined,
      refetch,
    });

    render(<MedicationCalendarContent patientId="patient_1" />);

    const alert = screen.getByTestId('medication-calendar-error');
    expect(alert.getAttribute('role')).toBe('alert');
    // 固定コピーで raw error 文字列を露出しない。
    expect(alert.textContent).toContain('服薬カレンダーを取得できませんでした');
    expect(alert.textContent).not.toContain('raw-internal-detail');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('treats no current medications as a distinct empty state (not a failure)', () => {
    useQueryMock.mockReturnValue({ isLoading: false, error: null, data: { data: [] } });

    render(<MedicationCalendarContent patientId="patient_1" />);

    expect(screen.queryByTestId('medication-calendar-error')).toBeNull();
    expect(screen.getByText(/現在の服薬情報が登録されていません/)).toBeTruthy();
  });

  it('keeps medication names at the text-xs minimum in screen and print calendars', () => {
    const medicationName = 'アムロジピン錠5mg「安全確認用」';
    useQueryMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        data: [
          {
            id: 'medication_1',
            drug_name: medicationName,
            dose: '1錠',
            frequency: '毎朝食後',
            start_date: '2020-01-01',
            end_date: '2030-12-31',
          },
        ],
      },
    });

    render(<MedicationCalendarContent patientId="patient_1" />);

    const renderedNames = screen.getAllByText(`${medicationName} 1錠`);
    expect(renderedNames.length).toBeGreaterThan(0);
    for (const name of renderedNames) {
      expect(name.className).toContain('text-xs');
      expect(name.className).toContain('leading-5');
      expect(name.className).not.toContain('text-[10px]');
    }

    const calendar = screen.getByRole('grid', { name: /服薬カレンダー/ });
    expect(calendar.className).toContain('text-xs');
    expect(calendar.className).toContain('print:text-xs');
    expect(calendar.className).not.toContain('print:text-[9px]');
  });

  it('encodes the medication profile query and calendar PDF href at URL boundaries', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: [],
        meta: { limit: 100, has_more: false, next_cursor: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/medication-calendar/pdf',
    );
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation((options) => {
      capturedQueryFn = options.queryFn;
      return { isLoading: false, error: null, data: { data: [] } };
    });

    render(<MedicationCalendarContent patientId="patient_1?x=1#frag" />);
    await capturedQueryFn?.();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/medication-profiles?patient_id=patient_1%3Fx%3D1%23frag&is_current=true&limit=100',
      { headers: { 'x-org-id': 'org_1' } },
    );
    expect(buildPatientApiPath).toHaveBeenCalledWith(
      'patient_1?x=1#frag',
      '/medication-calendar/pdf',
    );
    const pdfHref = screen
      .getByRole('link', { name: /服薬カレンダーPDFを開く/ })
      .getAttribute('href');
    expect(pdfHref).toMatch(
      /^\/api\/patients\/__helper_patient_1__\/medication-calendar\/pdf\?month=\d{4}-\d{2}$/,
    );
    expect(pdfHref).not.toContain('patient_1?x=1#frag');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/medication-profiles?patient_id=patient_1?x=1#frag&is_current=true&limit=100',
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });

  it('uses fixed recovery copy when medication profile lookup fetch fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: '服薬中薬剤を表示できません' }, 403),
    );
    vi.stubGlobal('fetch', fetchMock);
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation((options) => {
      capturedQueryFn = options.queryFn;
      return { isLoading: false, error: null, data: { data: [] } };
    });

    render(<MedicationCalendarContent patientId="patient_1" />);

    await expect(capturedQueryFn?.()).rejects.toThrow('服薬中薬剤の取得に失敗しました');
    await expect(capturedQueryFn?.()).rejects.not.toThrow('服薬中薬剤を表示できません');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/medication-profiles?patient_id=patient_1&is_current=true&limit=100',
      { headers: { 'x-org-id': 'org_1' } },
    );

    vi.unstubAllGlobals();
  });

  it('aggregates cursor pages and strips unconsumed medication profile fields', async () => {
    const secondProviderProfile = {
      ...PROVIDER_PROFILE,
      id: 'profile_2',
      drug_name: 'フロセミド錠20mg',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [PROVIDER_PROFILE],
          meta: { limit: 100, has_more: true, next_cursor: 'profile_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [secondProviderProfile],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation((options) => {
      capturedQueryFn = options.queryFn;
      return { isLoading: false, error: null, data: { data: [] } };
    });

    try {
      render(<MedicationCalendarContent patientId="patient_1" />);
      const payload = await capturedQueryFn?.();

      expect(payload).toEqual({
        data: [
          CONSUMED_PROFILE,
          { ...CONSUMED_PROFILE, id: 'profile_2', drug_name: 'フロセミド錠20mg' },
        ],
      });
      expect(payload).not.toHaveProperty('data.0.org_id');
      expect(payload).not.toHaveProperty('data.0.patient_id');
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/medication-profiles?patient_id=patient_1&is_current=true&limit=100',
        { headers: { 'x-org-id': 'org_1' } },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/medication-profiles?patient_id=patient_1&is_current=true&limit=100&cursor=profile_1',
        { headers: { 'x-org-id': 'org_1' } },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails closed instead of rendering a truncated calendar after the 200-profile cap', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [PROVIDER_PROFILE],
          meta: { limit: 100, has_more: true, next_cursor: 'profile_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ ...PROVIDER_PROFILE, id: 'profile_2' }],
          meta: { limit: 100, has_more: true, next_cursor: 'profile_2' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation((options) => {
      capturedQueryFn = options.queryFn;
      return { isLoading: false, error: null, data: { data: [] } };
    });

    try {
      render(<MedicationCalendarContent patientId="patient_1" />);
      await expect(capturedQueryFn?.()).rejects.toThrow('服薬中薬剤の取得に失敗しました');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    {
      name: 'missing cursor metadata',
      payload: { data: [PROVIDER_PROFILE] },
    },
    {
      name: 'has-more without a cursor',
      payload: {
        data: [PROVIDER_PROFILE],
        meta: { limit: 100, has_more: true, next_cursor: null },
      },
    },
    {
      name: 'invalid profile date',
      payload: {
        data: [{ ...PROVIDER_PROFILE, start_date: '2026-04-01' }],
        meta: { limit: 100, has_more: false, next_cursor: null },
      },
    },
    {
      name: 'missing drug name',
      payload: {
        data: [
          {
            id: PROVIDER_PROFILE.id,
            dose: PROVIDER_PROFILE.dose,
            frequency: PROVIDER_PROFILE.frequency,
            start_date: PROVIDER_PROFILE.start_date,
            end_date: PROVIDER_PROFILE.end_date,
          },
        ],
        meta: { limit: 100, has_more: false, next_cursor: null },
      },
    },
    {
      name: 'numeric dose',
      payload: {
        data: [{ ...PROVIDER_PROFILE, dose: 1 }],
        meta: { limit: 100, has_more: false, next_cursor: null },
      },
    },
  ])('rejects malformed successful medication profile pages: $name', async ({ payload }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation((options) => {
      capturedQueryFn = options.queryFn;
      return { isLoading: false, error: null, data: { data: [] } };
    });

    try {
      render(<MedicationCalendarContent patientId="patient_1" />);
      await expect(capturedQueryFn?.()).rejects.toThrow('服薬中薬剤の取得に失敗しました');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
