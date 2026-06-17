// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateCellMock, loadCalendarWriteContextAsyncMock, toastErrorMock } = vi.hoisted(() => ({
  mutateCellMock: vi.fn(),
  loadCalendarWriteContextAsyncMock: vi.fn(),
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
  loadPatientsAsync: vi.fn(),
  loadWorkbenchAsync: vi.fn(),
  loadCalendarWriteContextAsync: loadCalendarWriteContextAsyncMock,
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
import { useWorkbenchStore } from './dispensing-workbench.store';
import { calendarQueryKey, useWorkbenchMutations } from './use-workbench-mutations';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useWorkbenchMutations recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbenchStore.setState({
      selId: 'patient_1',
      model: {},
      setCells: {},
      auditCells: {},
      writeContext: {
        taskId: null,
        cycleId: null,
        cycleVersion: null,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
    });
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
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: 'plan_1', phase: 'setp' }),
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

  it('rehydrates calendar store state directly after a cell conflict', async () => {
    mutateCellMock.mockRejectedValue(
      new WorkbenchConflictError({
        message: 'セルが更新されています',
      }),
    );
    loadCalendarWriteContextAsyncMock.mockResolvedValue({
      calendarState: {
        model: { patient_1: [] },
        setCells: { 'patient_1:0:朝': 'hold' },
        auditCells: { 'patient_1:0:朝': 'ng' },
      },
      writeContext: {
        planId: 'plan_1',
        cycleId: 'cycle_1',
        cycleVersion: 8,
        cellMeta: {
          'patient_1:0:朝': {
            batchIds: ['batch_1'],
            versions: [9],
            dayNumber: 1,
            slot: 'morning',
          },
        },
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result } = renderHook(
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: 'plan_1', phase: 'setp' }),
      { wrapper: createWrapper(queryClient) },
    );

    result.current.cellMutation.mutate({
      action: 'set',
      batch_id: 'batch_1',
      expected_version: 1,
    });

    await waitFor(() => {
      expect(useWorkbenchStore.getState().setCells['patient_1:0:朝']).toBe('hold');
    });
    expect(useWorkbenchStore.getState().auditCells['patient_1:0:朝']).toBe('ng');
    expect(useWorkbenchStore.getState().writeContext.cellMeta['patient_1:0:朝'].versions).toEqual([
      9,
    ]);
  });
});
