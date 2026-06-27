// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

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
});
