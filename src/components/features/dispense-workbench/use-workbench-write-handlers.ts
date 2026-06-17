'use client';

/**
 * 調剤ワークベンチ 書込ハンドラ結線（計画 §12 / W3b）。
 *
 * 連携規約: 子コンポーネントは view/phase を受け、更新は「シェルから渡されるハンドラ」を呼ぶ。
 * 本フックがその単一の橋渡し点で、以下を担う:
 *  - 既定（モック / isRealDataEnabled()=false）: store アクションのみを呼ぶ。**API は一切叩かない**
 *    （現行 UI 挙動を完全保持）。
 *  - 実データ時: store アクション（楽観更新）を従来どおり呼び、加えて adapter 書込を mutation 経由で
 *    発火する。書込に必要な実データ識別子（task_id / plan_id / batch_id / version 等）は
 *    store.writeContext から解決する。解決不能なものは実データ時にローカルだけで進めない。
 *
 * 二重送信防止: いずれかの書込が進行中（mutations.isAnyPending）の間は、書込を伴う主操作
 * （一括 / 確定）を抑止する。セル単位の細粒度操作は楽観更新を優先しブロックしない。
 * 競合 409 / 失敗は mutation の onError（reportWorkbenchError + invalidate）へ委譲する。
 */

import { useMemo } from 'react';
import type { HoldScope } from '@prisma/client';
import { toast } from 'sonner';

import { useWorkbenchStore } from './dispensing-workbench.store';
import { isRealDataEnabled } from './dispensing-workbench.adapter';
import type { WorkbenchMutations } from './use-workbench-mutations';
import {
  HOLD_REASON_TO_CODE,
  NG_LABEL_TO_CODE,
  SET_AUDIT_CHECK_ITEMS,
  TIMING_TO_SLOT,
  type CellMeta,
  type RejectCode,
  type SetAuditChecklistKey,
  type CellMutationTarget,
  type SubmitSetAuditInput,
} from './dispensing-workbench.write-types';
import { cellKey } from './dispensing-workbench.logic';
import { isCalendarPhase } from './dispensing-workbench.types';
import type { CellTarget, Group, Phase } from './dispensing-workbench.types';

/** カレンダーセルの保留スコープ（API HoldScope）。1 セル＝cell 単位。 */
const CELL_HOLD_SCOPE: HoldScope = 'cell';
export interface WorkbenchWriteHandlers {
  // ── グリッド（dispense / audit）──
  /** 行チェック（調剤済 / 監査OK のトグル）。 */
  onToggleRow: (did: string) => void;
  /** グループ 調剤方法変更。 */
  onGroupMethod: (gid: string, value: string) => void;
  /** グループ 服用開始日変更。 */
  onGroupStart: (gid: string, value: string) => void;
  /** グループ 処方日数変更。 */
  onGroupDays: (gid: string, value: string) => void;
  /** D&D で薬剤を別グループへ移動（drop 先 gid）。 */
  onDropTo: (gid: string) => void;
  /** 新規グループ追加。 */
  onAddGroup: () => void;
  /** 一括処理（フェーズ依存・全調剤済 / 全監査OK / 全セット / 全OK）。 */
  onBulk: () => void;
  /** 主操作（次工程へ）。ゲート通過時のみ次 phase を返す（遷移は呼び出し側）。 */
  onPrimary: () => Phase | null;

  // ── カレンダー（setp）──
  /** セルを選択。 */
  onSelectCell: (di: number, tk: string) => void;
  /** 選択セルへ「セット済」。 */
  onSetCell: () => void;
  /** カレンダー外薬 同梱トグル。 */
  onToggleOut: (name: string) => void;
  /** 訪問持出パケット トグル。 */
  onTogglePacket: (item: string) => void;

  // ── セット監査（seta）──
  /** 選択セル 監査OK。 */
  onAuditOk: () => void;
  /** 選択セル NG・差戻し。 */
  onAuditNg: () => void;
  /** 確認項目トグル。 */
  onToggleCheck: (index: number) => void;
  /** NG 分類選択。 */
  onSetNg: (value: string) => void;
  /** 差戻し（セットへ戻す）。 */
  onReturnToSet: (di: number, tk: string) => void;

  // ── 保留（共通）──
  /** 保留モーダルを開く（選択セル対象）。 */
  onOpenHold: () => void;
  /** 保留登録（モーダル確定）。 */
  onSaveHold: () => void;
}

/** 選択セル（target）に対応する CellMeta を writeContext から解決する。 */
function resolveCellMeta(
  cellMeta: Record<string, CellMeta>,
  selId: string,
  target: CellTarget | null,
): CellMeta | null {
  if (!target) return null;
  return cellMeta[cellKey(selId, target.di, target.tk)] ?? null;
}

/** グループ配列から did → gid の所属マップを作る（D&D 移動 did の diff 用）。 */
function membershipOf(groups: Group[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups) {
    for (const d of g.drugs) out[d.did] = g.gid;
  }
  return out;
}

function clearBooleanKeys(
  values: Record<string, boolean>,
  keys: readonly string[],
): Record<string, boolean> {
  const next = { ...values };
  for (const key of keys) delete next[key];
  return next;
}

function removePatientPrefixed<T>(values: Record<string, T>, patientId: string): Record<string, T> {
  const prefix = `${patientId}:`;
  return Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith(prefix)));
}

function readReturnedBatchVersions(data: unknown): Array<{ id: string; version: number }> {
  const body = data as
    | { data?: { id?: unknown; version?: unknown; batches?: unknown } }
    | null
    | undefined;
  const payload = body?.data;
  if (!payload) return [];
  const batches = Array.isArray(payload.batches) ? payload.batches : [payload];
  return batches.flatMap((batch) => {
    const candidate = batch as { id?: unknown; version?: unknown };
    return typeof candidate.id === 'string' && typeof candidate.version === 'number'
      ? [{ id: candidate.id, version: candidate.version }]
      : [];
  });
}

function applyReturnedBatchVersions(data: unknown): void {
  const updates = readReturnedBatchVersions(data);
  if (updates.length === 0) return;
  const versionByBatchId = new Map(updates.map((batch) => [batch.id, batch.version]));
  useWorkbenchStore.setState((state) => {
    let changed = false;
    const cellMeta = Object.fromEntries(
      Object.entries(state.writeContext.cellMeta).map(([key, meta]) => {
        let metaChanged = false;
        const versions = meta.versions.map((version, index) => {
          const nextVersion = versionByBatchId.get(meta.batchIds[index]);
          if (nextVersion === undefined || nextVersion <= version) return version;
          metaChanged = true;
          return nextVersion;
        });
        if (!metaChanged) return [key, meta];
        changed = true;
        return [key, { ...meta, versions }];
      }),
    );
    if (!changed) return state;
    return {
      writeContext: {
        ...state.writeContext,
        cellMeta,
      },
    };
  });
}

function buildCellMutationTarget(meta: CellMeta): CellMutationTarget {
  if (meta.batchIds.length === 1) {
    return { batch_id: meta.batchIds[0], expected_version: meta.versions[0] };
  }
  return {
    cells: meta.batchIds.map((batchId, index) => ({
      batch_id: batchId,
      expected_version: meta.versions[index],
    })),
  };
}

/**
 * フェーズ別の書込ハンドラ束を返す。子はこれを props で受け取り onClick から呼ぶ。
 */
export function useWorkbenchWriteHandlers(args: {
  phase: Phase;
  mutations: WorkbenchMutations;
  onAdvance?: (phase: Phase) => void;
}): WorkbenchWriteHandlers {
  const { phase, mutations, onAdvance } = args;

  // store アクション（楽観更新 / モック挙動の正本）。
  const toggleRow = useWorkbenchStore((s) => s.toggleRow);
  const setGMethod = useWorkbenchStore((s) => s.setGMethod);
  const setGStart = useWorkbenchStore((s) => s.setGStart);
  const setGDays = useWorkbenchStore((s) => s.setGDays);
  const dropTo = useWorkbenchStore((s) => s.dropTo);
  const addGroup = useWorkbenchStore((s) => s.addGroup);
  const bulk = useWorkbenchStore((s) => s.bulk);
  const primary = useWorkbenchStore((s) => s.primary);
  const selectCell = useWorkbenchStore((s) => s.selectCell);
  const applyCell = useWorkbenchStore((s) => s.applyCell);
  const restoreCell = useWorkbenchStore((s) => s.restoreCell);
  const restoreCells = useWorkbenchStore((s) => s.restoreCells);
  const restoreHoldInfo = useWorkbenchStore((s) => s.restoreHoldInfo);
  const toggleOut = useWorkbenchStore((s) => s.toggleOut);
  const togglePacket = useWorkbenchStore((s) => s.togglePacket);
  const toggleCheck = useWorkbenchStore((s) => s.toggleCheck);
  const setNg = useWorkbenchStore((s) => s.setNg);
  const returnToSet = useWorkbenchStore((s) => s.returnToSet);
  const openHold = useWorkbenchStore((s) => s.openHold);
  const saveHold = useWorkbenchStore((s) => s.saveHold);

  const isAnyPending = mutations.isAnyPending;

  return useMemo<WorkbenchWriteHandlers>(() => {
    /** 実データ時のみ与えた関数を実行する（mock は no-op）。 */
    const real = (fn: () => void) => {
      if (isRealDataEnabled()) fn();
    };
    /** 最新 store 状態（mutation 用 id 解決はここから読む）。 */
    const snap = () => useWorkbenchStore.getState();
    const reportMissingWriteContext = () => {
      toast.error(
        '保存に必要な実データを取得できませんでした。患者を再選択してから実行してください。',
      );
    };
    const reportUnsupportedRealWrite = () => {
      toast.error('この項目は実データではまだ保存できません。最新状態を再読み込みしてください。');
    };
    const requireRealTaskContext = (s = snap()): boolean => {
      if (!isRealDataEnabled()) return true;
      if (s.writeContext.taskId) return true;
      reportMissingWriteContext();
      return false;
    };
    const requireRealPlanContext = (s = snap()): boolean => {
      if (!isRealDataEnabled()) return true;
      if (s.writeContext.planId) return true;
      reportMissingWriteContext();
      return false;
    };
    const requireRealCycleContext = (s = snap()): boolean => {
      if (!isRealDataEnabled()) return true;
      if (s.writeContext.cycleId) return true;
      reportMissingWriteContext();
      return false;
    };
    const requireRealCellContext = (
      s: ReturnType<typeof snap>,
      target: CellTarget | null,
    ): CellMeta | null => {
      if (!isRealDataEnabled()) return null;
      const meta = resolveCellMeta(s.writeContext.cellMeta, s.selId, target);
      if (s.writeContext.planId && meta) return meta;
      reportMissingWriteContext();
      return null;
    };
    const canSubmitRealPrimary = (s: ReturnType<typeof snap>): boolean => {
      if (phase === 'dispense' || phase === 'audit') {
        return !!s.writeContext.taskId && s.writeContext.cycleVersion !== null;
      }
      return !!s.writeContext.planId;
    };

    return {
      // ── グリッド ──
      onToggleRow: (did) => {
        // store 更新（楽観 UI）。実データの行単位 調剤/監査は確定（primary）・seta cell-audit が
        // 正本のため、行チェック単発では API を叩かない（現行 UI と同じく即時トグルのみ）。
        toggleRow(phase, did);
      },
      onGroupMethod: (gid, value) => {
        if (isRealDataEnabled()) {
          const s = snap();
          const groupId = s.writeContext.groupIdByGid[gid];
          if (!s.writeContext.taskId || !groupId) {
            reportMissingWriteContext();
            return;
          }
        }
        setGMethod(gid, value);
        real(() => {
          const s = snap();
          const taskId = s.writeContext.taskId;
          const groupId = s.writeContext.groupIdByGid[gid];
          if (!taskId || !groupId) {
            reportMissingWriteContext();
            return;
          }
          mutations.saveGroups.mutate({
            taskId,
            groups: [{ id: groupId, method: value }],
          });
        });
      },
      onGroupStart: (gid, value) => {
        if (isRealDataEnabled()) {
          reportUnsupportedRealWrite();
          return;
        }
        setGStart(gid, value);
        // 服用開始日はグループ属性 API（method/slot/label/sort_order）に無く、明細 start_date は
        // line 単位。グループ一括での開始日変更 API は未提供のため実データでも store のみ更新。
      },
      onGroupDays: (gid, value) => {
        if (isRealDataEnabled()) {
          reportUnsupportedRealWrite();
          return;
        }
        setGDays(gid, value);
        // 処方日数も同様にグループ属性 API に無いため store のみ更新。
      },
      onDropTo: (gid) => {
        // dropTo は内部の dragId を消費するため、移動前後の model を diff して移動 did を特定する。
        const beforeState = snap();
        if (!requireRealTaskContext(beforeState)) return;
        const before = membershipOf(beforeState.model[beforeState.selId] ?? []);
        dropTo(gid);
        real(() => {
          const s = snap();
          const taskId = s.writeContext.taskId;
          if (!taskId) {
            reportMissingWriteContext();
            return;
          }
          const groupId = s.writeContext.groupIdByGid[gid] ?? null;
          const after = membershipOf(s.model[s.selId] ?? []);
          // gid へ新たに入った did（所属が変わって gid になった行）を割当対象にする。
          const movedDid = Object.keys(after).find(
            (did) => after[did] === gid && before[did] !== gid,
          );
          if (!movedDid) return;
          mutations.assignLines.mutate({
            taskId,
            assignments: [{ line_id: movedDid, packaging_group_id: groupId }],
          });
        });
      },
      onAddGroup: () => {
        const before = snap();
        if (isRealDataEnabled() && !before.writeContext.taskId) {
          reportMissingWriteContext();
          return;
        }
        const gid = addGroup();
        if (!gid) return;
        real(() => {
          const s = snap();
          const groups = s.model[s.selId] ?? [];
          const group = groups.find((candidate) => candidate.gid === gid);
          if (!s.writeContext.taskId || !group) {
            useWorkbenchStore.setState({ model: before.model });
            return;
          }
          mutations.createGroup.mutate(
            {
              taskId: s.writeContext.taskId,
              group: {
                group_key: gid,
                label: group.label,
                method: group.method,
                sort_order: groups.findIndex((candidate) => candidate.gid === gid),
              },
            },
            {
              onSuccess: (data) => {
                const createdId = (data as { data?: { id?: unknown } } | null)?.data?.id;
                if (typeof createdId !== 'string' || !createdId) return;
                useWorkbenchStore.setState((state) => ({
                  writeContext: {
                    ...state.writeContext,
                    groupIdByGid: {
                      ...state.writeContext.groupIdByGid,
                      [gid]: createdId,
                    },
                  },
                }));
              },
              onError: () => {
                useWorkbenchStore.setState({ model: before.model });
              },
            },
          );
        });
      },
      onBulk: () => {
        if (isRealDataEnabled() && isAnyPending) return; // 実データ時のみ二重送信ガード
        const before = snap();
        if (phase === 'setp' && !requireRealPlanContext(before)) return;
        const previousSetCells = before.setCells;
        const cells: Array<{ batch_id: string; expected_version?: number }> = [];
        if (isRealDataEnabled() && phase === 'setp') {
          for (const meta of Object.values(before.writeContext.cellMeta)) {
            meta.batchIds.forEach((batchId, i) => {
              cells.push({ batch_id: batchId, expected_version: meta.versions[i] });
            });
          }
          if (cells.length === 0) {
            reportMissingWriteContext();
            return;
          }
        }
        bulk(phase);
        real(() => {
          const s = snap();
          if (phase !== 'setp' || !s.writeContext.planId) return;
          mutations.bulkSet.mutate(cells, {
            onSuccess: applyReturnedBatchVersions,
            onError: () => {
              restoreCells('setp', previousSetCells);
            },
          });
        });
      },
      onPrimary: () => {
        if (isRealDataEnabled() && isAnyPending) return null; // 実データ時のみ二重送信ガード
        if (isRealDataEnabled()) {
          const s = snap();
          if (!canSubmitRealPrimary(s)) {
            reportMissingWriteContext();
            return null;
          }
        }
        const next = primary(phase);
        if (next) {
          // ゲート通過時のみ確定書込（調剤完了 / セット監査承認）を発火。
          if (isRealDataEnabled()) {
            const s = snap();
            if (
              phase === 'dispense' &&
              s.writeContext.taskId &&
              s.writeContext.cycleVersion !== null
            ) {
              const lines = collectDispenseLines(s);
              const submittedLineIds = lines.map((line) => line.line_id);
              mutations.completeDispense.mutate(
                {
                  task_id: s.writeContext.taskId,
                  lines,
                  expected_version: s.writeContext.cycleVersion,
                },
                {
                  onSuccess: () => onAdvance?.(next),
                  onError: () => {
                    useWorkbenchStore.setState((state) => ({
                      done: clearBooleanKeys(state.done, submittedLineIds),
                    }));
                  },
                },
              );
            } else if (
              phase === 'audit' &&
              s.writeContext.taskId &&
              s.writeContext.cycleVersion !== null
            ) {
              const submittedLineIds = Object.keys(s.audit).filter((lineId) => s.audit[lineId]);
              mutations.completeAudit.mutate(
                {
                  task_id: s.writeContext.taskId,
                  result: 'approved',
                  expected_version: s.writeContext.cycleVersion,
                },
                {
                  onSuccess: () => onAdvance?.(next),
                  onError: () => {
                    useWorkbenchStore.setState((state) => ({
                      audit: clearBooleanKeys(state.audit, submittedLineIds),
                    }));
                  },
                },
              );
            } else if (phase === 'seta' && s.writeContext.planId) {
              const patientId = s.selId;
              const cellAudits = collectSetAuditCellAudits(s, 'ok');
              mutations.setAudit.mutate(
                {
                  plan_id: s.writeContext.planId,
                  result: 'approved',
                  checklist: collectSetAuditChecklist(s),
                  ...(cellAudits.length > 0 ? { cell_audits: cellAudits } : {}),
                },
                {
                  onSuccess: () => onAdvance?.(next),
                  onError: () => {
                    useWorkbenchStore.setState((state) => ({
                      auditCells: removePatientPrefixed(state.auditCells, patientId),
                      checks: removePatientPrefixed(state.checks, patientId),
                      ng: removePatientPrefixed(state.ng, patientId),
                    }));
                  },
                },
              );
            }
            return null;
          }
        }
        return next;
      },

      // ── カレンダー（setp）──
      onSelectCell: (di, tk) => selectCell(di, tk),
      onSetCell: () => {
        const target = snap().target;
        if (!target) return;
        const before = snap();
        const key = cellKey(before.selId, target.di, target.tk);
        const previousSetState = before.setCells[key];
        if (isRealDataEnabled()) {
          if (!requireRealCellContext(before, target)) return;
        }
        applyCell(phase, 'set', target);
        real(() => {
          const s = snap();
          const meta = resolveCellMeta(s.writeContext.cellMeta, s.selId, target);
          if (!meta) return;
          mutations.cellMutation.mutate(
            {
              ...buildCellMutationTarget(meta),
              action: 'set',
            },
            {
              onSuccess: applyReturnedBatchVersions,
              onError: () => {
                restoreCell(phase, before.selId, target, previousSetState);
              },
            },
          );
        });
      },
      onToggleOut: (name) => toggleOut(name),
      onTogglePacket: (item) => togglePacket(item),

      // ── セット監査（seta）──
      onAuditOk: () => {
        const target = snap().target;
        applyCell(phase, 'ok', target);
        // OK cells are submitted with final approval. Posting partial_approved per cell would
        // transition the cycle and publish carry items before the full checklist is complete.
      },
      onAuditNg: () => {
        const target = snap().target;
        if (!target) return;
        const before = snap();
        const key = cellKey(before.selId, target.di, target.tk);
        const previousAuditState = before.auditCells[key];
        const ngLabel = before.ng[key];
        const ngCode = ngLabel ? NG_LABEL_TO_CODE[ngLabel] : undefined;
        if (isRealDataEnabled()) {
          if (!ngCode) {
            toast.error('NG分類を選択してから実行してください。');
            return;
          }
          if (!requireRealCellContext(before, target)) return;
        }

        applyCell(phase, 'ng', target);
        real(() => {
          const s = snap();
          const planId = s.writeContext.planId;
          const meta = resolveCellMeta(s.writeContext.cellMeta, s.selId, target);
          if (!planId || !meta || !ngCode) {
            restoreCell(phase, before.selId, target, previousAuditState);
            reportMissingWriteContext();
            return;
          }
          const input = buildRejectedSetAuditInput(planId, meta, ngLabel);
          if (!input) {
            restoreCell(phase, before.selId, target, previousAuditState);
            return;
          }
          mutations.setAudit.mutate(input, {
            onError: () => {
              restoreCell(phase, before.selId, target, previousAuditState);
            },
          });
        });
      },
      onToggleCheck: (index) => {
        const target = snap().target;
        toggleCheck(target, index);
      },
      onSetNg: (value) => {
        const target = snap().target;
        setNg(target, value);
      },
      onReturnToSet: (di, tk) => {
        const before = snap();
        const target = { di, tk };
        const key = cellKey(before.selId, di, tk);
        const previousSetState = before.setCells[key];
        const previousAuditState = before.auditCells[key];
        if (isRealDataEnabled()) {
          if (!requireRealCellContext(before, target)) return;
        }
        returnToSet(di, tk);
        real(() => {
          const s = snap();
          const meta = s.writeContext.cellMeta[key];
          if (!meta) {
            restoreCell('setp', before.selId, target, previousSetState);
            restoreCell('seta', before.selId, target, previousAuditState);
            reportMissingWriteContext();
            return;
          }
          // セットへ戻す＝当該セルを未セット化（clear）。
          mutations.cellMutation.mutate(
            {
              ...buildCellMutationTarget(meta),
              action: 'clear',
            },
            {
              onSuccess: applyReturnedBatchVersions,
              onError: () => {
                restoreCell('setp', before.selId, target, previousSetState);
                restoreCell('seta', before.selId, target, previousAuditState);
              },
            },
          );
        });
      },

      // ── 保留（共通）──
      onOpenHold: () => {
        const target = snap().target;
        openHold(target);
      },
      onSaveHold: () => {
        // 確定前にドラフトを退避（saveHold が holdModal を null にするため）。
        const draft = snap().holdModal;
        if (!draft || !draft.reason) return; // saveHold 同様 理由必須
        const before = snap();
        const key = cellKey(before.selId, draft.di, draft.tk);
        const target = { di: draft.di, tk: draft.tk };
        const previousCellState = phase === 'seta' ? before.auditCells[key] : before.setCells[key];
        const previousHoldInfo = before.holdInfo[key];
        const reasonCode = HOLD_REASON_TO_CODE[draft.reason];
        if (!reasonCode) return;
        if (isRealDataEnabled() && isCalendarPhase(phase)) {
          if (!requireRealCellContext(before, target)) return;
        }
        if (isRealDataEnabled() && !isCalendarPhase(phase) && !requireRealCycleContext(before)) {
          return;
        }

        saveHold(phase);
        real(() => {
          const s = snap();
          if (isCalendarPhase(phase)) {
            const meta = s.writeContext.cellMeta[key];
            if (!s.writeContext.planId || !meta) {
              restoreCell(phase, before.selId, target, previousCellState);
              restoreHoldInfo(before.selId, target, previousHoldInfo);
              return;
            }
            mutations.cellMutation.mutate(
              {
                ...buildCellMutationTarget(meta),
                action: 'hold',
                held_reason: reasonCode,
                held_detail: draft.memo || undefined,
              },
              {
                onSuccess: applyReturnedBatchVersions,
                onError: () => {
                  restoreCell(phase, before.selId, target, previousCellState);
                  restoreHoldInfo(before.selId, target, previousHoldInfo);
                },
              },
            );
            return;
          }

          const slot = TIMING_TO_SLOT[draft.tk as keyof typeof TIMING_TO_SLOT];
          const meta = s.writeContext.cellMeta[cellKey(s.selId, draft.di, draft.tk)];
          const cycleId = s.writeContext.cycleId;
          if (!cycleId) {
            restoreCell(phase, before.selId, target, previousCellState);
            restoreHoldInfo(before.selId, target, previousHoldInfo);
            reportMissingWriteContext();
            return;
          }
          mutations.createHold.mutate({
            cycle_id: cycleId,
            phase,
            scope: CELL_HOLD_SCOPE,
            reason: reasonCode,
            reason_detail: draft.memo || undefined,
            day_number: meta?.dayNumber,
            slot: meta?.slot ?? slot,
            due_at: draft.due ? new Date(draft.due).toISOString() : undefined,
            assigned_to: draft.owner || undefined,
            note: draft.memo || undefined,
          });
        });
      },
    };
  }, [
    phase,
    mutations,
    isAnyPending,
    toggleRow,
    setGMethod,
    setGStart,
    setGDays,
    dropTo,
    addGroup,
    bulk,
    primary,
    selectCell,
    applyCell,
    restoreCell,
    restoreCells,
    restoreHoldInfo,
    toggleOut,
    togglePacket,
    toggleCheck,
    setNg,
    returnToSet,
    openHold,
    saveHold,
    onAdvance,
  ]);
}

/**
 * 調剤完了の line 入力を store から組む。実データ由来の prescribedQuantity を初期実数量
 * （処方量どおり）として使う。数量未取得行はサーバ差異判定対象外なので安全な正数に倒す。
 */
export function collectDispenseLines(s: ReturnType<typeof useWorkbenchStore.getState>): Array<{
  line_id: string;
  actual_drug_name: string;
  actual_quantity: number;
  carry_type: 'carry' | 'facility_deposit' | 'deferred';
}> {
  const groups = s.model[s.selId] ?? [];
  const lines: Array<{
    line_id: string;
    actual_drug_name: string;
    actual_quantity: number;
    carry_type: 'carry';
  }> = [];
  for (const g of groups) {
    for (const d of g.drugs) {
      lines.push({
        line_id: d.did,
        actual_drug_name: d.name,
        actual_quantity:
          d.prescribedQuantity && d.prescribedQuantity > 0 ? d.prescribedQuantity : 1,
        carry_type: 'carry',
      });
    }
  }
  return lines;
}

function collectSetAuditCellAudits(
  s: ReturnType<typeof useWorkbenchStore.getState>,
  state: 'ok' | 'ng',
): Array<{
  batch_id: string;
  audit_state: 'ok' | 'ng';
  ng_code?: RejectCode;
  expected_version: number;
}> {
  const out: Array<{
    batch_id: string;
    audit_state: 'ok' | 'ng';
    ng_code?: RejectCode;
    expected_version: number;
  }> = [];
  for (const [key, auditState] of Object.entries(s.auditCells)) {
    if (auditState !== state) continue;
    const meta = s.writeContext.cellMeta[key];
    if (!meta) continue;
    const ngLabel = s.ng[key];
    const ngCode = ngLabel ? NG_LABEL_TO_CODE[ngLabel] : undefined;
    meta.batchIds.forEach((batch_id, i) => {
      out.push({
        batch_id,
        audit_state: state,
        ...(ngCode ? { ng_code: ngCode } : {}),
        expected_version: meta.versions[i],
      });
    });
  }
  return out;
}

function collectSetAuditChecklist(
  s: ReturnType<typeof useWorkbenchStore.getState>,
): Record<SetAuditChecklistKey, boolean> {
  return collectSetAuditChecklistFromChecks(s.checks);
}

export function collectSetAuditChecklistFromChecks(
  checks: Record<string, boolean>,
): Record<SetAuditChecklistKey, boolean> {
  const values = Object.fromEntries(
    SET_AUDIT_CHECK_ITEMS.map((item) => [item.key, false]),
  ) as Record<SetAuditChecklistKey, boolean>;
  const firstCheckedCell = Object.keys(checks).find((key) => checks[key]);
  if (!firstCheckedCell) return values;
  const prefix = firstCheckedCell.replace(/:\d+$/, '');
  SET_AUDIT_CHECK_ITEMS.forEach((item, index) => {
    values[item.key] = checks[`${prefix}:${index}`] === true;
  });
  return values;
}

export function buildRejectedSetAuditInput(
  planId: string,
  meta: CellMeta,
  ngLabel: string | undefined,
): SubmitSetAuditInput | null {
  const ngCode = ngLabel ? NG_LABEL_TO_CODE[ngLabel] : undefined;
  if (!ngCode) return null;
  return {
    plan_id: planId,
    result: 'rejected',
    reject_reason: ngLabel,
    reject_reason_code: ngCode,
    cell_audits: meta.batchIds.map((batch_id, i) => ({
      batch_id,
      audit_state: 'ng',
      ng_code: ngCode,
      expected_version: meta.versions[i],
    })),
  };
}
