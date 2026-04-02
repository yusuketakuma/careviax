// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
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
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

import { SetAuditContent } from './set-audit-content';

setupDomTestEnv();

describe('SetAuditContent', () => {
  const mutateSpy = vi.fn();
  const invalidateQueriesSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-batches') {
        return {
          data: [
            {
              id: 'batch_1',
              plan_id: 'plan_1',
              line_id: 'line_1',
              slot: 'morning',
              day_number: 1,
              quantity: 7,
              carry_type: 'carry',
              version: 1,
              line: {
                id: 'line_1',
                drug_name: 'アムロジピン錠5mg',
                dose: '1回1錠',
                frequency: '朝食後',
                unit: '錠',
              },
            },
          ],
          isLoading: false,
          isError: false,
        };
      }

      return {
        data: {
          audits: [],
          batches: [
            {
              id: 'batch_1',
              updated_at: '2026-04-01T09:00:00.000Z',
            },
          ],
        },
        isLoading: false,
        isError: false,
      };
    });
    useQueryClientMock.mockReturnValue({
      invalidateQueries: invalidateQueriesSpy,
    });
    useMutationMock.mockReturnValue({
      mutate: mutateSpy,
      isPending: false,
    });
  });

  it('does not submit while any slot remains unreviewed', () => {
    render(<SetAuditContent planId="plan_1" />);

    fireEvent.click(screen.getByRole('button', { name: '判定を保存' }));

    expect(mutateSpy).not.toHaveBeenCalled();
  });

  it('submits only after the day is marked and the final save action is clicked', () => {
    render(<SetAuditContent planId="plan_1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Day 1を承認' }));

    expect(mutateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '承認を保存' }));

    expect(mutateSpy).toHaveBeenCalledWith(
      {
        plan_id: 'plan_1',
        result: 'approved',
        approved_scope: {
          '1-morning': true,
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('hydrates a saved partial approval from the latest audit snapshot', () => {
    useRealtimeQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-batches') {
        return {
          data: [
            {
              id: 'batch_1',
              plan_id: 'plan_1',
              line_id: 'line_1',
              slot: 'morning',
              day_number: 1,
              quantity: 7,
              carry_type: 'carry',
              version: 1,
              line: {
                id: 'line_1',
                drug_name: 'アムロジピン錠5mg',
                dose: '1回1錠',
                frequency: '朝食後',
                unit: '錠',
              },
            },
            {
              id: 'batch_2',
              plan_id: 'plan_1',
              line_id: 'line_2',
              slot: 'evening',
              day_number: 1,
              quantity: 7,
              carry_type: 'carry',
              version: 1,
              line: {
                id: 'line_2',
                drug_name: 'アトルバスタチン錠10mg',
                dose: '1回1錠',
                frequency: '夕食後',
                unit: '錠',
              },
            },
          ],
          isLoading: false,
          isError: false,
        };
      }

      return {
        data: {
          audits: [
            {
              id: 'audit_1',
              result: 'partial_approved',
              approved_scope: {
                '1-morning': true,
              },
              reject_reason: '数量誤り',
              audited_at: '2026-04-01T10:00:00.000Z',
            },
          ],
          batches: [
            {
              id: 'batch_1',
              updated_at: '2026-04-01T09:00:00.000Z',
            },
            {
              id: 'batch_2',
              updated_at: '2026-04-01T09:00:00.000Z',
            },
          ],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<SetAuditContent planId="plan_1" />);

    fireEvent.click(screen.getByRole('button', { name: '部分承認を保存' }));

    expect(mutateSpy).toHaveBeenCalledWith(
      {
        plan_id: 'plan_1',
        result: 'partial_approved',
        approved_scope: {
          '1-morning': true,
        },
        reject_reason: '数量誤り',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('does not hydrate stale audit state after batches change', () => {
    useRealtimeQueryMock.mockImplementation((args: { queryKey: string[] }) => {
      if (args.queryKey[0] === 'set-batches') {
        return {
          data: [
            {
              id: 'batch_1',
              plan_id: 'plan_1',
              line_id: 'line_1',
              slot: 'morning',
              day_number: 1,
              quantity: 7,
              carry_type: 'carry',
              version: 2,
              line: {
                id: 'line_1',
                drug_name: 'アムロジピン錠5mg',
                dose: '1回1錠',
                frequency: '朝食後',
                unit: '錠',
              },
            },
          ],
          isLoading: false,
          isError: false,
        };
      }

      return {
        data: {
          audits: [
            {
              id: 'audit_1',
              result: 'approved',
              approved_scope: null,
              reject_reason: null,
              audited_at: '2026-04-01T10:00:00.000Z',
            },
          ],
          batches: [
            {
              id: 'batch_1',
              updated_at: '2026-04-01T11:00:00.000Z',
            },
          ],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<SetAuditContent planId="plan_1" />);

    fireEvent.click(screen.getByRole('button', { name: '判定を保存' }));

    expect(mutateSpy).not.toHaveBeenCalled();
  });
});
