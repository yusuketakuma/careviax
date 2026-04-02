// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

import { MedicationSetsContent } from './medication-sets-content';

setupDomTestEnv();

function buildSetPlans(overrides?: Partial<{
  audits: Array<{ id: string; result: string; audited_at: string }>;
}>){
  return [
    {
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: '2026-04-01',
      target_period_end: '2026-04-07',
      set_method: 'facility_calendar',
      packaging_method_id: null,
      packaging_summary_snapshot: null,
      notes: null,
      created_at: '2026-04-01T09:00:00.000Z',
      packaging_method_ref: null,
      cycle: {
        id: 'cycle_1',
        overall_status: 'audited',
        patient_id: 'patient_1',
        case_: {
          patient: {
            id: 'patient_1',
            name: '田中花子',
            name_kana: 'タナカハナコ',
          },
        },
      },
      audits: overrides?.audits ?? [],
    },
  ];
}

describe('MedicationSetsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-target-cases') {
        return {
          data: {
            data: [
              {
                id: 'case_1',
                patient_id: 'patient_1',
                status: 'active',
                required_visit_support: { set_pilot_enabled: true },
                patient: {
                  id: 'patient_1',
                  name: '田中花子',
                  name_kana: 'タナカハナコ',
                },
              },
            ],
          },
        };
      }

      return {
        data: {
          data: [
            {
              id: 'method_1',
              name: '一包化標準',
              description: null,
              is_active: true,
            },
          ],
        },
      };
    });
    useRealtimeQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-plans') {
        return {
          data: { data: buildSetPlans() },
          isLoading: false,
        };
      }

      if (args.queryKey[0] === 'set-target-cycles') {
        return {
          data: {
            data: [
              {
                id: 'cycle_2',
                case_id: 'case_1',
                patient_id: 'patient_1',
                overall_status: 'audited',
              },
            ],
          },
          isLoading: false,
        };
      }

      throw new Error(`Unexpected query key: ${args.queryKey.join('/')}`);
    });
  });

  it('keeps re-audit available when the latest audit is not approved', () => {
    useRealtimeQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-plans') {
        return {
          data: {
            data: buildSetPlans({
              audits: [
                {
                  id: 'audit_1',
                  result: 'rejected',
                  audited_at: '2026-04-01T10:00:00.000Z',
                },
              ],
            }),
          },
          isLoading: false,
        };
      }

      if (args.queryKey[0] === 'set-target-cycles') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      throw new Error(`Unexpected query key: ${args.queryKey.join('/')}`);
    });

    render(<MedicationSetsContent />);

    const auditButtons = screen.getAllByRole('button', { name: /セット鑑査/ });
    expect((auditButtons[0] as HTMLButtonElement).disabled).toEqual(false);
  });

  it('disables plan creation when there are no eligible cycles', () => {
    useRealtimeQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-plans') {
        return {
          data: { data: buildSetPlans() },
          isLoading: false,
        };
      }

      if (args.queryKey[0] === 'set-target-cycles') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      throw new Error(`Unexpected query key: ${args.queryKey.join('/')}`);
    });

    render(<MedicationSetsContent />);

    expect(
      (screen.getByRole('button', { name: 'セットプラン作成' }) as HTMLButtonElement).disabled,
    ).toEqual(true);
  });
});
