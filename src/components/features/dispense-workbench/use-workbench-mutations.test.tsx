// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateCellMock, toastErrorMock } = vi.hoisted(() => ({
  mutateCellMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock('./dispensing-workbench.adapter', () => ({
  isRealDataEnabled: () => true,
  submitDispenseResults: vi.fn(),
  submitDispenseAudit: vi.fn(),
  mutateCell: mutateCellMock,
  bulkSetCells: vi.fn(),
  submitSetAudit: vi.fn(),
  createCycleHold: vi.fn(),
  resolveCycleHold: vi.fn(),
  createGroup: vi.fn(),
  updateGroups: vi.fn(),
  assignLinesToGroup: vi.fn(),
  updatePrescriptionLine: vi.fn(),
}));

import { WorkbenchConflictError } from './dispensing-workbench.write-types';
import { calendarQueryKey, useWorkbenchMutations } from './use-workbench-mutations';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useWorkbenchMutations recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refetches the active calendar query and surfaces server conflict detail', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');
    mutateCellMock.mockRejectedValue(
      new WorkbenchConflictError({
        message: '他のユーザーによって更新されました。最新データを取得してから再試行してください',
      }),
    );

    const { result } = renderHook(
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: 'plan_1' }),
      { wrapper: createWrapper(queryClient) },
    );

    result.current.cellMutation.mutate({
      action: 'set',
      batch_id: 'batch_1',
      expected_version: 1,
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '他のユーザーによって更新されました。最新データを取得してから再試行してください 最新の状態を再読み込みします。',
      );
    });
    const queryKey = calendarQueryKey('org_1', 'plan_1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey, type: 'active' });
  });
});
