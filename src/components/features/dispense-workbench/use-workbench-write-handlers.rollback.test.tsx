// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchMutations } from './use-workbench-mutations';
import type { Drug, SeedPatient } from './dispensing-workbench.types';
import type { PendingPrimary, PendingSetAuditReject } from './dispensing-workbench.write-types';

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
    editLines: mutationStub(),
    generateBatches: mutationStub(),
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

  it('requests confirmation before audit approval and submits it only on commit in real-data mode', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub((_input, options) => options?.onSuccess?.({}));
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

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
        onRequestConfirm,
      }),
    );

    // request 段: 検証 OK でも mutate せず ConfirmDialog を要求して null を返す。
    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({ phase: 'audit', next: 'setp', narcoticLines: [] });

    // commit 段: ダイアログ確定からのみ承認を送り、成功で onAdvance。
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeAudit.mutate).toHaveBeenCalledWith(
      { task_id: 'task_1', result: 'approved', expected_version: 4 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onAdvance).toHaveBeenCalledWith('setp');
  });

  it('carries narcotic double-count evidence through confirmation into the audit approval commit', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub((_input, options) => options?.onSuccess?.({}));
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

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
                  did: 'line_narcotic',
                  name: 'モルヒネ徐放錠',
                  yoho: '朝食後',
                  a: '1',
                  h: '',
                  y: '',
                  n: '',
                  tag: '麻薬',
                  funsai: false,
                  note: '',
                  dispensedQuantity: 12,
                  isNarcotic: true,
                },
              ],
            },
          ],
        },
        done: { line_narcotic: true },
        audit: { line_narcotic: true },
        auditDoubleCountByDid: {
          line_narcotic: { first: '12', second: '12' },
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
        phase: 'audit',
        mutations: fakeMutations({ completeAudit }),
        onAdvance,
        onRequestConfirm,
      }),
    );

    // request 段: 麻薬 line のみを descriptor.narcoticLines に載せ、mutate せず確認を要求する。
    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({
      phase: 'audit',
      next: 'setp',
      narcoticLines: [
        {
          line_id: 'line_narcotic',
          drug_name: 'モルヒネ徐放錠',
          dispensed_quantity: 12,
          first_count: 12,
          second_count: 12,
        },
      ],
    });

    // commit 段: 二重計数証跡を含む承認を送り、成功で onAdvance。
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeAudit.mutate).toHaveBeenCalledWith(
      {
        task_id: 'task_1',
        result: 'approved',
        expected_version: 4,
        double_count: [
          {
            line_id: 'line_narcotic',
            drug_name: 'モルヒネ徐放錠',
            dispensed_quantity: 12,
            first_count: 12,
            second_count: 12,
          },
        ],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onAdvance).toHaveBeenCalledWith('setp');
  });

  it('does not submit narcotic audit approval until both double counts match actual quantity', async () => {
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
                  did: 'line_narcotic',
                  name: 'モルヒネ徐放錠',
                  yoho: '朝食後',
                  a: '1',
                  h: '',
                  y: '',
                  n: '',
                  tag: '麻薬',
                  funsai: false,
                  note: '',
                  dispensedQuantity: 12,
                  isNarcotic: true,
                },
              ],
            },
          ],
        },
        done: { line_narcotic: true },
        audit: { line_narcotic: true },
        auditDoubleCountByDid: {
          line_narcotic: { first: '12', second: '' },
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
    expect(toastErrorMock).toHaveBeenCalledWith(
      '麻薬ダブルカウントが未完了です。1回目・2回目を実数量と一致する値で入力してください。',
    );
    expect(onAdvance).not.toHaveBeenCalled();
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

  it('clears optimistic dispense row checks when dispense completion fails after confirmation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub((_input, options) =>
      options?.onError?.(new Error('fail')),
    );
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

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
        quantityConfirmedByDid: { line_1: true },
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
        onRequestConfirm,
      }),
    );

    // request 段: mutate せず確認を要求する。
    act(() => {
      result.current.onPrimary();
    });

    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({ phase: 'dispense' });

    // commit 段: 失敗時に楽観 done をロールバックし onAdvance しない。
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeDispense.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().done.line_1).toBeUndefined();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('clears optimistic audit row checks when dispense audit completion fails after confirmation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub((_input, options) => options?.onError?.(new Error('fail')));
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

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
        onRequestConfirm,
      }),
    );

    // request 段: mutate せず確認を要求する。
    act(() => {
      result.current.onPrimary();
    });

    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({ phase: 'audit' });

    // commit 段: 失敗時に楽観 audit をロールバックし onAdvance しない。
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeAudit.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().audit.line_1).toBeUndefined();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('clears optimistic set-audit cell, checklist, and NG state when final approval fails after confirmation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub((_input, options) => options?.onError?.(new Error('fail')));
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();
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
        onRequestConfirm,
      }),
    );

    // request 段: mutate せず確認を要求する。
    act(() => {
      result.current.onPrimary();
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({ phase: 'seta' });

    // commit 段: 失敗時に楽観 auditCells/checks/ng をロールバックし onAdvance しない。
    act(() => {
      result.current.commitPrimary(descriptor);
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
      options?.onSuccess?.({ data: { id: 'packaging_group_1', version: 0 } }),
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
    expect(useWorkbenchStore.getState().writeContext.groupVersionByGid?.[group.gid]).toBe(0);
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

  it('does not create a local group while another real-data write is pending', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const createGroup = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        patients: [patientFixture],
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
        mutations: fakeMutations({ createGroup, isAnyPending: true }),
      }),
    );

    act(() => {
      result.current.onAddGroup();
    });

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

  it('blocks dispense completion when a checked real-data line has unresolved prescribed quantity', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onAdvance = vi.fn();

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
                  name: '薬剤A',
                  yoho: '朝食後',
                  a: '1',
                  h: '',
                  y: '',
                  n: '',
                  tag: '',
                  funsai: false,
                  note: '',
                  prescribedQuantity: null,
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

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      '処方数量が未確定の薬剤があります。処方取込で数量を確認してから調剤完了してください。',
    );
    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('blocks dispense completion when actual quantity has not been explicitly confirmed', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onAdvance = vi.fn();

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
                  name: '薬剤A',
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
        quantityConfirmedByDid: {},
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

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      '実数量の確認が未完了の薬剤があります。数量確認を押してから調剤完了してください。',
    );
    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('blocks manual actual quantity completion when discrepancy reason is missing', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onAdvance = vi.fn();

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
                  name: '薬剤A',
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
        quantityConfirmedByDid: { line_1: true },
        actualQuantityInputByDid: { line_1: '12' },
        discrepancyReasonByDid: {},
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

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      '処方数量と異なる実数量には差異理由を入力してください。',
    );
    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
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

  it('sends the packaging group version when changing a real group method', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const saveGroups = mutationStub((_input, options) =>
      options?.onSuccess?.({ data: { updated: [{ id: 'packaging_group_1', version: 4 }] } }),
    );

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
          groupIdByGid: { group_1: 'packaging_group_1' },
          groupVersionByGid: { group_1: 3 },
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

    expect(saveGroups.mutate).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        groups: [{ id: 'packaging_group_1', method: 'PTP（手撒き）', version: 3 }],
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().model.patient_1?.[0]?.method).toBe('PTP（手撒き）');
    expect(useWorkbenchStore.getState().writeContext.groupVersionByGid?.group_1).toBe(4);
  });

  it('reports missing context before changing a real group method without a version', async () => {
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
          groupIdByGid: { group_1: 'packaging_group_1' },
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

  it('rolls back a real group method change when save fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const saveGroups = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

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
          groupIdByGid: { group_1: 'packaging_group_1' },
          groupVersionByGid: { group_1: 3 },
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

    expect(saveGroups.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().model.patient_1?.[0]?.method).toBe('一包化');
    expect(useWorkbenchStore.getState().writeContext.groupVersionByGid?.group_1).toBe(3);
  });

  it('persists real-data group start date through an atomic line-period update', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const editLines = mutationStub((_input, options) =>
      options?.onSuccess?.({
        data: {
          updated: [
            {
              id: 'line_1',
              start_date: '2026-06-20',
              end_date: '2026-07-03',
              days: 14,
              updated_at: '2026-06-18T01:00:00.000Z',
            },
            {
              id: 'line_2',
              start_date: '2026-06-20',
              end_date: '2026-07-03',
              days: 14,
              updated_at: '2026-06-18T01:01:00.000Z',
            },
          ],
        },
      }),
    );

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
                {
                  did: 'line_2',
                  name: 'マグミット錠250mg',
                  yoho: '夕食後',
                  a: '',
                  h: '',
                  y: '1',
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
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: {
            line_1: 'packaging_group_1',
            line_2: 'packaging_group_1',
          },
          lineMetaByDid: {
            line_1: {
              updatedAt: '2026-06-18T00:00:00.000Z',
              startDate: '2026-06-17',
              endDate: '2026-06-30',
              days: 14,
            },
            line_2: {
              updatedAt: '2026-06-18T00:01:00.000Z',
              startDate: '2026-06-17',
              endDate: '2026-06-30',
              days: 14,
            },
          },
          groupIdByGid: { group_1: 'packaging_group_1' },
          cellMeta: {},
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ editLines }),
      }),
    );

    act(() => {
      result.current.onGroupStart('group_1', '2026-06-20');
    });

    expect(editLines.mutate).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        client_action_id: expect.stringMatching(/^group-period:/),
        packaging_group_id: 'packaging_group_1',
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
          },
          {
            line_id: 'line_2',
            expected_updated_at: '2026-06-18T00:01:00.000Z',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
          },
        ],
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().model.patient_1?.[0]?.start).toBe('2026-06-20');
    expect(useWorkbenchStore.getState().writeContext.lineMetaByDid?.line_1).toMatchObject({
      updatedAt: '2026-06-18T01:00:00.000Z',
      startDate: '2026-06-20',
      endDate: '2026-07-03',
      days: 14,
    });
  });

  it('persists real-data group days with computed end_date', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const editLines = mutationStub((_input, options) =>
      options?.onSuccess?.({
        data: {
          updated: [
            {
              id: 'line_1',
              start_date: '2026-06-20',
              end_date: '2026-07-17',
              days: 28,
              updated_at: '2026-06-18T01:00:00.000Z',
            },
          ],
        },
      }),
    );

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
              start: '2026-06-20',
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
        writeContext: {
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: { line_1: 'packaging_group_1' },
          lineMetaByDid: {
            line_1: {
              updatedAt: '2026-06-18T00:00:00.000Z',
              startDate: '2026-06-20',
              endDate: '2026-07-03',
              days: 14,
            },
          },
          groupIdByGid: { group_1: 'packaging_group_1' },
          cellMeta: {},
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ editLines }),
      }),
    );

    act(() => {
      result.current.onGroupDays('group_1', '28');
    });

    expect(editLines.mutate).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        client_action_id: expect.stringMatching(/^group-period:/),
        packaging_group_id: 'packaging_group_1',
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            days: 28,
            start_date: '2026-06-20',
            end_date: '2026-07-17',
          },
        ],
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().model.patient_1?.[0]?.days).toBe(28);
    expect(useWorkbenchStore.getState().writeContext.lineMetaByDid?.line_1).toMatchObject({
      updatedAt: '2026-06-18T01:00:00.000Z',
      days: 28,
      endDate: '2026-07-17',
    });
  });

  it('reports missing line context before real-data group period edits create local-only state', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const editLines = mutationStub();

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
        writeContext: {
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: { line_1: 'packaging_group_1' },
          groupIdByGid: { group_1: 'packaging_group_1' },
          cellMeta: {},
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ editLines }),
      }),
    );

    act(() => {
      result.current.onGroupDays('group_1', '28');
    });

    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
    expect(editLines.mutate).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().model.patient_1?.[0]).toMatchObject({
      start: '2026-06-17',
      days: 14,
    });
  });

  it('rolls back a real-data group period edit when the atomic save fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const editLines = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

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
        writeContext: {
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: { line_1: 'packaging_group_1' },
          lineMetaByDid: {
            line_1: {
              updatedAt: '2026-06-18T00:00:00.000Z',
              startDate: '2026-06-17',
              endDate: '2026-06-30',
              days: 14,
            },
          },
          groupIdByGid: { group_1: 'packaging_group_1' },
          cellMeta: {},
        },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ editLines }),
      }),
    );

    act(() => {
      result.current.onGroupStart('group_1', '2026-06-20');
    });

    expect(editLines.mutate).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().model.patient_1?.[0]?.start).toBe('2026-06-17');
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

  it('rejects real-data drag into a group without a backend id before local movement', async () => {
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
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: { line_1: 'packaging_group_1' },
          groupIdByGid: { group_1: 'packaging_group_1' },
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

  it('sends the expected current group when dragging a real line to another group', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const assignLines = mutationStub((_input, options) => options?.onSuccess?.({ data: {} }));

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
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: { line_1: 'packaging_group_1' },
          groupIdByGid: {
            group_1: 'packaging_group_1',
            group_2: 'packaging_group_2',
          },
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

    expect(assignLines.mutate).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        assignments: [
          {
            line_id: 'line_1',
            packaging_group_id: 'packaging_group_2',
            expected_packaging_group_id: 'packaging_group_1',
          },
        ],
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().writeContext.lineGroupByDid.line_1).toBe(
      'packaging_group_2',
    );
    expect(
      useWorkbenchStore.getState().model.patient_1?.[1]?.drugs.map((drug) => drug.did),
    ).toEqual(['line_1']);
  });

  it('rolls back a real line drag when the assignment save fails', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const assignLines = mutationStub((_input, options) => options?.onError?.(new Error('fail')));

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
          taskId: 'task_1',
          cycleId: 'cycle_1',
          cycleVersion: 4,
          planId: null,
          lineGroupByDid: { line_1: 'packaging_group_1' },
          groupIdByGid: {
            group_1: 'packaging_group_1',
            group_2: 'packaging_group_2',
          },
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

    expect(assignLines.mutate).toHaveBeenCalled();
    expect(
      useWorkbenchStore.getState().model.patient_1?.[0]?.drugs.map((drug) => drug.did),
    ).toEqual(['line_1']);
    expect(useWorkbenchStore.getState().model.patient_1?.[1]?.drugs).toEqual([]);
    expect(useWorkbenchStore.getState().writeContext.lineGroupByDid.line_1).toBe(
      'packaging_group_1',
    );
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

describe('useWorkbenchWriteHandlers generate set batches', () => {
  afterEach(() => {
    vi.doUnmock('./dispensing-workbench.adapter');
    vi.resetModules();
    toastErrorMock.mockReset();
    window.localStorage.clear();
  });

  function seedSetPlan(
    useWorkbenchStore: Awaited<ReturnType<typeof importRealDataHandlers>>['useWorkbenchStore'],
    calendarGeneration: unknown,
  ) {
    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 1,
          planId: 'plan_1',
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
        },
        calendarGeneration: calendarGeneration as ReturnType<
          typeof useWorkbenchStore.getState
        >['calendarGeneration'],
      });
    });
  }

  it('requests an initial (non-force) generation with the resolved plan context', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const generateBatches = mutationStub();
    seedSetPlan(useWorkbenchStore, null);

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ generateBatches }),
      }),
    );

    act(() => {
      result.current.onGenerateBatches(false);
    });

    expect(generateBatches.mutate).toHaveBeenCalledWith({ force: false });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('requests a force regeneration with the set plan OCC anchor', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const generateBatches = mutationStub();
    seedSetPlan(useWorkbenchStore, {
      batch_count: 14,
      needs_initial_generation: false,
      latest_batch_updated_at: null,
      expected_updated_at: '2026-06-20T00:00:00.000Z',
      can_generate: false,
      can_force_regenerate: true,
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ generateBatches }),
      }),
    );

    act(() => {
      result.current.onGenerateBatches(true);
    });

    expect(generateBatches.mutate).toHaveBeenCalledWith({
      force: true,
      expected_updated_at: '2026-06-20T00:00:00.000Z',
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('refuses a force regeneration without an OCC anchor and surfaces an error', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const generateBatches = mutationStub();
    seedSetPlan(useWorkbenchStore, null);

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ generateBatches }),
      }),
    );

    act(() => {
      result.current.onGenerateBatches(true);
    });

    expect(generateBatches.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'セットプランの版情報を取得できませんでした。患者を再選択してから実行してください。',
    );
  });

  it('reports missing plan context instead of generating without a set plan', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const generateBatches = mutationStub();

    act(() => {
      useWorkbenchStore.setState({
        selId: 'patient_1',
        writeContext: {
          taskId: null,
          cycleId: 'cycle_1',
          cycleVersion: 1,
          planId: null,
          lineGroupByDid: {},
          groupIdByGid: {},
          cellMeta: {},
        },
        calendarGeneration: null,
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ generateBatches }),
      }),
    );

    act(() => {
      result.current.onGenerateBatches(false);
    });

    expect(generateBatches.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(MISSING_WRITE_CONTEXT_MESSAGE);
  });

  it('guards against double submission while another real-data write is pending', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const generateBatches = mutationStub();
    seedSetPlan(useWorkbenchStore, null);

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ generateBatches, isAnyPending: true }),
      }),
    );

    act(() => {
      result.current.onGenerateBatches(false);
    });

    expect(generateBatches.mutate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// S0: 不可逆 sign-off の ConfirmDialog gating（request/commit 分割）
// テスト計画 §5（1-8 / site 1-3 = dispense/audit/seta）。実装 = onRequestConfirm を
// 受ける onPrimary（request 段）と commitPrimary（確定段）。
// ============================================================================

const UNCONFIRMED_DISPENSE_QUANTITY_MESSAGE =
  '実数量の確認が未完了の薬剤があります。数量確認を押してから調剤完了してください。';
const INVALID_AUDIT_DOUBLE_COUNT_MESSAGE =
  '麻薬ダブルカウントが未完了です。1回目・2回目を実数量と一致する値で入力してください。';
const INCOMPLETE_CARRY_PACKET_MESSAGE =
  '外薬同梱と訪問持出パケットの確認証跡を作成できません。セット工程を再確認してください。';
const CONFIRM_TARGET_DRIFT_MESSAGE = '確認中に対象が変わりました。操作をやり直してください。';

function plainDrug(overrides: Partial<Drug> & Pick<Drug, 'did' | 'name'>): Drug {
  return {
    yoho: '朝食後',
    a: '1',
    h: '',
    y: '',
    n: '',
    tag: '',
    funsai: false,
    note: '',
    ...overrides,
  };
}

/** dispense 確定が前段ガードを通過する最小 store 状態。 */
function dispenseReadyState() {
  return {
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
          drugs: [plainDrug({ did: 'line_1', name: 'アムロジピン錠5mg', prescribedQuantity: 14 })],
        },
      ],
    },
    done: { line_1: true },
    quantityConfirmedByDid: { line_1: true },
    writeContext: {
      taskId: 'task_1',
      cycleId: 'cycle_1',
      cycleVersion: 4,
      planId: null,
      lineGroupByDid: {},
      groupIdByGid: {},
      cellMeta: {},
    },
  };
}

/** audit 承認が前段ガードを通過する最小 store 状態（非麻薬）。 */
function auditReadyState() {
  return {
    selId: 'patient_1',
    model: {
      patient_1: [
        {
          gid: 'group_1',
          label: '朝食後',
          method: '一包化',
          start: '2026-06-17',
          days: 1,
          drugs: [plainDrug({ did: 'line_1', name: 'アムロジピン錠5mg' })],
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
  };
}

/** audit 承認が前段ガードを通過する最小 store 状態（麻薬 line を含む）。 */
function auditNarcoticReadyState() {
  return {
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
            plainDrug({ did: 'line_plain', name: 'アムロジピン錠5mg' }),
            plainDrug({
              did: 'line_narcotic',
              name: 'モルヒネ徐放錠',
              tag: '麻薬',
              dispensedQuantity: 12,
              isNarcotic: true,
            }),
          ],
        },
      ],
    },
    done: { line_plain: true, line_narcotic: true },
    audit: { line_plain: true, line_narcotic: true },
    auditDoubleCountByDid: { line_narcotic: { first: '12', second: '12' } },
    writeContext: {
      taskId: 'task_1',
      cycleId: 'cycle_1',
      cycleVersion: 4,
      planId: null,
      lineGroupByDid: {},
      groupIdByGid: {},
      cellMeta: {},
    },
  };
}

/** set-audit 承認が前段ガードを通過する最小 store 状態。 */
function setaReadyState() {
  const key = 'patient_1:0:朝';
  return {
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
          drugs: [plainDrug({ did: 'line_1', name: 'アムロジピン錠5mg' })],
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
    packet: { 'patient_1:cal': true, 'patient_1:doc': true, 'patient_1:note': true },
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
  };
}

describe('useWorkbenchWriteHandlers confirm gating (S0 request/commit split)', () => {
  afterEach(() => {
    vi.doUnmock('./dispensing-workbench.adapter');
    vi.resetModules();
    toastErrorMock.mockReset();
    window.localStorage.clear();
  });

  // ── §5-1 前段ガード: onPrimary は mutate せず descriptor 付きで confirm を要求する ──

  it('dispense onPrimary requests confirmation without mutating', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(dispenseReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
        onRequestConfirm,
      }),
    );

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBeNull();
    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    expect(onRequestConfirm.mock.calls[0][0]).toMatchObject({ phase: 'dispense', next: 'audit' });
  });

  it('audit onPrimary requests confirmation without mutating', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(auditReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations({ completeAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    expect(onRequestConfirm.mock.calls[0][0]).toMatchObject({
      phase: 'audit',
      next: 'setp',
      narcoticLines: [],
    });
  });

  it('set-audit onPrimary requests confirmation without mutating', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(setaReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    expect(onRequestConfirm.mock.calls[0][0]).toMatchObject({ phase: 'seta', next: 'seta' });
  });

  // ── §5-2 confirm 後のみ commit: commitPrimary は正 payload で 1 回だけ mutate する ──

  it('dispense commitPrimary submits exactly once with expected_version', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub((_input, options) => options?.onSuccess?.({}));
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(dispenseReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
        onAdvance,
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeDispense.mutate).toHaveBeenCalledTimes(1);
    expect(completeDispense.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 'task_1',
        expected_version: 4,
        lines: expect.arrayContaining([expect.objectContaining({ line_id: 'line_1' })]),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(onAdvance).toHaveBeenCalledWith('audit');
  });

  it('audit commitPrimary submits exactly once with expected_version', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub((_input, options) => options?.onSuccess?.({}));
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(auditReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations({ completeAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeAudit.mutate).toHaveBeenCalledTimes(1);
    expect(completeAudit.mutate).toHaveBeenCalledWith(
      { task_id: 'task_1', result: 'approved', expected_version: 4 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('set-audit commitPrimary submits exactly once with per-cell expected_version', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub((_input, options) => options?.onSuccess?.({}));
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(setaReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(setAudit.mutate).toHaveBeenCalledTimes(1);
    expect(setAudit.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: 'plan_1',
        result: 'approved',
        cell_audits: expect.arrayContaining([
          expect.objectContaining({ batch_id: 'batch_1', audit_state: 'ok', expected_version: 7 }),
        ]),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  // ── §5-3 cancel/Escape 相当: 確定しなければ書込スライスは無変化（target は対象外 / C5）──

  it('cancelling (no commit) leaves clinical write slices unchanged and never mutates', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(setaReadyState());
    });

    const before = useWorkbenchStore.getState();
    const snapshot = {
      done: { ...before.done },
      audit: { ...before.audit },
      setCells: { ...before.setCells },
      auditCells: { ...before.auditCells },
      checks: { ...before.checks },
      ng: { ...before.ng },
    };

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestConfirm,
      }),
    );

    // request 段のみ（= ダイアログを開く）。commitPrimary は呼ばない（cancel/Escape 相当）。
    act(() => {
      result.current.onPrimary();
    });

    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    expect(setAudit.mutate).not.toHaveBeenCalled();
    const after = useWorkbenchStore.getState();
    expect(after.done).toEqual(snapshot.done);
    expect(after.audit).toEqual(snapshot.audit);
    expect(after.setCells).toEqual(snapshot.setCells);
    expect(after.auditCells).toEqual(snapshot.auditCells);
    expect(after.checks).toEqual(snapshot.checks);
    expect(after.ng).toEqual(snapshot.ng);
  });

  // ── §5-4 検証 NG は confirm を開かない（onRequestConfirm 未呼出・toast.error のみ）──

  it('dispense validation failure does not open confirmation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState({ ...dispenseReadyState(), quantityConfirmedByDid: {} });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(onRequestConfirm).not.toHaveBeenCalled();
    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(UNCONFIRMED_DISPENSE_QUANTITY_MESSAGE);
  });

  it('audit narcotic double-count mismatch does not open confirmation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState({
        ...auditNarcoticReadyState(),
        auditDoubleCountByDid: { line_narcotic: { first: '12', second: '' } },
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations({ completeAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(onRequestConfirm).not.toHaveBeenCalled();
    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(INVALID_AUDIT_DOUBLE_COUNT_MESSAGE);
  });

  it('set-audit incomplete carry packet evidence does not open confirmation', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState({ ...setaReadyState(), packet: { 'patient_1:cal': true } });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    expect(onRequestConfirm).not.toHaveBeenCalled();
    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(INCOMPLETE_CARRY_PACKET_MESSAGE);
  });

  // ── §5-5 麻薬分岐: descriptor.narcoticLines は麻薬 line のみ（非麻薬は空）──

  it('audit descriptor carries only narcotic lines when a narcotic is present', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(auditNarcoticReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations(),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor.phase).toBe('audit');
    // 非麻薬 line（line_plain）は含めず、麻薬 line のみ。
    expect(descriptor.phase === 'audit' && descriptor.narcoticLines).toEqual([
      {
        line_id: 'line_narcotic',
        drug_name: 'モルヒネ徐放錠',
        dispensed_quantity: 12,
        first_count: 12,
        second_count: 12,
      },
    ]);
  });

  it('audit descriptor narcoticLines is empty when no narcotic is present', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(auditReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations(),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });

    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor.phase === 'audit' && descriptor.narcoticLines).toEqual([]);
  });

  // ── §5-7 commit 直前に store が NG へ変わると mutate せず toast.error ──

  it('commitPrimary re-validates and aborts when the store drifts to an invalid state', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(dispenseReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
        onAdvance,
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;

    // 確認中に背景 refetch 等で数量確認が外れた状態を再現。
    act(() => {
      useWorkbenchStore.setState({ quantityConfirmedByDid: {} });
    });

    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(UNCONFIRMED_DISPENSE_QUANTITY_MESSAGE);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  // ── §5-8 F-key ガード ──
  // F8-F12（phaseDispense/phaseAudit/phaseSet/phaseSetAudit/next）の no-op ガードは
  // dispensing-workbench.tsx の runAction（pendingPrimary !== null 早期 return,
  // 同ファイル ~320-329 行）に実装される component-internal ロジックで、runAction /
  // buildPrimaryConfirm は export されていないため hook 単体からは直接観測できない
  // （実装変更は本タスクの禁止事項のため export 追加もしない）。
  // ここでは、そのガードが依存する hook 側の前提条件 = real-data の onPrimary が
  // 「ナビを返さず（null）pendingPrimary を立てる」契約を固定する。pendingPrimary が
  // 非 null になることで runAction の F-key 早期 return が発火する。
  it('onPrimary returns null and raises pendingPrimary, the precondition for the F-key guard', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(dispenseReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations(),
        onRequestConfirm,
      }),
    );

    // F12（runAction('next')）→ onPrimary。real-data では遷移用の値を返さない（null）。
    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    // null のため runAction('next') の `if (nextPhase) router.push` は no-op。
    expect(nextPhase).toBeNull();
    // pendingPrimary（= onRequestConfirm の引数）が立つので以降の F8-F12 が runAction で抑止される。
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  // ── #1 setp は確認非対象（可逆ナビゲーション）──
  // T1: phase='setp' の onPrimary はゲート通過で next='seta' を返し、onRequestConfirm/mutation を呼ばない。
  it('setp onPrimary returns the next phase without requesting confirmation or mutating (#1)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const bulkSet = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      // setaReadyState はカレンダーを充填済み（setCells=set / packet 完備 / 外薬なし）で setp ゲートも通る。
      useWorkbenchStore.setState(setaReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'setp',
        mutations: fakeMutations({ bulkSet }),
        onRequestConfirm,
      }),
    );

    let nextPhase: unknown;
    act(() => {
      nextPhase = result.current.onPrimary();
    });

    expect(nextPhase).toBe('seta');
    expect(onRequestConfirm).not.toHaveBeenCalled();
    expect(bulkSet.mutate).not.toHaveBeenCalled();
  });

  // ── #2 commit アンカー照合: 確認中に対象がドリフトしたら mutate しない ──
  it('dispense commitPrimary aborts with a drift toast when the patient anchor no longer matches (#2)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeDispense = mutationStub();
    const onAdvance = vi.fn();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(dispenseReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'dispense',
        mutations: fakeMutations({ completeDispense }),
        onAdvance,
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({
      phase: 'dispense',
      patientId: 'patient_1',
      taskId: 'task_1',
      cycleVersion: 4,
    });

    // 確認中に患者が切り替わった状況を再現（背景 refetch / 患者ナビ相当）。
    act(() => {
      useWorkbenchStore.setState({ selId: 'patient_2' });
    });

    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeDispense.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(CONFIRM_TARGET_DRIFT_MESSAGE);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('audit commitPrimary aborts when the cycle version anchor drifts (#2)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const completeAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(auditReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'audit',
        mutations: fakeMutations({ completeAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;

    // 確認中に cycle が版上がり（他更新の取り込み）した状況を再現。
    act(() => {
      useWorkbenchStore.setState((state) => ({
        writeContext: { ...state.writeContext, cycleVersion: 5 },
      }));
    });

    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(completeAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(CONFIRM_TARGET_DRIFT_MESSAGE);
  });

  it('set-audit commitPrimary aborts when the plan anchor drifts (#2)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState(setaReadyState());
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestConfirm,
      }),
    );

    act(() => {
      result.current.onPrimary();
    });
    const descriptor = onRequestConfirm.mock.calls[0][0] as PendingPrimary;
    expect(descriptor).toMatchObject({ phase: 'seta', patientId: 'patient_1', planId: 'plan_1' });

    act(() => {
      useWorkbenchStore.setState((state) => ({
        writeContext: { ...state.writeContext, planId: 'plan_2' },
      }));
    });

    act(() => {
      result.current.commitPrimary(descriptor);
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(CONFIRM_TARGET_DRIFT_MESSAGE);
  });

  // ── #2(a) F-key 全無効化の precondition ──
  // runAction / buildPrimaryConfirm は dispensing-workbench.tsx 内部実装で非 export のため
  // hook 単体からは prevPatient/nextPatient/bulk/hold/next の no-op を直接観測できない
  // （既存 §5-8 と同じ前例）。ここでは runAction の早期 return が依存する hook 側 precondition、
  // すなわち「real-data の onAuditNg が mutate せず reject 確認（pendingReject）を立てる」契約を固定する。
  // pendingPrimary もしくは pendingReject が非 null になることで runAction の全 F-key ガードが発火する。

  // ── #4 set-audit reject（per-cell NG）も Confirm ゲートを通す ──
  it('onAuditNg requests reject confirmation without mutating, then commits rejected exactly once (#4)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestRejectConfirm = vi.fn();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({ ...setaReadyState(), target: { di: 0, tk: '朝' } });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestRejectConfirm,
      }),
    );

    // request 段: mutate せず reject confirm を 1 回だけ要求する。
    act(() => {
      result.current.onAuditNg();
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(onRequestRejectConfirm).toHaveBeenCalledTimes(1);
    const descriptor = onRequestRejectConfirm.mock.calls[0][0] as PendingSetAuditReject;
    expect(descriptor).toMatchObject({
      patientId: 'patient_1',
      planId: 'plan_1',
      target: { di: 0, tk: '朝' },
      ngCode: 'drug_mismatch',
      ngLabel: '薬剤違い',
      meta: { batchIds: ['batch_1'], versions: [7] },
    });
    // 楽観 NG 表示も commit に寄せる（request 段では auditCells を変えない）。
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');

    // commit 段: rejected を per-cell expected_version 付きで 1 回だけ送る。
    act(() => {
      result.current.commitSetAuditReject(descriptor);
    });

    expect(setAudit.mutate).toHaveBeenCalledTimes(1);
    expect(setAudit.mutate).toHaveBeenCalledWith(
      {
        plan_id: 'plan_1',
        result: 'rejected',
        reject_reason: '薬剤違い',
        reject_reason_code: 'drug_mismatch',
        cell_audits: [
          {
            batch_id: 'batch_1',
            audit_state: 'ng',
            ng_code: 'drug_mismatch',
            expected_version: 7,
          },
        ],
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ng');
  });

  it('onAuditNg without an NG classification reports an error and does not request confirmation (#4)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestRejectConfirm = vi.fn();

    act(() => {
      useWorkbenchStore.setState({
        ...setaReadyState(),
        target: { di: 0, tk: '朝' },
        ng: {},
      });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestRejectConfirm,
      }),
    );

    act(() => {
      result.current.onAuditNg();
    });

    expect(onRequestRejectConfirm).not.toHaveBeenCalled();
    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('NG分類を選択してから実行してください。');
  });

  it('commitSetAuditReject aborts with a drift toast when the plan anchor no longer matches (#4)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestRejectConfirm = vi.fn();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({ ...setaReadyState(), target: { di: 0, tk: '朝' } });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestRejectConfirm,
      }),
    );

    act(() => {
      result.current.onAuditNg();
    });
    const descriptor = onRequestRejectConfirm.mock.calls[0][0] as PendingSetAuditReject;

    // 確認中に対象計画がドリフトした状況を再現。
    act(() => {
      useWorkbenchStore.setState((state) => ({
        writeContext: { ...state.writeContext, planId: 'plan_2' },
      }));
    });

    act(() => {
      result.current.commitSetAuditReject(descriptor);
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(CONFIRM_TARGET_DRIFT_MESSAGE);
    // 楽観 NG を適用しない（auditCells は据え置き）。
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');
  });

  it('commitSetAuditReject rolls back the optimistic NG cell when the rejected submission fails (#4)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub((_input, options) => options?.onError?.(new Error('fail')));
    const onRequestRejectConfirm = vi.fn();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({ ...setaReadyState(), target: { di: 0, tk: '朝' } });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestRejectConfirm,
      }),
    );

    act(() => {
      result.current.onAuditNg();
    });
    const descriptor = onRequestRejectConfirm.mock.calls[0][0] as PendingSetAuditReject;

    act(() => {
      result.current.commitSetAuditReject(descriptor);
    });

    expect(setAudit.mutate).toHaveBeenCalledTimes(1);
    // onError で元の auditCells（'ok'）へロールバックする。
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');
  });

  it('commitSetAuditReject aborts when the NG classification drifts after confirmation (round-3 S1)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestRejectConfirm = vi.fn();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({ ...setaReadyState(), target: { di: 0, tk: '朝' } });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestRejectConfirm,
      }),
    );

    act(() => {
      result.current.onAuditNg();
    });
    const descriptor = onRequestRejectConfirm.mock.calls[0][0] as PendingSetAuditReject;
    expect(descriptor.ngCode).toBe('drug_mismatch');

    // 確認中に同一セルの NG 分類が別コードへ再分類された状況を再現（薬剤違い→数量不足）。
    act(() => {
      useWorkbenchStore.setState((state) => ({ ng: { ...state.ng, [key]: '数量不足' } }));
    });

    act(() => {
      result.current.commitSetAuditReject(descriptor);
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(CONFIRM_TARGET_DRIFT_MESSAGE);
    // 楽観 NG を適用しない（auditCells は据え置き）。
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');
  });

  it('commitSetAuditReject aborts when the cell batch versions drift after confirmation (round-3 S1)', async () => {
    const { useWorkbenchStore, useWorkbenchWriteHandlers } = await importRealDataHandlers();
    const setAudit = mutationStub();
    const onRequestRejectConfirm = vi.fn();
    const key = 'patient_1:0:朝';

    act(() => {
      useWorkbenchStore.setState({ ...setaReadyState(), target: { di: 0, tk: '朝' } });
    });

    const { result } = renderHook(() =>
      useWorkbenchWriteHandlers({
        phase: 'seta',
        mutations: fakeMutations({ setAudit }),
        onRequestRejectConfirm,
      }),
    );

    act(() => {
      result.current.onAuditNg();
    });
    const descriptor = onRequestRejectConfirm.mock.calls[0][0] as PendingSetAuditReject;
    expect(descriptor.meta.versions).toEqual([7]);

    // 確認中に同一セルが refetch され batch version が進んだ状況を再現（version 7→8）。
    act(() => {
      useWorkbenchStore.setState((state) => ({
        writeContext: {
          ...state.writeContext,
          cellMeta: {
            ...state.writeContext.cellMeta,
            [key]: { batchIds: ['batch_1'], versions: [8], dayNumber: 1, slot: 'morning' },
          },
        },
      }));
    });

    act(() => {
      result.current.commitSetAuditReject(descriptor);
    });

    expect(setAudit.mutate).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(CONFIRM_TARGET_DRIFT_MESSAGE);
    expect(useWorkbenchStore.getState().auditCells[key]).toBe('ok');
  });
});
