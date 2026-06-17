// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchMutations } from './use-workbench-mutations';

type MutationOptions = {
  onError?: (error: unknown) => void;
  onSuccess?: (data: unknown) => void;
};

function mutationStub(onMutate?: (input: unknown, options?: MutationOptions) => void) {
  return {
    mutate: vi.fn((input: unknown, options?: MutationOptions) => {
      onMutate?.(input, options);
    }),
  };
}

function fakeMutations(
  overrides: Partial<Record<keyof WorkbenchMutations, unknown>> = {},
): WorkbenchMutations {
  return {
    completeDispense: mutationStub(),
    completeAudit: mutationStub(),
    cellMutation: mutationStub(),
    bulkSet: mutationStub(),
    setAudit: mutationStub(),
    createHold: mutationStub(),
    resolveHold: mutationStub(),
    saveGroups: mutationStub(),
    assignLines: mutationStub(),
    editLine: mutationStub(),
    isAnyPending: false,
    ...overrides,
  } as WorkbenchMutations;
}

async function importRealDataHandlers() {
  vi.doMock('./dispensing-workbench.adapter', async () => {
    const actual = await vi.importActual<typeof import('./dispensing-workbench.adapter')>(
      './dispensing-workbench.adapter',
    );
    return {
      ...actual,
      isRealDataEnabled: () => true,
    };
  });

  const [{ useWorkbenchStore }, { useWorkbenchWriteHandlers }] = await Promise.all([
    import('./dispensing-workbench.store'),
    import('./use-workbench-write-handlers'),
  ]);

  return { useWorkbenchStore, useWorkbenchWriteHandlers };
}

describe('useWorkbenchWriteHandlers real-data rollback', () => {
  afterEach(() => {
    vi.doUnmock('./dispensing-workbench.adapter');
    vi.resetModules();
  });

  it('restores the previous set cell state when a cell set mutation fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        target: { di: 0, tk: '朝' },
        setCells: { [key]: 'hold' },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {
            [key]: { batchIds: ['batch_1'], versions: [7], dayNumber: 1, slot: 'morning' },
          },
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ cellMutation }),
      }),
    );

    act(() => {
      result.current.onSetCell();
    });

    expect(cellMutation.mutate).toHaveBeenCalledWith(
      { batch_id: 'batch_1', action: 'set', expected_version: 7 },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().setCells[key]).toBe('hold');
  });

  it('restores set and audit cell states when returning a cell to set fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'set' },
        auditCells: { [key]: 'ng' },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {
            [key]: { batchIds: ['batch_1'], versions: [7], dayNumber: 1, slot: 'morning' },
          },
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ cellMutation }),
      }),
    );

    act(() => {
      result.current.onReturnToSet(0, '朝');
    });

    expect(cellMutation.mutate).toHaveBeenCalledWith(
      { batch_id: 'batch_1', action: 'clear', expected_version: 7 },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().setCells[key]).toBe('set');
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ng');
  });

  it('restores the full set cell map when bulk set fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const noonKey = 'patient_1:0:昼';
    const bulkSet = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'hold', [noonKey]: 'set' },
        model: {
          patient_1: [
            {
              gid: 'group_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              calendarStart: '2026-06-17',
              calendarDayCount: 1,
              drugs: [
                {
                  did: 'line_1',
                  name: 'アムロジピン錠5mg',
                  yoho: '朝食後',
                  a: '1',
                  h: '',
                  y: '',
                  n: '',
                  tag: '',
                  funsai: false,
                  note: '',
                },
              ],
            },
          ],
        },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {
            [key]: { batchIds: ['batch_1'], versions: [7], dayNumber: 1, slot: 'morning' },
            [noonKey]: { batchIds: ['batch_2'], versions: [8], dayNumber: 1, slot: 'noon' },
          },
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ bulkSet }),
      }),
    );

    act(() => {
      result.current.onBulk();
    });

    expect(bulkSet.mutate).toHaveBeenCalledWith(
      [
        { batch_id: 'batch_1', expected_version: 7 },
        { batch_id: 'batch_2', expected_version: 8 },
      ],
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().setCells).toEqual({ [key]: 'hold', [noonKey]: 'set' });
  });

  it('persists calendar holds through the set-batch cell API and rolls back local hold state on failure', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub((_input, options) => options?.onError?.(new Error('fail')));
    const createHold = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'set' },
        holdInfo: {},
        holdModal: {
          di: 0,
          tk: '朝',
          reason: '在庫不足',
          due: '',
          owner: '',
          memo: '納品待ち',
        },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {
            [key]: { batchIds: ['batch_1'], versions: [7], dayNumber: 1, slot: 'morning' },
          },
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ cellMutation, createHold }),
      }),
    );

    act(() => {
      result.current.onSaveHold();
    });

    expect(cellMutation.mutate).toHaveBeenCalledWith(
      {
        batch_id: 'batch_1',
        action: 'hold',
        held_reason: 'stock_shortage',
        held_detail: '納品待ち',
        expected_version: 7,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(createHold.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().setCells[key]).toBe('set');
    expect(useWorkbenchStore.getState().holdInfo[key]).toBeUndefined();
  });

  it('submits dispense audit approval before advancing from audit to set in real-data mode', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub((_input, options) => options?.onSuccess?.({}));
    const onAdvance = vi.fn();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        model: {
          patient_1: [
            {
              gid: 'group_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              drugs: [
                {
                  did: 'line_1',
                  name: 'アムロジピン錠5mg',
                  yoho: '朝食後',
                  a: '1',
                  h: '',
                  y: '',
                  n: '',
                  tag: '',
                  funsai: false,
                  note: '',
                },
              ],
            },
          ],
        },
        audit: { line_1: true },
        writeContext: {
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations({ completeAudit }),
        onAdvance,
      }),
    );

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(completeAudit.mutate).toHaveBeenCalledWith(
      { task_id: 'task_1', result: 'approved' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onAdvance).toHaveBeenCalledWith('setp');
  });
});
