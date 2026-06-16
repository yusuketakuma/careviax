// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientForm } from './patient-form';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const routerBackMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

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
  },
}));

describe('PatientForm', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/patients/new');
    vi.stubGlobal('fetch', vi.fn());
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
});
