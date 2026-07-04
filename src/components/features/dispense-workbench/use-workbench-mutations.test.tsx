// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';

const {
  mutateCellMock,
  assignLinesToGroupMock,
  updatePrescriptionLinesMock,
  generateSetBatchesMock,
  loadPatientsAsyncMock,
  loadWorkbenchAsyncMock,
  loadCalendarWriteContextAsyncMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  mutateCellMock: vi.fn(),
  assignLinesToGroupMock: vi.fn(),
  updatePrescriptionLinesMock: vi.fn(),
  generateSetBatchesMock: vi.fn(),
  loadPatientsAsyncMock: vi.fn(),
  loadWorkbenchAsyncMock: vi.fn(),
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
  loadPatientsAsync: loadPatientsAsyncMock,
  loadWorkbenchAsync: loadWorkbenchAsyncMock,
  loadCalendarWriteContextAsync: loadCalendarWriteContextAsyncMock,
  submitDispenseResults: vi.fn(),
  submitDispenseAudit: vi.fn(),
  mutateCell: mutateCellMock,
  bulkSetCells: vi.fn(),
  generateSetBatches: generateSetBatchesMock,
  submitSetAudit: vi.fn(),
  createCycleHold: vi.fn(),
  resolveCycleHold: vi.fn(),
  createGroup: vi.fn(),
  updateGroups: vi.fn(),
  assignLinesToGroup: assignLinesToGroupMock,
  updatePrescriptionLine: vi.fn(),
  updatePrescriptionLines: updatePrescriptionLinesMock,
}));

import { WorkbenchConflictError } from './dispensing-workbench.write-types';
import { useWorkbenchStore } from './dispensing-workbench.store';
import {
  calendarQueryKey,
  useWorkbenchMutations,
  workbenchQueryKey,
} from './use-workbench-mutations';

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
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');
    mutateCellMock.mockRejectedValue(
      new WorkbenchConflictError({
        message: '他のユーザーによって更新されました。最新データを取得してから再試行してください',
      }),
    );

    const { result } = renderHook(
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: 'plan_1', phase: 'setp' }),
      { wrapper: createQueryClientWrapper(queryClient) },
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
      matrix: { generation: null },
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

    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: 'plan_1', phase: 'setp' }),
      { wrapper: createQueryClientWrapper(queryClient) },
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

  it('refetches and directly rehydrates the active workbench after a line assignment conflict', async () => {
    const patient = {
      id: 'patient_1',
      name: '計画 花子',
      kana: 'ケイカク ハナコ',
      dob: '1940/01/01',
      age: 86,
      sex: '女',
      sub: '',
      short: '計',
      chips: [],
      regist: '2026/04/01',
      seedStart: '2026-04-01',
      seedDays: 14,
      yosei: '可',
      changes: [],
      biko: [],
      rows: [],
    };
    assignLinesToGroupMock.mockRejectedValue(
      new WorkbenchConflictError({
        message: '処方明細のグループ割当が他の操作で更新されています',
      }),
    );
    loadPatientsAsyncMock.mockResolvedValue([patient]);
    loadWorkbenchAsyncMock.mockResolvedValue({
      patient,
      groups: [
        {
          gid: 'group_3',
          label: '夕食後',
          method: '一包化',
          start: '2026-04-01',
          days: 14,
          drugs: [],
        },
      ],
      done: {},
      audit: {},
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 5,
        lineGroupByDid: { line_1: 'packaging_group_3' },
        groupIdByGid: { group_3: 'packaging_group_3' },
      },
    });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');
    const { result } = renderHook(
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: null, phase: 'dispense' }),
      { wrapper: createQueryClientWrapper(queryClient) },
    );

    result.current.assignLines.mutate({
      taskId: 'task_1',
      assignments: [
        {
          line_id: 'line_1',
          packaging_group_id: 'packaging_group_2',
          expected_packaging_group_id: 'packaging_group_1',
        },
      ],
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '処方明細のグループ割当が他の操作で更新されています 最新の状態を再読み込みします。',
      );
    });
    const queryKey = workbenchQueryKey('org_1', 'patient_1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey, type: 'active' });
    await waitFor(() => {
      expect(useWorkbenchStore.getState().writeContext.lineGroupByDid.line_1).toBe(
        'packaging_group_3',
      );
    });
  });

  it('rehydrates calendar generation metadata after a successful batch generation', async () => {
    generateSetBatchesMock.mockResolvedValue({ data: { count: 3, batches: [], reused: false } });
    loadCalendarWriteContextAsyncMock.mockResolvedValue({
      matrix: {
        generation: {
          batch_count: 3,
          needs_initial_generation: false,
          latest_batch_updated_at: '2026-06-20T00:00:00.000Z',
          expected_updated_at: '2026-06-20T00:00:00.000Z',
          can_generate: false,
          can_force_regenerate: true,
        },
      },
      calendarState: { model: { patient_1: [] }, setCells: {}, auditCells: {} },
      writeContext: { planId: 'plan_1', cycleId: 'cycle_1', cycleVersion: 8, cellMeta: {} },
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useWorkbenchMutations({ patientId: 'patient_1', planId: 'plan_1', phase: 'setp' }),
      { wrapper: createQueryClientWrapper(queryClient) },
    );

    result.current.generateBatches.mutate({ force: false });

    await waitFor(() => {
      expect(generateSetBatchesMock).toHaveBeenCalledWith('plan_1', { force: false });
    });
    await waitFor(() => {
      expect(useWorkbenchStore.getState().calendarGeneration?.batch_count).toBe(3);
    });
  });
});
