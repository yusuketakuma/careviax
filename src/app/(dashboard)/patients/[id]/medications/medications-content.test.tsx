// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/components/features/patients/residual-medication-chart', () => ({
  ResidualMedicationChart: () => <div data-testid="residual-chart" />,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { MedicationsContent } from './medications-content';

setupDomTestEnv();

describe('MedicationsContent', () => {
  it('renders medication workflow groups with semantic headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'medication-profiles') {
        return {
          data: {
            data: [
              {
                id: 'profile_1',
                patient_id: 'patient_1',
                drug_name: 'アムロジピン錠5mg',
                dose: '1錠',
                frequency: '朝食後',
                start_date: '2026-06-01',
                end_date: null,
                prescriber: '佐藤医師',
                is_current: true,
                source: 'manual',
                created_at: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
          isLoading: false,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
      };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '服薬中薬剤' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 3, name: '見やすい薬剤一覧' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { level: 2, name: '薬学的課題と照会' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: 'アレルギー・副作用歴' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: '残薬管理と次回提案' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'お薬手帳QR発行' }).tagName).toBe('H2');
    expect(screen.getAllByText('アムロジピン錠5mg').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登録' })).toBeTruthy();
  }, 15_000);
});
