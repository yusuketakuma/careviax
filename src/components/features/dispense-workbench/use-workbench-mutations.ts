'use client';

/**
 * 調剤ワークベンチ 書込結線 hook（計画 §12 楽観更新 / 競合 / 二重送信防止）。
 *
 * 設計上の単一書込境界。各 store 書込 action（調剤完了 / 監査 OK・NG / セル set・hold /
 * グループ編集 / 明細編集 / 構造化保留）から呼ぶ useMutation 群をここに集約する。
 *
 * 安全方針（厳守）:
 *  - **既定はモック**（isRealDataEnabled()=false）。その場合 mutationFn は早期 return し
 *    fetch を一切発火しない（adapter も MOCK_WRITE_NOOP を返すが、二重防御で hook 側でもガード）。
 *    楽観更新（store 反映）は呼び出し側 store action が従来どおり行うため、ここでは触らない。
 *  - 実データ時のみ adapter の書込関数を叩く。§12 の onMutate→cancel→snapshot→optimistic→return /
 *    onError→rollback+toast / onSettled→invalidate を実装する。
 *  - 競合 409（WorkbenchConflictError）は toast + 該当 query を最小 invalidate（再取得で解決導線）。
 *  - 二重送信は各 mutation の isPending を呼び出し側がボタン disabled に使う。
 *
 * queryKey は既存方針どおり [..., orgId] 形式。SSE（useRealtimeQuery invalidateOn
 * cycle_transition）と整合する read query を invalidate する。
 */

import { useCallback } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import {
  isRealDataEnabled,
  loadPatientsAsync,
  loadWorkbenchAsync,
  loadCalendarWriteContextAsync,
  submitDispenseResults,
  submitDispenseAudit,
  mutateCell,
  bulkSetCells,
  generateSetBatches,
  submitSetAudit,
  createCycleHold,
  resolveCycleHold,
  createGroup,
  updateGroups,
  assignLinesToGroup,
  updatePrescriptionLine,
  updatePrescriptionLines,
} from './dispensing-workbench.adapter';
import {
  WorkbenchConflictError,
  WorkbenchWriteError,
  type SubmitDispenseResultsInput,
  type SubmitDispenseAuditInput,
  type UpdatePrescriptionLinesInput,
  type CellMutationInput,
  type SubmitSetAuditInput,
  type CreateCycleHoldInput,
} from './dispensing-workbench.write-types';
import { useWorkbenchStore } from './dispensing-workbench.store';
import { isCalendarPhase, type Phase } from './dispensing-workbench.types';

/** ワークベンチ read query のキー（実データ hydrate / SSE 整合に使う）。 */
export function workbenchQueryKey(orgId: string, patientId: string): QueryKey {
  return ['dispense-workbench', 'workbench', patientId, orgId];
}

/** カレンダー read query のキー。 */
export function calendarQueryKey(orgId: string, planId: string): QueryKey {
  return ['dispense-workbench', 'calendar', planId, orgId];
}

/**
 * 409/失敗を toast に振り分ける共通ハンドラ。
 * - WorkbenchConflictError: 競合 toast（再取得で解決を促す）。
 * - WorkbenchWriteError: API の message をそのまま表示。
 * - その他: 既定メッセージ。
 */
export function reportWorkbenchError(error: unknown, fallback = '保存に失敗しました'): void {
  if (error instanceof WorkbenchConflictError) {
    toast.error(`${conflictMessage(error.details)} 最新の状態を再読み込みします。`);
    return;
  }
  if (error instanceof WorkbenchWriteError) {
    toast.error(error.message || fallback);
    return;
  }
  toast.error(messageFromError(error, fallback));
}

function conflictMessage(details: unknown): string {
  if (typeof details !== 'object' || details === null) {
    return '他の操作と競合しました。';
  }
  const payload = details as { message?: unknown };
  return typeof payload.message === 'string' && payload.message
    ? payload.message
    : '他の操作と競合しました。';
}

function recoverActiveQuery(queryClient: QueryClient, queryKey: QueryKey): void {
  void queryClient.invalidateQueries({ queryKey });
  void queryClient.refetchQueries({ queryKey, type: 'active' });
}

async function recoverWorkbenchDirect(
  phase: Phase,
  patientId: string,
  orgId?: string,
): Promise<void> {
  if (phase !== 'dispense' && phase !== 'audit') return;
  const patients = await loadPatientsAsync(phase, { orgId });
  if (patients.length === 0) {
    useWorkbenchStore.getState().hydrate({ patients: [] });
    return;
  }
  const targetId = patients.some((patient) => patient.id === patientId)
    ? patientId
    : patients[0].id;
  const workbench = await loadWorkbenchAsync(phase, targetId, { orgId });
  if (!workbench) {
    useWorkbenchStore.getState().hydrate({ patients: [] });
    return;
  }
  const store = useWorkbenchStore.getState();
  store.hydrate({
    patients,
    selId: targetId,
    model: { [workbench.patient.id]: workbench.groups },
    done: workbench.done,
    audit: workbench.audit,
  });
  useWorkbenchStore.getState().setWriteContext(workbench.writeContext);
}

async function recoverCalendarDirect(
  phase: Phase,
  patientId: string,
  planId: string | null,
  orgId?: string,
): Promise<void> {
  if (!isCalendarPhase(phase) || !planId) return;
  const result = await loadCalendarWriteContextAsync(patientId, planId, { orgId });
  if (!result) {
    useWorkbenchStore.getState().hydrate({ patients: [] });
    return;
  }
  const store = useWorkbenchStore.getState();
  store.setCalendarState({
    patientId,
    planId,
    generation: result.matrix.generation ?? null,
    ...result.calendarState,
  });
  useWorkbenchStore.getState().setWriteContext(result.writeContext);
}

/**
 * ワークベンチ書込 mutation 群。実データ時のみ発火（mock は no-op）。
 * 各 mutation は §12 の onError（rollback は呼び出し側 store action 責務、ここでは toast +
 * 競合時 invalidate）/ onSettled（invalidate）を実装する。
 */
export function useWorkbenchMutations(args: {
  patientId: string;
  planId: string | null;
  phase: Phase;
}) {
  const { patientId, planId, phase } = args;
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  /** 競合 / 失敗時に該当 read query を最小 invalidate（解決導線＝再取得）。 */
  const invalidateWorkbench = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workbenchQueryKey(orgId, patientId) });
  }, [queryClient, orgId, patientId]);

  const recoverWorkbench = useCallback(() => {
    recoverActiveQuery(queryClient, workbenchQueryKey(orgId, patientId));
    void recoverWorkbenchDirect(phase, patientId, orgId);
  }, [queryClient, orgId, patientId, phase]);

  const invalidateCalendar = useCallback(() => {
    if (!planId) return;
    void queryClient.invalidateQueries({ queryKey: calendarQueryKey(orgId, planId) });
  }, [queryClient, orgId, planId]);

  const recoverCalendar = useCallback(() => {
    if (!planId) return;
    recoverActiveQuery(queryClient, calendarQueryKey(orgId, planId));
    void recoverCalendarDirect(phase, patientId, planId, orgId);
  }, [queryClient, orgId, patientId, planId, phase]);

  // ── 調剤完了（POST /api/dispense-results, OCC=cycle.version）──
  const completeDispense = useMutation({
    mutationFn: async (input: SubmitDispenseResultsInput) => {
      if (!isRealDataEnabled()) return null; // mock: store-only（現行 UI 不変）
      return submitDispenseResults(input);
    },
    onError: (error) => {
      reportWorkbenchError(error, '調剤完了の登録に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── 調剤監査完了（POST /api/dispense-audits）──
  const completeAudit = useMutation({
    mutationFn: async (input: SubmitDispenseAuditInput) => {
      if (!isRealDataEnabled()) return null;
      return submitDispenseAudit(input);
    },
    onError: (error) => {
      reportWorkbenchError(error, '調剤監査の登録に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── セル set/hold/clear（PATCH /api/set-plans/[planId]/batches/cell）──
  const cellMutation = useMutation({
    mutationFn: async (input: CellMutationInput) => {
      if (!isRealDataEnabled() || !planId) return null;
      return mutateCell(planId, input);
    },
    onError: (error) => {
      reportWorkbenchError(error, 'セルの更新に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverCalendar();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateCalendar();
    },
  });

  // ── 一括セット（POST /api/set-plans/[planId]/batches/bulk-set）──
  const bulkSet = useMutation({
    mutationFn: async (cells: Array<{ batch_id: string; expected_version?: number }>) => {
      if (!isRealDataEnabled() || !planId) return null;
      return bulkSetCells(planId, cells);
    },
    onError: (error) => {
      reportWorkbenchError(error, '一括セットに失敗しました');
      if (error instanceof WorkbenchConflictError) recoverCalendar();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateCalendar();
    },
  });

  // ── セットバッチ生成 / 再生成（POST /api/set-plans/[planId]/generate-batches）──
  const generateBatches = useMutation({
    mutationFn: async (input: { force: boolean; expected_updated_at?: string }) => {
      if (!isRealDataEnabled() || !planId) return null;
      return generateSetBatches(planId, input);
    },
    onError: (error) => {
      reportWorkbenchError(error, 'セットバッチの生成に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverCalendar();
    },
    // 生成は batch_id を総入れ替えするため cellMeta を再構築する必要がある。
    // invalidate だけでは store の cellMeta が古いままになるので calendar を再 hydrate する。
    onSuccess: () => {
      if (isRealDataEnabled()) recoverCalendar();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateCalendar();
    },
  });

  // ── セット監査 OK/部分/NG（POST /api/set-audits）──
  const setAudit = useMutation({
    mutationFn: async (input: SubmitSetAuditInput) => {
      if (!isRealDataEnabled()) return null;
      return submitSetAudit(input);
    },
    onError: (error) => {
      reportWorkbenchError(error, 'セット監査の登録に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverCalendar();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateCalendar();
    },
  });

  // ── 構造化保留 作成（POST /api/cycle-holds）──
  const createHold = useMutation({
    mutationFn: async (input: CreateCycleHoldInput) => {
      if (!isRealDataEnabled()) return null;
      return createCycleHold(input);
    },
    onError: (error) => {
      reportWorkbenchError(error, '保留の保存に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── 構造化保留 解決（PATCH /api/cycle-holds）──
  const resolveHold = useMutation({
    mutationFn: async (input: { id: string; note?: string }) => {
      if (!isRealDataEnabled()) return null;
      return resolveCycleHold(input);
    },
    onError: (error) => {
      reportWorkbenchError(error, '保留の解決に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── グループ作成（POST /api/dispense-tasks/[taskId]/groups）──
  const createPackagingGroup = useMutation({
    mutationFn: async (vars: {
      taskId: string;
      group: {
        group_key: string;
        label: string;
        method: string;
        slot?: string;
        sort_order?: number;
      };
    }) => {
      if (!isRealDataEnabled()) return null;
      return createGroup(vars.taskId, vars.group);
    },
    onError: (error) => {
      reportWorkbenchError(error, 'グループの作成に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── グループ属性の一括更新（PATCH /api/dispense-tasks/[taskId]/groups, groups[]）──
  const saveGroups = useMutation({
    mutationFn: async (vars: {
      taskId: string;
      groups: Array<{
        id: string;
        label?: string;
        method?: string;
        slot?: string | null;
        sort_order?: number;
        version: number;
      }>;
    }) => {
      if (!isRealDataEnabled()) return null;
      return updateGroups(vars.taskId, vars.groups);
    },
    onError: (error) => {
      reportWorkbenchError(error, 'グループの保存に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── 明細のグループ割当（PATCH /api/dispense-tasks/[taskId]/groups, assignments[]）──
  const assignLines = useMutation({
    mutationFn: async (vars: {
      taskId: string;
      assignments: Array<{
        line_id: string;
        packaging_group_id: string | null;
        expected_packaging_group_id: string | null;
      }>;
    }) => {
      if (!isRealDataEnabled()) return null;
      return assignLinesToGroup(vars.taskId, vars.assignments);
    },
    onError: (error) => {
      reportWorkbenchError(error, 'グループ割当の保存に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── 処方明細編集（PATCH /api/prescription-lines/[lineId]）──
  const editLine = useMutation({
    mutationFn: async (vars: {
      lineId: string;
      body: {
        expected_updated_at: string;
        start_date?: string | null;
        end_date?: string | null;
        days?: number;
        frequency?: string;
        dose?: string;
        quantity?: number | null;
        unit?: string | null;
      };
    }) => {
      if (!isRealDataEnabled()) return null;
      return updatePrescriptionLine(vars.lineId, vars.body);
    },
    onError: (error) => {
      reportWorkbenchError(error, '明細の保存に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  // ── 処方明細の一括期間編集（PATCH /api/dispense-tasks/[taskId]/lines）──
  const editLines = useMutation({
    mutationFn: async (input: UpdatePrescriptionLinesInput) => {
      if (!isRealDataEnabled()) return null;
      return updatePrescriptionLines(input);
    },
    onError: (error) => {
      reportWorkbenchError(error, '明細の一括保存に失敗しました');
      if (error instanceof WorkbenchConflictError) recoverWorkbench();
    },
    onSettled: () => {
      if (isRealDataEnabled()) invalidateWorkbench();
    },
  });

  return {
    completeDispense,
    completeAudit,
    cellMutation,
    bulkSet,
    generateBatches,
    setAudit,
    createHold,
    resolveHold,
    createGroup: createPackagingGroup,
    saveGroups,
    assignLines,
    editLine,
    editLines,
    /** いずれかの書込が進行中（シェルがグローバルな二重送信ガードに使える）。 */
    isAnyPending:
      completeDispense.isPending ||
      completeAudit.isPending ||
      cellMutation.isPending ||
      bulkSet.isPending ||
      generateBatches.isPending ||
      setAudit.isPending ||
      createHold.isPending ||
      resolveHold.isPending ||
      createPackagingGroup.isPending ||
      saveGroups.isPending ||
      assignLines.isPending ||
      editLine.isPending ||
      editLines.isPending,
  };
}

export type WorkbenchMutations = ReturnType<typeof useWorkbenchMutations>;
