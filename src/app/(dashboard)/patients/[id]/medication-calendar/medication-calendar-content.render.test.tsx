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

  it('encodes the medication profile query and calendar PDF href at URL boundaries', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: [] }));
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
      '/api/medication-profiles?patient_id=patient_1%3Fx%3D1%23frag&is_current=true&limit=200',
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
      '/api/medication-profiles?patient_id=patient_1?x=1#frag&is_current=true&limit=200',
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });

  it('keeps the API message when medication profile lookup fetch fails', async () => {
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

    await expect(capturedQueryFn?.()).rejects.toThrow('服薬中薬剤を表示できません');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/medication-profiles?patient_id=patient_1&is_current=true&limit=200',
      { headers: { 'x-org-id': 'org_1' } },
    );

    vi.unstubAllGlobals();
  });
});
