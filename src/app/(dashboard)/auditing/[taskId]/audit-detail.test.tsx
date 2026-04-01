// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/components/features/workflow/previous-stage-summary', () => ({
  PreviousStageSummary: () => <div data-testid="previous-stage-summary" />,
}));

vi.mock('@/components/features/workflow/stage-timeline', () => ({
  StageTimeline: () => <div data-testid="stage-timeline" />,
}));

vi.mock('@/components/features/cds/alert-panel', () => ({
  CdsAlertPanel: () => <div data-testid="cds-alert-panel" />,
}));

vi.mock('@/components/features/keyboard/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

import { AuditDetail } from './audit-detail';

setupDomTestEnv();

describe('AuditDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ push: vi.fn() });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'dispense-task-detail') {
        return {
          data: {
            id: 'task_1',
            priority: 'urgent',
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田太郎',
                  name_kana: 'ヤマダタロウ',
                },
              },
              prescription_intakes: [
                {
                  id: 'intake_1',
                  prescribed_date: '2026-04-01',
                  prescriber_name: '医師A',
                  prescriber_institution: '診療所A',
                  original_document_url: null,
                  lines: [],
                },
              ],
            },
            results: [
              {
                id: 'result_1',
                line_id: 'line_1',
                actual_drug_name: 'アムロジピン細粒',
                actual_drug_code: 'drug_1',
                actual_quantity: 7,
                actual_unit: '包',
                discrepancy_reason: '採用後発品へ変更',
                carry_type: 'carry',
                special_notes: '粉砕して分包',
                dispensed_at: '2026-04-01T09:00:00.000Z',
                line: {
                  id: 'line_1',
                  line_number: 1,
                  drug_name: 'アムロジピン錠5mg',
                  drug_code: 'line_drug_1',
                  dosage_form: 'tablet',
                  dose: '1回1錠',
                  frequency: '朝食後',
                  days: 7,
                  quantity: 7,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: '粉砕',
                  notes: null,
                },
              },
              {
                id: 'result_2',
                line_id: 'line_2',
                actual_drug_name: 'タケプロンOD錠15mg',
                actual_drug_code: 'drug_2',
                actual_quantity: 7,
                actual_unit: '錠',
                discrepancy_reason: null,
                carry_type: 'facility_deposit',
                special_notes: null,
                dispensed_at: '2026-04-01T09:15:00.000Z',
                line: {
                  id: 'line_2',
                  line_number: 2,
                  drug_name: 'タケプロンOD錠15mg',
                  drug_code: 'line_drug_2',
                  dosage_form: 'tablet',
                  dose: '1回1錠',
                  frequency: '夕食後',
                  days: 7,
                  quantity: 7,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: null,
                  notes: null,
                },
              },
            ],
            prefill: {
              isPrefillAvailable: true,
              packagingGroups: [
                {
                  lineId: 'line_1',
                  groupId: 'group_morning',
                  groupLabel: '朝食後',
                  slot: 'morning',
                  isCrushProhibited: false,
                },
                {
                  lineId: 'line_2',
                  groupId: null,
                  groupLabel: '個別包装',
                  slot: null,
                  isCrushProhibited: false,
                },
              ],
            },
          },
          isLoading: false,
        };
      }

      return {
        data: { alerts: [] },
        isLoading: false,
      };
    });
  });

  it('renders grouped dispense results and discrepancy details', () => {
    render(<AuditDetail taskId="task_1" />);

    expect(screen.getByText('朝食後')).toBeTruthy();
    expect(screen.getAllByText('個別包装').length).toBeGreaterThan(0);
    expect(screen.getByText('処方: アムロジピン錠5mg')).toBeTruthy();
    expect(screen.getByText('粉砕')).toBeTruthy();
    expect(screen.getByText('施設預け')).toBeTruthy();
  });
});
