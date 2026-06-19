// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

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
});
