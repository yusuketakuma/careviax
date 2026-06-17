// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchMutations } from './use-workbench-mutations';
import type { SeedPatient } from './dispensing-workbench.types';

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

const patientFixture: SeedPatient = {
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

const MISSING_WRITE_CONTEXT_MESSAGE =
  '保存に必要な実データを取得できませんでした。患者を再選択してから実行してください。';

const UNSUPPORTED_REAL_WRITE_MESSAGE =
  'この項目は実データではまだ保存できません。最新状態を再読み込みしてください。';

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
    createGroup: mutationStub(),
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
    toastErrorMock.mockReset();
    window.localStorage.clear();
  });

  it('starts real-data mode without restoring seed or persisted clinical workbench state', async () => {
    window.localStorage.setItem(
      'chouzai-workbench',
      JSON.stringify({
        state: {
          selId: '0001',
          patients: [{ id: '0001', name: 'Seed Patient' }],
          model: { '0001': [{ gid: 'seed_group', drugs: [] }] },
          setCells: { '0001:0:朝': 'set' },
        },
        version: 0,
      }),
    );

    const { useWorkbenchStore } = await importRealDataHandlers();

    expect(useWorkbenchStore.getState()).toMatchObject({
      selId: '',
      patients: [],
      model: {},
      setCells: {},
    });
  });

  it('clears patient-scoped auxiliary calendar state when real calendar state is rehydrated without a matching plan', async () => {
    const { useWorkbenchStore } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'hold', 'patient_2:0:朝': 'set' },
        auditCells: { [key]: 'ng', 'patient_2:0:朝': 'ok' },
        checks: { [`${key}:0`]: true, 'patient_2:0:朝:0': true },
        ng: { [key]: '薬剤違い', 'patient_2:0:朝': '数量不足' },
        holdInfo: {
          [key]: { reason: '在庫不足', due: '', owner: '', memo: '' },
          'patient_2:0:朝': { reason: '医師確認待ち', due: '', owner: '', memo: '' },
        },
        outChk: { 'patient_1:外用薬': true, 'patient_2:外用薬': true },
        packet: { 'patient_1:訪問バッグ': true, 'patient_2:訪問バッグ': true },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 1,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
        },
      });
      useWorkbenchStore.getState().setCalendarState({
        patientId: 'patient_1',
        planId: 'plan_2',
        model: { patient_1: [] },
        setCells: { [key]: 'set' },
        auditCells: { [key]: 'ok' },
        ng: { [key]: '数量不足' },
        holdInfo: { [key]: { reason: '医師確認待ち', due: '', owner: '', memo: '' } },
      });
    });

    const state = useWorkbenchStore.getState();
    expect(state.setCells).toMatchObject({ [key]: 'set', 'patient_2:0:朝': 'set' });
    expect(state.auditCells).toMatchObject({ [key]: 'ok', 'patient_2:0:朝': 'ok' });
    expect(state.checks[`${key}:0`]).toBeUndefined();
    expect(state.ng[key]).toBe('数量不足');
    expect(state.holdInfo[key]).toEqual({
      reason: '医師確認待ち',
      due: '',
      owner: '',
      memo: '',
    });
    expect(state.outChk['patient_1:外用薬']).toBeUndefined();
    expect(state.packet['patient_1:訪問バッグ']).toBeUndefined();
    expect(state.checks['patient_2:0:朝:0']).toBe(true);
    expect(state.ng['patient_2:0:朝']).toBe('数量不足');
  });

  it('preserves visit carry evidence when the same set plan is rehydrated for set-audit', async () => {
    const { useWorkbenchStore } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'hold' },
        auditCells: { [key]: 'ng' },
        checks: { [`${key}:0`]: true },
        outChk: { 'patient_1:外用薬': true },
        packet: { 'patient_1:cal': true, 'patient_1:doc': true, 'patient_1:note': true },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 1,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
        },
      });
      useWorkbenchStore.getState().setCalendarState({
        patientId: 'patient_1',
        planId: 'plan_1',
        model: { patient_1: [] },
        setCells: { [key]: 'set' },
        auditCells: { [key]: 'ok' },
      });
    });

    const state = useWorkbenchStore.getState();
    expect(state.setCells[key]).toBe('set');
    expect(state.auditCells[key]).toBe('ok');
    expect(state.checks[`${key}:0`]).toBeUndefined();
    expect(state.outChk['patient_1:外用薬']).toBe(true);
    expect(state.packet['patient_1:cal']).toBe(true);
    expect(state.packet['patient_1:doc']).toBe(true);
    expect(state.packet['patient_1:note']).toBe(true);
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

  it('updates the local cell version after a successful cell mutation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub((_input, options) =>
      options?.onSuccess?.({ data: { id: 'batch_1', version: 8 } }),
    );

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        target: { di: 0, tk: '朝' },
        setCells: { [key]: 'pending' },
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
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().writeContext.cellMeta[key].versions).toEqual([8]);
  });

  it('submits one atomic cell mutation when a visible cell contains multiple batches', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub((_input, options) =>
      options?.onSuccess?.({
        data: {
          batches: [
            { id: 'batch_1', version: 8 },
            { id: 'batch_2', version: 9 },
          ],
        },
      }),
    );

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        target: { di: 0, tk: '朝' },
        setCells: { [key]: 'pending' },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {
            [key]: {
              batchIds: ['batch_1', 'batch_2'],
              versions: [7, 8],
              dayNumber: 1,
              slot: 'morning',
            },
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

    expect(cellMutation.mutate).toHaveBeenCalledTimes(1);
    expect(cellMutation.mutate).toHaveBeenCalledWith(
      {
        action: 'set',
        cells: [
          { batch_id: 'batch_1', expected_version: 7 },
          { batch_id: 'batch_2', expected_version: 8 },
        ],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().writeContext.cellMeta[key].versions).toEqual([8, 9]);
  });

  it('does not downgrade the local cell version from a stale mutation success response', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub((_input, options) =>
      options?.onSuccess?.({ data: { id: 'batch_1', version: 8 } }),
    );

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        target: { di: 0, tk: '朝' },
        setCells: { [key]: 'pending' },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {
            [key]: { batchIds: ['batch_1'], versions: [9], dayNumber: 1, slot: 'morning' },
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

    expect(useWorkbenchStore.getState().writeContext.cellMeta[key].versions).toEqual([9]);
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

  it('updates local cell versions after a successful bulk set', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const noonKey = 'patient_1:0:昼';
    const bulkSet = mutationStub((_input, options) =>
      options?.onSuccess?.({
        data: {
          batches: [
            { id: 'batch_1', version: 8 },
            { id: 'batch_2', version: 9 },
          ],
        },
      }),
    );

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'pending', [noonKey]: 'pending' },
        model: {
          patient_1: [
            {
              gid: 'group_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              calendarStart: '2026-06-17',
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

    expect(useWorkbenchStore.getState().writeContext.cellMeta[key].versions).toEqual([8]);
    expect(useWorkbenchStore.getState().writeContext.cellMeta[noonKey].versions).toEqual([9]);
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
        done: { line_1: true },
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
      { task_id: 'task_1', result: 'approved', expected_version: 4 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onAdvance).toHaveBeenCalledWith('setp');
  });

  it('does not submit audit approval when rows are audited but not dispensed', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub();
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
        done: {},
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
    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('bulk audit only checks already dispensed rows', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();

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
                {
                  did: 'line_2',
                  name: 'カンデサルタン錠4mg',
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
        done: { line_1: true },
        audit: {},
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations(),
      }),
    );

    act(() => {
      result.current.onBulk();
    });

    expect(useWorkbenchStore.getState().audit).toEqual({ line_1: true });
  });

  it('clears optimistic dispense row checks when dispense completion fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub((_input, options) =>
      options?.onError?.(new Error('fail')),
    );
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
                  prescribedQuantity: 14,
                },
              ],
            },
          ],
        },
        done: { line_1: true },
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
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
        onAdvance,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(completeDispense.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().done.line_1).toBeUndefined();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('clears optimistic audit row checks when dispense audit completion fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub((_input, options) => options?.onError?.(new Error('fail')));
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
        done: { line_1: true },
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

    act(() => {
      result.current.onPrimary();
    });

    expect(completeAudit.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().audit.line_1).toBeUndefined();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('clears optimistic set-audit cell, checklist, and NG state when final approval fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub((_input, options) => options?.onError?.(new Error('fail')));
    const onAdvance = vi.fn();
    const key = 'patient_1:0:朝';

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
        setCells: { [key]: 'set' },
        auditCells: { [key]: 'ok' },
        checks: {
          [`${key}:0`]: true,
          [`${key}:1`]: true,
          [`${key}:2`]: true,
          [`${key}:3`]: true,
          [`${key}:4`]: true,
          [`${key}:5`]: true,
        },
        packet: {
          'patient_1:cal': true,
          'patient_1:doc': true,
          'patient_1:note': true,
        },
        ng: { [key]: '薬剤違い' },
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
        mutations: fakeMutations({ setAudit }),
        onAdvance,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(setAudit.mutate).toHaveBeenCalled();
    expect(setAudit.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        carry_packet_evidence: expect.objectContaining({
          plan_id: 'plan_1',
          cycle_id: 'cycle_1',
          patient_id: 'patient_1',
          outside_meds: [],
          packet_items: [
            { key: 'cal', checked: true },
            { key: 'doc', checked: true },
            { key: 'note', checked: true },
          ],
        }),
      }),
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().auditCells[key]).toBeUndefined();
    expect(useWorkbenchStore.getState().checks[`${key}:0`]).toBeUndefined();
    expect(useWorkbenchStore.getState().ng[key]).toBeUndefined();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not submit final set-audit approval when carry packet evidence is incomplete', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const key = 'patient_1:0:朝';

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
        setCells: { [key]: 'set' },
        auditCells: { [key]: 'ok' },
        checks: {
          [`${key}:0`]: true,
          [`${key}:1`]: true,
          [`${key}:2`]: true,
          [`${key}:3`]: true,
          [`${key}:4`]: true,
          [`${key}:5`]: true,
        },
        packet: { 'patient_1:cal': true },
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
        mutations: fakeMutations({ setAudit }),
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      '外薬同梱と訪問持出パケットの確認証跡を作成できません。セット工程を再確認してください。',
    );
    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');
    expect(useWorkbenchStore.getState().checks[`${key}:0`]).toBe(true);
  });

  it('creates a real packaging group and maps the local gid to the backend id', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const createGroup = mutationStub((_input, options) =>
      options?.onSuccess?.({ data: { id: 'packaging_group_1' } }),
    );

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [
          {
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
          },
        ],
        model: { patient_1: [] },
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
        phase: 'dispense',
        mutations: fakeMutations({ createGroup }),
      }),
    );

    act(() => {
      result.current.onAddGroup();
    });

    const group = useWorkbenchStore.getState().model.patient_1[0];
    expect(createGroup.mutate).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        group: {
          group_key: group.gid,
          label: '追加グループ1',
          method: '一包化',
          sort_order: 0,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().writeContext.groupIdByGid[group.gid]).toBe(
      'packaging_group_1',
    );
  });

  it('reports missing real-data context instead of silently no-oping a group create', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const createGroup = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        model: { patient_1: [] },
        writeContext: {
          taskId: null,
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
        phase: 'dispense',
        mutations: fakeMutations({ createGroup }),
      }),
    );

    act(() => {
      result.current.onAddGroup();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(createGroup.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().model.patient_1).toEqual([]);
  });

  it('reports missing real-data context instead of silently no-oping a primary submit', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        model: {
          patient_1: [
            {
              gid: 'g_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-04-01',
              days: 14,
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
                  prescribedQuantity: 14,
                },
              ],
            },
          ],
        },
        done: { line_1: true },
        writeContext: {
          taskId: null,
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
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
      }),
    );

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(completeDispense.mutate).not.toHaveBeenCalled();
  });

  it('reports missing context before changing a group method locally without persistence', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const saveGroups = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        model: {
          patient_1: [
            {
              gid: 'group_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              drugs: [],
            },
          ],
        },
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
        phase: 'dispense',
        mutations: fakeMutations({ saveGroups }),
      }),
    );

    act(() => {
      result.current.onGroupMethod('group_1', 'PTP（手撒き）');
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(saveGroups.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().model.patient_1?.[0]?.method).toBe('一包化');
  });

  it('reports unsupported real-data group date edits instead of changing local-only values', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        model: {
          patient_1: [
            {
              gid: 'group_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              drugs: [],
            },
          ],
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations(),
      }),
    );

    act(() => {
      result.current.onGroupStart('group_1', '2026-06-18');
      result.current.onGroupDays('group_1', '14');
    });

    expect(toastErrorMock).toHaveBeenCalledWith(UNSUPPORTED_REAL_WRITE_MESSAGE);
    expect(toastErrorMock).toHaveBeenCalledTimes(2);
    expect(useWorkbenchStore.getState().model.patient_1?.[0]).toMatchObject({
      start: '2026-06-17',
      days: 1,
    });
  });

  it('reports missing task context before dragging a line into a local-only group assignment', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const assignLines = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
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
            {
              gid: 'group_2',
              label: '夕食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              drugs: [],
            },
          ],
        },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: {},
          groupIdByGid: { group_2: 'packaging_group_2' },
          cellMeta: {},
        },
      });
      useWorkbenchStore.getState().dragStart('line_1');
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ assignLines }),
      }),
    );

    act(() => {
      result.current.onDropTo('group_2');
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(assignLines.mutate).not.toHaveBeenCalled();
    expect(
      useWorkbenchStore.getState().model.patient_1?.[0]?.drugs.map((drug) => drug.did),
    ).toEqual(['line_1']);
    expect(useWorkbenchStore.getState().model.patient_1?.[1]?.drugs).toEqual([]);
  });

  it('reports missing plan context before bulk set creates local-only cell state', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const bulkSet = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        model: {
          patient_1: [
            {
              gid: 'group_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-06-17',
              days: 1,
              calendarStart: '2026-06-17',
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
        setCells: {},
        writeContext: {
          taskId: null,
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
        phase: 'setp',
        mutations: fakeMutations({ bulkSet }),
      }),
    );

    act(() => {
      result.current.onBulk();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(bulkSet.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().setCells).toEqual({});
  });

  it('reports missing cell metadata before setting a calendar cell locally without persistence', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        target: { di: 0, tk: '朝' },
        setCells: {},
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
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

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(cellMutation.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().setCells[key]).toBeUndefined();
  });

  it('reports missing cell metadata before returning an audit cell to set locally', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        setCells: { [key]: 'set' },
        auditCells: { [key]: 'ok' },
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
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

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(cellMutation.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().setCells[key]).toBe('set');
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');
  });

  it('reports missing calendar cell metadata before saving a local-only hold', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const key = 'patient_1:0:朝';
    const cellMutation = mutationStub();

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
          cellMeta: {},
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
      result.current.onSaveHold();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(cellMutation.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().setCells[key]).toBe('set');
    expect(useWorkbenchStore.getState().holdInfo[key]).toBeUndefined();
    expect(useWorkbenchStore.getState().holdModal).toMatchObject({ reason: '在庫不足' });
  });

  it('reports missing cycle context before saving a grid hold locally without persistence', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const createHold = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
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
          taskId: 'task_1',
          cycleId: null,
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
        phase: 'dispense',
        mutations: fakeMutations({ createHold }),
      }),
    );

    act(() => {
      result.current.onSaveHold();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(createHold.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().holdInfo).toEqual({});
    expect(useWorkbenchStore.getState().holdModal).toMatchObject({ reason: '在庫不足' });
  });

  it('reports missing audit context instead of silently no-oping an audit primary submit', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        model: {
          patient_1: [
            {
              gid: 'g_1',
              label: '朝食後',
              method: '一包化',
              start: '2026-04-01',
              days: 14,
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
        done: { line_1: true },
        audit: { line_1: true },
        writeContext: {
          taskId: null,
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
      }),
    );

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(completeAudit.mutate).not.toHaveBeenCalled();
  });

  it('reports missing set-audit plan context instead of silently no-oping final approval', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
        writeContext: {
          taskId: null,
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
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
      }),
    );

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(setAudit.mutate).not.toHaveBeenCalled();
  });

  it('rolls back a local group when the real packaging group create fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const createGroup = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [
          {
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
          },
        ],
        model: { patient_1: [] },
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
        phase: 'dispense',
        mutations: fakeMutations({ createGroup }),
      }),
    );

    act(() => {
      result.current.onAddGroup();
    });

    expect(createGroup.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().model.patient_1).toEqual([]);
  });
});
