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

import { parsePackagingMethod, type PackagingMethodValue } from '@/lib/dispensing/packaging';
import {
  areQuantitiesEquivalentForUnit,
  isQuantityAllowedForUnit,
} from '@/lib/dispensing/quantity-unit';
import { formatUtcDateKey } from '@/lib/date-key';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import { useWorkbenchStore } from './dispensing-workbench.store';
import { isRealDataEnabled } from './dispensing-workbench.adapter';
import type { WorkbenchMutations } from './use-workbench-mutations';
import {
  HOLD_REASON_TO_CODE,
  NG_LABEL_TO_CODE,
  CARRY_PACKET_EVIDENCE_SCHEMA_VERSION,
  SET_AUDIT_CHECK_ITEMS,
  TIMING_TO_SLOT,
  type CellMeta,
  type CarryPacketEvidenceInput,
  type CarryPacketItemKey,
  type OutsideMedEvidenceKind,
  type PrescriptionLineMeta,
  type RejectCode,
  type SetAuditChecklistKey,
  type CellMutationTarget,
  type DispenseResultLineInput,
  type PendingPrimary,
  type PendingSetAuditReject,
  type PendingForceRegen,
  type SubmitDispenseAuditInput,
  type SubmitSetAuditInput,
} from './dispensing-workbench.write-types';
import { calc, cellKey, packetKeys } from './dispensing-workbench.logic';
import { isCalendarPhase } from './dispensing-workbench.types';
import type { CellTarget, Group, Phase } from './dispensing-workbench.types';

/** カレンダーセルの保留スコープ（API HoldScope）。1 セル＝cell 単位。 */
const CELL_HOLD_SCOPE: HoldScope = 'cell';
const UNRESOLVED_DISPENSE_QUANTITY_MESSAGE =
  '処方数量が未確定の薬剤があります。処方取込で数量を確認してから調剤完了してください。';
const UNCONFIRMED_DISPENSE_QUANTITY_MESSAGE =
  '実数量の確認が未完了の薬剤があります。数量確認を押してから調剤完了してください。';
const INVALID_DISPENSE_QUANTITY_MESSAGE = '実数量は1以上で、単位に合う刻みで入力してください。';
const DISCREPANCY_REASON_REQUIRED_MESSAGE =
  '処方数量と異なる実数量には差異理由を入力してください。';
const INVALID_AUDIT_DOUBLE_COUNT_MESSAGE =
  '麻薬ダブルカウントが未完了です。1回目・2回目を実数量と一致する値で入力してください。';
const CONFIRM_TARGET_DRIFT_MESSAGE = '確認中に対象が変わりました。操作をやり直してください。';

type DispenseQuantityIssue = {
  line_id: string;
  reason:
    | 'prescribed_quantity_required'
    | 'actual_quantity_confirmation_required'
    | 'actual_quantity_invalid'
    | 'discrepancy_reason_required';
};

type DispenseAuditDoubleCountIssue = {
  line_id: string;
  reason:
    | 'dispensed_quantity_required'
    | 'first_count_required'
    | 'second_count_required'
    | 'first_count_mismatch'
    | 'second_count_mismatch';
};

const GROUP_METHOD_PACKAGING_METHODS: Record<string, PackagingMethodValue> = {
  一包化: 'unit_dose',
  錠剤分包機: 'unit_dose',
  散剤分包機: 'unit_dose',
  自動分包機: 'unit_dose',
  'PTP（手撒き）': 'blister_pack',
  別包: 'other',
  頓用: 'none',
};

export interface WorkbenchWriteHandlers {
  // ── グリッド（dispense / audit）──
  /** 行チェック（調剤済 / 監査OK のトグル）。 */
  onToggleRow: (did: string) => void;
  /** 調剤実数量確認（行チェックとは分離）。 */
  onToggleQuantityConfirm: (did: string) => void;
  /** 調剤実数量入力。 */
  onActualQuantityInput: (did: string, value: string) => void;
  /** 処方数量との差異理由入力。 */
  onDiscrepancyReason: (did: string, value: string) => void;
  /** 麻薬ダブルカウント入力。 */
  onAuditDoubleCount: (did: string, field: 'first' | 'second', value: string) => void;
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
  /** 一括処理（フェーズ依存・表示中調剤済 / 調剤済み監査OK / 表示中セルセット / 表示中セル監査OK）。 */
  onBulk: () => void;
  /**
   * 主操作（次工程へ）。real-data の不可逆 sign-off（dispense/audit/seta）では前段ゲート通過時に
   * 確定書込を発火せず onRequestConfirm(descriptor) で ConfirmDialog を要求し null を返す。
   * demo（mock）はゲート通過時に次 phase を返す（遷移は呼び出し側）。
   */
  onPrimary: () => Phase | null;
  /**
   * ConfirmDialog 確定時の確定書込（real-data のみ）。snap() で再取得しゲートを再検証してから
   * mutate し、成功で onAdvance(descriptor.next)・失敗でロールバックする。
   */
  commitPrimary: (descriptor: PendingPrimary) => void;
  /**
   * セット監査 reject（per-cell NG）の ConfirmDialog 確定時の確定書込（real-data のみ）。
   * snap() で再取得し planId/meta/ngCode を再検証 + アンカー照合してから rejected で mutate する。
   */
  commitSetAuditReject: (descriptor: PendingSetAuditReject) => void;
  /**
   * force セットバッチ再生成の確認要求（real-data のみ）。snap() で現在の患者/計画/版を捕捉して
   * descriptor を立て、onRequestRegenerateConfirm を呼ぶ（mutate しない）。
   */
  onRequestRegenerate: () => void;
  /**
   * force 再生成 ConfirmDialog 確定時の確定書込（real-data のみ）。snap() で再取得し
   * descriptor の患者/計画/版と照合、ドリフト時は中止、一致時のみ force 再生成を mutate する。
   */
  commitForceRegen: (descriptor: PendingForceRegen) => void;

  // ── カレンダー（setp）──
  /** セルを選択。 */
  onSelectCell: (di: number, tk: string) => void;
  /** 選択セルへ「セット済」。 */
  onSetCell: () => void;
  /** カレンダーその他薬 同梱トグル。 */
  onToggleOut: (name: string) => void;
  /** 訪問持出パケット トグル。 */
  onTogglePacket: (item: string) => void;
  /**
   * セットバッチ初回生成（即時・非破壊）。既存セットがある場合の破壊的「再生成」は
   * onRequestRegenerate→commitForceRegen（確認ダイアログ + ドリフト照合）に分離している。
   */
  onGenerateBatches: () => void;

  // ── セット監査（seta）──
  /** 選択セル 監査OK。 */
  onAuditOk: () => void;
  /**
   * 選択セル NG・差戻し。real-data では即 post せず前段ガード通過時に
   * onRequestRejectConfirm(descriptor) で ConfirmDialog を要求する（mutate は commit のみ）。
   * demo（mock）はゲート通過時に楽観 NG のみ（API は叩かない）。
   */
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

/**
 * CellMeta の OCC アンカー（batchIds / versions）が同順で一致するか。
 * reject 確認中に対象セルが refetch され batch/version が変わった場合の
 * ドリフト検出に使う（dayNumber/slot はセルキー由来で不変なため比較対象外）。
 */
function cellMetaEquals(a: CellMeta, b: CellMeta): boolean {
  if (a.batchIds.length !== b.batchIds.length) return false;
  if (a.versions.length !== b.versions.length) return false;
  return (
    a.batchIds.every((id, i) => id === b.batchIds[i]) &&
    a.versions.every((v, i) => v === b.versions[i])
  );
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

function readReturnedGroupVersions(data: unknown): Array<{ id: string; version: number }> {
  const body = data as { data?: { updated?: unknown } } | null | undefined;
  const updated = body?.data?.updated;
  if (!Array.isArray(updated)) return [];
  return updated.flatMap((group) => {
    const candidate = group as { id?: unknown; version?: unknown };
    return typeof candidate.id === 'string' && typeof candidate.version === 'number'
      ? [{ id: candidate.id, version: candidate.version }]
      : [];
  });
}

function normalizeDateKey(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return undefined;
}

function parsePositiveDays(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(days) && days > 0 ? days : null;
}

function addDaysToDateKey(startDate: string, days: number): string | null {
  const parsed = normalizeDateKey(startDate);
  if (!parsed || days < 1) return null;
  const [year, month, day] = parsed.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days - 1);
  return formatUtcDateKey(date);
}

function isPositiveFiniteQuantity(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseActualQuantityInput(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasExplicitActualQuantityInput(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function isValidActualQuantityForDrug(input: {
  quantity: number | null;
  unit?: string | null;
  prescribedQuantity?: number | null;
}) {
  return (
    input.quantity != null &&
    isQuantityAllowedForUnit({
      quantity: input.quantity,
      unit: input.unit,
      referenceQuantity: input.prescribedQuantity,
    })
  );
}

function countMatchesActualQuantity(input: {
  count: number | null;
  actualQuantity: number;
  unit?: string | null;
}) {
  return (
    input.count != null &&
    areQuantitiesEquivalentForUnit({
      left: input.count,
      right: input.actualQuantity,
      unit: input.unit,
      referenceQuantity: input.actualQuantity,
    })
  );
}

export function collectDispenseQuantityIssues(
  s: ReturnType<typeof useWorkbenchStore.getState>,
): DispenseQuantityIssue[] {
  const actualQuantityInputByDid = s.actualQuantityInputByDid ?? {};
  const discrepancyReasonByDid = s.discrepancyReasonByDid ?? {};
  const quantityConfirmedByDid = s.quantityConfirmedByDid ?? {};
  const groups = s.model[s.selId] ?? [];
  return groups.flatMap((group) =>
    group.drugs.flatMap((drug): DispenseQuantityIssue[] => {
      if (!isPositiveFiniteQuantity(drug.prescribedQuantity)) {
        return [{ line_id: drug.did, reason: 'prescribed_quantity_required' as const }];
      }
      if (isPositiveFiniteQuantity(drug.dispensedQuantity)) {
        if (
          !areQuantitiesEquivalentForUnit({
            left: drug.dispensedQuantity,
            right: drug.prescribedQuantity,
            unit: drug.unit,
            referenceQuantity: drug.prescribedQuantity,
          }) &&
          !(discrepancyReasonByDid[drug.did]?.trim() || drug.discrepancyReason?.trim())
        ) {
          return [{ line_id: drug.did, reason: 'discrepancy_reason_required' as const }];
        }
        return [];
      }
      const rawActualQuantity = actualQuantityInputByDid[drug.did];
      const hasManualInput = hasExplicitActualQuantityInput(rawActualQuantity);
      const parsedActualQuantity = parseActualQuantityInput(rawActualQuantity);
      if (
        hasManualInput &&
        !isValidActualQuantityForDrug({
          quantity: parsedActualQuantity,
          unit: drug.unit,
          prescribedQuantity: drug.prescribedQuantity,
        })
      ) {
        return [{ line_id: drug.did, reason: 'actual_quantity_invalid' as const }];
      }
      if (!quantityConfirmedByDid[drug.did]) {
        return [{ line_id: drug.did, reason: 'actual_quantity_confirmation_required' as const }];
      }
      if (
        parsedActualQuantity != null &&
        !areQuantitiesEquivalentForUnit({
          left: parsedActualQuantity,
          right: drug.prescribedQuantity,
          unit: drug.unit,
          referenceQuantity: drug.prescribedQuantity,
        }) &&
        !discrepancyReasonByDid[drug.did]?.trim()
      ) {
        return [{ line_id: drug.did, reason: 'discrepancy_reason_required' as const }];
      }
      return [];
    }),
  );
}

export function collectDispenseAuditDoubleCountIssues(
  s: ReturnType<typeof useWorkbenchStore.getState>,
): DispenseAuditDoubleCountIssue[] {
  const groups = s.model[s.selId] ?? [];
  const auditDoubleCountByDid = s.auditDoubleCountByDid ?? {};
  return groups.flatMap((group) =>
    group.drugs.flatMap((drug): DispenseAuditDoubleCountIssue[] => {
      if (!s.audit[drug.did] || !drug.isNarcotic) return [];
      if (!isPositiveFiniteQuantity(drug.dispensedQuantity)) {
        return [{ line_id: drug.did, reason: 'dispensed_quantity_required' as const }];
      }
      const input = auditDoubleCountByDid[drug.did] ?? { first: '', second: '' };
      const firstCount = parseActualQuantityInput(input.first);
      const secondCount = parseActualQuantityInput(input.second);
      const issues: DispenseAuditDoubleCountIssue[] = [];
      if (firstCount == null) {
        issues.push({ line_id: drug.did, reason: 'first_count_required' as const });
      } else if (
        !countMatchesActualQuantity({
          count: firstCount,
          actualQuantity: drug.dispensedQuantity,
          unit: drug.unit,
        })
      ) {
        issues.push({ line_id: drug.did, reason: 'first_count_mismatch' as const });
      }
      if (secondCount == null) {
        issues.push({ line_id: drug.did, reason: 'second_count_required' as const });
      } else if (
        !countMatchesActualQuantity({
          count: secondCount,
          actualQuantity: drug.dispensedQuantity,
          unit: drug.unit,
        })
      ) {
        issues.push({ line_id: drug.did, reason: 'second_count_mismatch' as const });
      }
      return issues;
    }),
  );
}

export function collectDispenseAuditDoubleCount(
  s: ReturnType<typeof useWorkbenchStore.getState>,
): NonNullable<SubmitDispenseAuditInput['double_count']> {
  const groups = s.model[s.selId] ?? [];
  const auditDoubleCountByDid = s.auditDoubleCountByDid ?? {};
  return groups.flatMap((group) =>
    group.drugs.flatMap((drug) => {
      if (!s.audit[drug.did] || !drug.isNarcotic) return [];
      const input = auditDoubleCountByDid[drug.did] ?? { first: '', second: '' };
      return [
        {
          line_id: drug.did,
          drug_name: drug.name,
          dispensed_quantity: isPositiveFiniteQuantity(drug.dispensedQuantity)
            ? drug.dispensedQuantity
            : null,
          first_count: parseActualQuantityInput(input.first),
          second_count: parseActualQuantityInput(input.second),
        },
      ];
    }),
  );
}

function readReturnedLineMeta(data: unknown): Partial<PrescriptionLineMeta> {
  const payload = (data as { data?: Record<string, unknown> } | null | undefined)?.data;
  if (!payload) return {};
  const startDate = normalizeDateKey(payload.start_date);
  const endDate = normalizeDateKey(payload.end_date);
  return {
    ...(typeof payload.updated_at === 'string' ? { updatedAt: payload.updated_at } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
    ...(typeof payload.days === 'number' || payload.days === null ? { days: payload.days } : {}),
  };
}

function applyReturnedLineMetas(
  data: unknown,
  fallbackByDid: Record<string, Partial<PrescriptionLineMeta>>,
): void {
  const updated = (data as { data?: { updated?: unknown } } | null | undefined)?.data?.updated;
  if (!Array.isArray(updated)) return;
  const returnedByDid = new Map<string, Partial<PrescriptionLineMeta>>();
  for (const line of updated) {
    const candidate = line as Record<string, unknown>;
    if (typeof candidate.id !== 'string') continue;
    returnedByDid.set(candidate.id, readReturnedLineMeta({ data: candidate }));
  }
  useWorkbenchStore.setState((state) => {
    const lineMetaByDid = { ...(state.writeContext.lineMetaByDid ?? {}) };
    let changed = false;
    for (const [did, returned] of returnedByDid.entries()) {
      const previous = lineMetaByDid[did];
      if (!previous) continue;
      const fallback = fallbackByDid[did] ?? {};
      lineMetaByDid[did] = {
        updatedAt: returned.updatedAt ?? fallback.updatedAt ?? previous.updatedAt,
        startDate:
          returned.startDate !== undefined
            ? returned.startDate
            : fallback.startDate !== undefined
              ? fallback.startDate
              : previous.startDate,
        endDate:
          returned.endDate !== undefined
            ? returned.endDate
            : fallback.endDate !== undefined
              ? fallback.endDate
              : previous.endDate,
        days:
          returned.days !== undefined
            ? returned.days
            : fallback.days !== undefined
              ? fallback.days
              : previous.days,
      };
      changed = true;
    }
    if (!changed) return state;
    return {
      writeContext: {
        ...state.writeContext,
        lineMetaByDid,
      },
    };
  });
}

function createClientActionId(prefix: string): string {
  return createClientIdempotencyKey(prefix);
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

function resolveGroupPackagingDecision(method: Group['method']): {
  packaging_method: PackagingMethodValue;
  special_notes?: string;
} {
  const label = String(method).trim();
  if (!label) return { packaging_method: 'none' };

  const mapped = GROUP_METHOD_PACKAGING_METHODS[label];
  const packagingMethod = mapped ?? parsePackagingMethod(label).method ?? 'other';
  const shouldPreserveLabel =
    label !== '一包化' || packagingMethod !== 'unit_dose' || !GROUP_METHOD_PACKAGING_METHODS[label];

  return {
    packaging_method: packagingMethod,
    ...(shouldPreserveLabel ? { special_notes: label } : {}),
  };
}

/**
 * フェーズ別の書込ハンドラ束を返す。子はこれを props で受け取り onClick から呼ぶ。
 */
export function useWorkbenchWriteHandlers(args: {
  phase: Phase;
  mutations: WorkbenchMutations;
  onAdvance?: (phase: Phase) => void;
  /** real-data の不可逆 sign-off で ConfirmDialog を要求する（descriptor を親 state に積む）。 */
  onRequestConfirm?: (descriptor: PendingPrimary) => void;
  /** real-data のセット監査 reject（per-cell NG）で ConfirmDialog を要求する。 */
  onRequestRejectConfirm?: (descriptor: PendingSetAuditReject) => void;
  /** real-data の force セットバッチ再生成（破壊的）で ConfirmDialog を要求する。 */
  onRequestRegenerateConfirm?: (descriptor: PendingForceRegen) => void;
}): WorkbenchWriteHandlers {
  const {
    phase,
    mutations,
    onAdvance,
    onRequestConfirm,
    onRequestRejectConfirm,
    onRequestRegenerateConfirm,
  } = args;

  // store アクション（楽観更新 / モック挙動の正本）。
  const toggleRow = useWorkbenchStore((s) => s.toggleRow);
  const toggleQuantityConfirm = useWorkbenchStore((s) => s.toggleQuantityConfirm);
  const setActualQuantityInput = useWorkbenchStore((s) => s.setActualQuantityInput);
  const setDiscrepancyReason = useWorkbenchStore((s) => s.setDiscrepancyReason);
  const setAuditDoubleCount = useWorkbenchStore((s) => s.setAuditDoubleCount);
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
    const reportDispenseQuantityIssues = (
      issues: ReturnType<typeof collectDispenseQuantityIssues>,
    ) => {
      toast.error(
        issues.some((issue) => issue.reason === 'prescribed_quantity_required')
          ? UNRESOLVED_DISPENSE_QUANTITY_MESSAGE
          : issues.some((issue) => issue.reason === 'actual_quantity_invalid')
            ? INVALID_DISPENSE_QUANTITY_MESSAGE
            : issues.some((issue) => issue.reason === 'discrepancy_reason_required')
              ? DISCREPANCY_REASON_REQUIRED_MESSAGE
              : UNCONFIRMED_DISPENSE_QUANTITY_MESSAGE,
      );
    };
    /**
     * ConfirmDialog 確定時の確定書込（real-data のみ）。
     * C7: snap() 再取得 → issue collector + writeContext 存在を再検証（NG は toast + return、mutate せず）。
     * 親の ConfirmDialog は closeOnConfirm でダイアログを閉じ pendingPrimary をクリアする。
     * mutate 前に書込スライスは変異させない（成功/失敗で onAdvance / ロールバックのみ）。
     */
    const commitPrimary = (descriptor: PendingPrimary) => {
      if (!isRealDataEnabled()) return;
      const s = snap();
      // アンカー照合: 確認中に患者/タスク/版/計画がドリフトしたら mutate しない（#2）。
      if (descriptor.phase === 'seta') {
        if (descriptor.patientId !== s.selId || descriptor.planId !== s.writeContext.planId) {
          toast.error(CONFIRM_TARGET_DRIFT_MESSAGE);
          return;
        }
      } else if (
        descriptor.patientId !== s.selId ||
        descriptor.taskId !== s.writeContext.taskId ||
        descriptor.cycleVersion !== s.writeContext.cycleVersion
      ) {
        toast.error(CONFIRM_TARGET_DRIFT_MESSAGE);
        return;
      }
      if (descriptor.phase === 'dispense') {
        if (!s.writeContext.taskId || s.writeContext.cycleVersion === null) {
          reportMissingWriteContext();
          return;
        }
        const quantityIssues = collectDispenseQuantityIssues(s);
        if (quantityIssues.length > 0) {
          reportDispenseQuantityIssues(quantityIssues);
          return;
        }
        const lines = collectDispenseLines(s);
        const submittedLineIds = lines.map((line) => line.line_id);
        mutations.completeDispense.mutate(
          {
            task_id: s.writeContext.taskId,
            lines,
            expected_version: s.writeContext.cycleVersion,
          },
          {
            onSuccess: () => onAdvance?.(descriptor.next),
            onError: () => {
              useWorkbenchStore.setState((state) => ({
                done: clearBooleanKeys(state.done, submittedLineIds),
              }));
            },
          },
        );
        return;
      }
      if (descriptor.phase === 'audit') {
        if (!s.writeContext.taskId || s.writeContext.cycleVersion === null) {
          reportMissingWriteContext();
          return;
        }
        const doubleCountIssues = collectDispenseAuditDoubleCountIssues(s);
        if (doubleCountIssues.length > 0) {
          toast.error(INVALID_AUDIT_DOUBLE_COUNT_MESSAGE);
          return;
        }
        const doubleCount = collectDispenseAuditDoubleCount(s);
        const submittedLineIds = Object.keys(s.audit).filter((lineId) => s.audit[lineId]);
        mutations.completeAudit.mutate(
          {
            task_id: s.writeContext.taskId,
            result: 'approved',
            expected_version: s.writeContext.cycleVersion,
            ...(doubleCount.length > 0 ? { double_count: doubleCount } : {}),
          },
          {
            onSuccess: () => onAdvance?.(descriptor.next),
            onError: () => {
              useWorkbenchStore.setState((state) => ({
                audit: clearBooleanKeys(state.audit, submittedLineIds),
              }));
            },
          },
        );
        return;
      }
      // seta
      if (!s.writeContext.planId) {
        reportMissingWriteContext();
        return;
      }
      const patientId = s.selId;
      const cellAudits = collectSetAuditCellAudits(s, 'ok');
      const carryPacketEvidence = collectCarryPacketEvidence(s);
      if (!carryPacketEvidence) {
        toast.error(
          'その他薬同梱と訪問持出パケットの確認証跡を作成できません。セット工程を再確認してください。',
        );
        return;
      }
      mutations.setAudit.mutate(
        {
          plan_id: s.writeContext.planId,
          result: 'approved',
          checklist: collectSetAuditChecklist(s),
          carry_packet_evidence: carryPacketEvidence,
          ...(cellAudits.length > 0 ? { cell_audits: cellAudits } : {}),
        },
        {
          onSuccess: () => onAdvance?.(descriptor.next),
          onError: () => {
            useWorkbenchStore.setState((state) => ({
              auditCells: removePatientPrefixed(state.auditCells, patientId),
              checks: removePatientPrefixed(state.checks, patientId),
              ng: removePatientPrefixed(state.ng, patientId),
            }));
          },
        },
      );
    };

    /**
     * セット監査 reject（per-cell NG）の確定書込（real-data のみ）。
     * snap() 再取得 → アンカー照合（patientId/planId）→ planId/meta/ngCode 再検証 →
     * 楽観 NG 表示 + rejected で mutate（失敗はセルをロールバック）。mutate は本関数でのみ発火する。
     */
    const commitSetAuditReject = (descriptor: PendingSetAuditReject) => {
      if (!isRealDataEnabled()) return;
      const s = snap();
      // アンカー照合: 確認中に患者/計画がドリフトしたら mutate しない（#2/#4）。
      if (descriptor.patientId !== s.selId || descriptor.planId !== s.writeContext.planId) {
        toast.error(CONFIRM_TARGET_DRIFT_MESSAGE);
        return;
      }
      const target = descriptor.target;
      const key = cellKey(s.selId, target.di, target.tk);
      // ドリフト照合（round-3 S1）: 確認中に NG 分類やセル meta（batch/version）が変わると、
      // 確認した内容と異なる terminal rejected を post しうる。現在値と descriptor を突き合わせ、
      // 不一致なら applyCell/mutate 前に中止する（primary commit の #2d と対称な防御）。
      const currentNgLabel = s.ng[key];
      const currentNgCode = currentNgLabel ? NG_LABEL_TO_CODE[currentNgLabel] : undefined;
      const currentMeta = resolveCellMeta(s.writeContext.cellMeta, s.selId, target);
      if (
        currentNgCode !== descriptor.ngCode ||
        !currentMeta ||
        !cellMetaEquals(currentMeta, descriptor.meta)
      ) {
        toast.error(CONFIRM_TARGET_DRIFT_MESSAGE);
        return;
      }
      const previousAuditState = s.auditCells[key];
      // 確定は確認済み descriptor の値のみから組み立てる（現在 store 値ではなく確認した内容を正本化）。
      // 上のドリフト照合を通過しているため descriptor と現在値は一致しているが、確認した値を
      // 直接使うことで「確認した内容＝送信内容」を構造的に保証する。
      const input = buildRejectedSetAuditInput(
        descriptor.planId,
        descriptor.meta,
        descriptor.ngLabel,
      );
      if (!input) {
        toast.error('NG分類を選択してから実行してください。');
        return;
      }
      applyCell('seta', 'ng', target);
      mutations.setAudit.mutate(input, {
        onError: () => {
          restoreCell('seta', s.selId, target, previousAuditState);
        },
      });
    };

    /**
     * force 再生成（破壊的）の確認要求。現在の患者/計画/版を捕捉して descriptor を立てるだけで
     * mutate しない。real-data 専用（トリガ自体 view.canForceRegenerate=real-data gate）。
     */
    const onRequestRegenerate = () => {
      if (isRealDataEnabled() && isAnyPending) return; // 実データ時のみ二重送信ガード
      const before = snap();
      if (!requireRealPlanContext(before)) return;
      const planId = before.writeContext.planId;
      const expectedUpdatedAt = before.calendarGeneration?.expected_updated_at;
      if (!planId || !expectedUpdatedAt) {
        // OCC アンカー（セットプラン updated_at）が無ければ確認に進めない（破壊的上書き防止）。
        toast.error(
          'セットプランの版情報を取得できませんでした。患者を再選択してから実行してください。',
        );
        return;
      }
      onRequestRegenerateConfirm?.({ patientId: before.selId, planId, expectedUpdatedAt });
    };

    /**
     * force 再生成 ConfirmDialog 確定時の確定書込。確認中に患者/計画/版がドリフトしたら
     * 中止し（別計画の破壊を防ぐ）、一致時のみ確認した descriptor の OCC で再生成を mutate する。
     */
    const commitForceRegen = (descriptor: PendingForceRegen) => {
      if (!isRealDataEnabled()) return;
      if (isAnyPending) return;
      const s = snap();
      if (
        descriptor.patientId !== s.selId ||
        descriptor.planId !== s.writeContext.planId ||
        descriptor.expectedUpdatedAt !== s.calendarGeneration?.expected_updated_at
      ) {
        toast.error(CONFIRM_TARGET_DRIFT_MESSAGE);
        return;
      }
      // 確認した版（descriptor.expectedUpdatedAt）から submit（OCC で並行更新を踏み潰さない）。
      mutations.generateBatches.mutate({
        force: true,
        expected_updated_at: descriptor.expectedUpdatedAt,
      });
    };

    return {
      // ── グリッド ──
      onToggleRow: (did) => {
        // store 更新（楽観 UI）。実データの行単位 調剤/監査は確定（primary）・seta cell-audit が
        // 正本のため、行チェック単発では API を叩かない（現行 UI と同じく即時トグルのみ）。
        toggleRow(phase, did);
      },
      onToggleQuantityConfirm: (did) => {
        toggleQuantityConfirm(did);
      },
      onActualQuantityInput: (did, value) => {
        setActualQuantityInput(did, value);
      },
      onDiscrepancyReason: (did, value) => {
        setDiscrepancyReason(did, value);
      },
      onAuditDoubleCount: (did, field, value) => {
        setAuditDoubleCount(did, field, value);
      },
      onGroupMethod: (gid, value) => {
        const beforeState = snap();
        const previousMethod =
          beforeState.model[beforeState.selId]?.find((group) => group.gid === gid)?.method ?? null;
        if (isRealDataEnabled()) {
          const groupId = beforeState.writeContext.groupIdByGid[gid];
          const version = beforeState.writeContext.groupVersionByGid?.[gid];
          if (!beforeState.writeContext.taskId || !groupId || version === undefined) {
            reportMissingWriteContext();
            return;
          }
        }
        setGMethod(gid, value);
        real(() => {
          const taskId = beforeState.writeContext.taskId;
          const groupId = beforeState.writeContext.groupIdByGid[gid];
          if (!taskId || !groupId) {
            reportMissingWriteContext();
            return;
          }
          const version = beforeState.writeContext.groupVersionByGid?.[gid];
          if (version === undefined) {
            reportMissingWriteContext();
            return;
          }
          mutations.saveGroups.mutate(
            {
              taskId,
              groups: [
                {
                  id: groupId,
                  method: value,
                  version,
                },
              ],
            },
            {
              onSuccess: (data) => {
                const returned = readReturnedGroupVersions(data).find(
                  (group) => group.id === groupId,
                );
                if (!returned) return;
                useWorkbenchStore.setState((state) => ({
                  writeContext: {
                    ...state.writeContext,
                    groupVersionByGid: {
                      ...state.writeContext.groupVersionByGid,
                      [gid]: returned.version,
                    },
                  },
                }));
              },
              onError: () => {
                if (previousMethod) setGMethod(gid, previousMethod);
              },
            },
          );
        });
      },
      onGroupStart: (gid, value) => {
        if (!isRealDataEnabled()) {
          setGStart(gid, value);
          return;
        }
        const beforeState = snap();
        const group =
          beforeState.model[beforeState.selId]?.find((candidate) => candidate.gid === gid) ?? null;
        const previousStart = group?.start ?? '';
        if (!group || group.drugs.length === 0) {
          reportUnsupportedRealWrite();
          return;
        }
        if (!beforeState.writeContext.taskId) {
          reportMissingWriteContext();
          return;
        }
        const normalizedStart = value.trim() ? normalizeDateKey(value) : null;
        if (value.trim() && !normalizedStart) {
          toast.error('服用開始日はYYYY-MM-DD形式で入力してください。');
          return;
        }
        const lineMetas = group.drugs.map((drug) => ({
          did: drug.did,
          meta: beforeState.writeContext.lineMetaByDid?.[drug.did],
        }));
        if (lineMetas.some((line) => !line.meta)) {
          reportMissingWriteContext();
          return;
        }
        const lines = lineMetas.map(({ did, meta }) => {
          const lineMeta = meta!;
          const days =
            lineMeta.days && lineMeta.days > 0 ? lineMeta.days : group.days > 0 ? group.days : null;
          const endDate =
            normalizedStart && days ? addDaysToDateKey(normalizedStart, days) : normalizedStart;
          return {
            line_id: did,
            expected_updated_at: lineMeta.updatedAt,
            start_date: normalizedStart,
            ...(endDate !== undefined ? { end_date: endDate } : {}),
          };
        });
        const fallbackByDid = Object.fromEntries(
          lines.map((line) => [
            line.line_id,
            {
              startDate: line.start_date,
              ...(line.end_date !== undefined ? { endDate: line.end_date } : {}),
            },
          ]),
        );
        setGStart(gid, value);
        mutations.editLines.mutate(
          {
            taskId: beforeState.writeContext.taskId,
            client_action_id: createClientActionId('group-period'),
            packaging_group_id: beforeState.writeContext.groupIdByGid[gid] ?? null,
            lines,
          },
          {
            onSuccess: (data) => {
              applyReturnedLineMetas(data, fallbackByDid);
            },
            onError: () => {
              setGStart(gid, previousStart);
            },
          },
        );
      },
      onGroupDays: (gid, value) => {
        if (!isRealDataEnabled()) {
          setGDays(gid, value);
          return;
        }
        const days = parsePositiveDays(value);
        if (days === null) {
          toast.error('処方日数は1以上の整数で入力してください。');
          return;
        }
        const beforeState = snap();
        const group =
          beforeState.model[beforeState.selId]?.find((candidate) => candidate.gid === gid) ?? null;
        const previousDays = group?.days ?? 0;
        if (!group || group.drugs.length === 0) {
          reportUnsupportedRealWrite();
          return;
        }
        if (!beforeState.writeContext.taskId) {
          reportMissingWriteContext();
          return;
        }
        const lineMetas = group.drugs.map((drug) => ({
          did: drug.did,
          meta: beforeState.writeContext.lineMetaByDid?.[drug.did],
        }));
        if (lineMetas.some((line) => !line.meta)) {
          reportMissingWriteContext();
          return;
        }
        const lines = lineMetas.map(({ did, meta }) => {
          const lineMeta = meta!;
          const startDate = normalizeDateKey(group.start) ?? lineMeta.startDate;
          const endDate = startDate ? addDaysToDateKey(startDate, days) : undefined;
          return {
            line_id: did,
            expected_updated_at: lineMeta.updatedAt,
            days,
            ...(startDate ? { start_date: startDate } : {}),
            ...(endDate !== undefined ? { end_date: endDate } : {}),
          };
        });
        const fallbackByDid = Object.fromEntries(
          lines.map((line) => [
            line.line_id,
            {
              days,
              ...(line.start_date !== undefined ? { startDate: line.start_date } : {}),
              ...(line.end_date !== undefined ? { endDate: line.end_date } : {}),
            },
          ]),
        );
        setGDays(gid, value);
        mutations.editLines.mutate(
          {
            taskId: beforeState.writeContext.taskId,
            client_action_id: createClientActionId('group-period'),
            packaging_group_id: beforeState.writeContext.groupIdByGid[gid] ?? null,
            lines,
          },
          {
            onSuccess: (data) => {
              applyReturnedLineMetas(data, fallbackByDid);
            },
            onError: () => {
              setGDays(gid, String(previousDays));
            },
          },
        );
      },
      onDropTo: (gid) => {
        // dropTo は内部の dragId を消費するため、移動前後の model を diff して移動 did を特定する。
        const beforeState = snap();
        if (!requireRealTaskContext(beforeState)) return;
        if (
          isRealDataEnabled() &&
          !Object.prototype.hasOwnProperty.call(beforeState.writeContext.groupIdByGid, gid)
        ) {
          reportMissingWriteContext();
          return;
        }
        const before = membershipOf(beforeState.model[beforeState.selId] ?? []);
        const previousModel = beforeState.model;
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
          if (
            !Object.prototype.hasOwnProperty.call(beforeState.writeContext.lineGroupByDid, movedDid)
          ) {
            useWorkbenchStore.setState({ model: previousModel });
            reportMissingWriteContext();
            return;
          }
          const expectedGroupId = beforeState.writeContext.lineGroupByDid[movedDid] ?? null;
          mutations.assignLines.mutate(
            {
              taskId,
              assignments: [
                {
                  line_id: movedDid,
                  packaging_group_id: groupId,
                  expected_packaging_group_id: expectedGroupId,
                },
              ],
            },
            {
              onSuccess: () => {
                useWorkbenchStore.setState((state) => ({
                  writeContext: {
                    ...state.writeContext,
                    lineGroupByDid: {
                      ...state.writeContext.lineGroupByDid,
                      [movedDid]: groupId,
                    },
                  },
                }));
              },
              onError: () => {
                useWorkbenchStore.setState({ model: previousModel });
              },
            },
          );
        });
      },
      onAddGroup: () => {
        if (isRealDataEnabled() && isAnyPending) return;
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
                const createdVersion = (data as { data?: { version?: unknown } } | null)?.data
                  ?.version;
                useWorkbenchStore.setState((state) => ({
                  writeContext: {
                    ...state.writeContext,
                    groupIdByGid: {
                      ...state.writeContext.groupIdByGid,
                      [gid]: createdId,
                    },
                    groupVersionByGid:
                      typeof createdVersion === 'number'
                        ? {
                            ...state.writeContext.groupVersionByGid,
                            [gid]: createdVersion,
                          }
                        : state.writeContext.groupVersionByGid,
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
        // primary(phase) はゲート判定＋next 算出に必須（target クリア副作用込み）。
        const next = primary(phase);
        if (next && isRealDataEnabled()) {
          // request 段: 前段ガードのみ実行し、OK で書込せず ConfirmDialog を要求して null を返す。
          // mutate は commitPrimary（ダイアログ確定）でのみ発火する。
          const s = snap();
          if (
            phase === 'dispense' &&
            s.writeContext.taskId &&
            s.writeContext.cycleVersion !== null
          ) {
            const quantityIssues = collectDispenseQuantityIssues(s);
            if (quantityIssues.length > 0) {
              reportDispenseQuantityIssues(quantityIssues);
              return null;
            }
            onRequestConfirm?.({
              phase: 'dispense',
              next,
              patientId: s.selId,
              taskId: s.writeContext.taskId,
              cycleVersion: s.writeContext.cycleVersion,
            });
          } else if (
            phase === 'audit' &&
            s.writeContext.taskId &&
            s.writeContext.cycleVersion !== null
          ) {
            const doubleCountIssues = collectDispenseAuditDoubleCountIssues(s);
            if (doubleCountIssues.length > 0) {
              toast.error(INVALID_AUDIT_DOUBLE_COUNT_MESSAGE);
              return null;
            }
            onRequestConfirm?.({
              phase: 'audit',
              next,
              narcoticLines: collectDispenseAuditDoubleCount(s),
              patientId: s.selId,
              taskId: s.writeContext.taskId,
              cycleVersion: s.writeContext.cycleVersion,
            });
          } else if (phase === 'seta' && s.writeContext.planId) {
            const carryPacketEvidence = collectCarryPacketEvidence(s);
            if (!carryPacketEvidence) {
              toast.error(
                'その他薬同梱と訪問持出パケットの確認証跡を作成できません。セット工程を再確認してください。',
              );
              return null;
            }
            onRequestConfirm?.({
              phase: 'seta',
              next,
              patientId: s.selId,
              planId: s.writeContext.planId,
            });
          }
          // setp（セット完了→監査）は可逆ナビゲーションで confirm 非対象ゆえ、real-data でも
          // 通常どおり next を返して遷移させる（gate 対象は dispense/audit/seta のみ）。
          if (phase === 'setp') return next;
          // 確認対象フェーズ（dispense/audit/seta）はナビを commit の onAdvance に一本化するため
          // 常に null を返す（writeContext 欠如等で confirm を出せない場合も遷移させない）。
          return null;
        }
        return next;
      },
      commitPrimary,
      commitSetAuditReject,
      onRequestRegenerate,
      commitForceRegen,

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
      onGenerateBatches: () => {
        if (isRealDataEnabled() && isAnyPending) return; // 実データ時のみ二重送信ガード
        const before = snap();
        if (!requireRealPlanContext(before)) return;
        // 初回生成（非破壊）のみ。破壊的な force 再生成は commitForceRegen に分離している。
        mutations.generateBatches.mutate({ force: false });
      },

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
        const ngLabel = before.ng[key];
        const ngCode = ngLabel ? NG_LABEL_TO_CODE[ngLabel] : undefined;
        if (isRealDataEnabled()) {
          // plan-level rejected を即 post する不可逆 sign-off ゆえ、前段ガード通過後は mutate せず
          // ConfirmDialog を要求し、確定は commitSetAuditReject でのみ行う（#4）。
          if (!ngLabel || !ngCode) {
            toast.error('NG分類を選択してから実行してください。');
            return;
          }
          const meta = requireRealCellContext(before, target);
          if (!meta) return;
          const planId = before.writeContext.planId;
          if (!planId) {
            reportMissingWriteContext();
            return;
          }
          onRequestRejectConfirm?.({
            patientId: before.selId,
            planId,
            target: { di: target.di, tk: target.tk },
            ngCode,
            ngLabel,
            meta,
          });
          return;
        }
        // mock: 従来どおり楽観 NG 表示のみ（API は叩かない）。
        applyCell(phase, 'ng', target);
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
    toggleQuantityConfirm,
    setActualQuantityInput,
    setDiscrepancyReason,
    setAuditDoubleCount,
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
    onRequestConfirm,
    onRequestRejectConfirm,
    onRequestRegenerateConfirm,
  ]);
}

/**
 * Build dispense completion lines from store state.
 * The caller must block unresolved or unconfirmed quantities before calling this helper.
 */
export function collectDispenseLines(
  s: ReturnType<typeof useWorkbenchStore.getState>,
): DispenseResultLineInput[] {
  const groups = s.model[s.selId] ?? [];
  const lines: DispenseResultLineInput[] = [];
  const actualQuantityInputByDid = s.actualQuantityInputByDid ?? {};
  const discrepancyReasonByDid = s.discrepancyReasonByDid ?? {};
  const quantityConfirmedByDid = s.quantityConfirmedByDid ?? {};
  for (const g of groups) {
    const groupId = s.writeContext.groupIdByGid[g.gid];
    const packagingDecision = resolveGroupPackagingDecision(g.method);
    for (const d of g.drugs) {
      const existingQuantity = d.dispensedQuantity;
      const prescribedQuantity = d.prescribedQuantity;
      const hasExistingQuantity = isPositiveFiniteQuantity(existingQuantity);
      if (!hasExistingQuantity && !isPositiveFiniteQuantity(prescribedQuantity)) {
        throw new Error('UNRESOLVED_DISPENSE_QUANTITY');
      }
      if (!hasExistingQuantity && !quantityConfirmedByDid[d.did]) {
        throw new Error('UNCONFIRMED_DISPENSE_QUANTITY');
      }
      const rawManualQuantity = actualQuantityInputByDid[d.did];
      const manualQuantity = parseActualQuantityInput(rawManualQuantity);
      if (
        hasExplicitActualQuantityInput(rawManualQuantity) &&
        !isValidActualQuantityForDrug({
          quantity: manualQuantity,
          unit: d.unit,
          prescribedQuantity,
        })
      ) {
        throw new Error('INVALID_DISPENSE_QUANTITY');
      }
      const actualQuantity = hasExistingQuantity
        ? existingQuantity
        : (manualQuantity ?? prescribedQuantity);
      if (!isPositiveFiniteQuantity(actualQuantity)) {
        throw new Error('UNRESOLVED_DISPENSE_QUANTITY');
      }
      const isManualQuantity =
        !hasExistingQuantity &&
        manualQuantity != null &&
        isPositiveFiniteQuantity(prescribedQuantity) &&
        !areQuantitiesEquivalentForUnit({
          left: manualQuantity,
          right: prescribedQuantity,
          unit: d.unit,
          referenceQuantity: prescribedQuantity,
        });
      const discrepancyReason = discrepancyReasonByDid[d.did]?.trim();
      const existingDiscrepancyReason = d.discrepancyReason?.trim();
      const effectiveDiscrepancyReason = discrepancyReason || existingDiscrepancyReason;
      const needsDiscrepancyReason =
        isPositiveFiniteQuantity(prescribedQuantity) &&
        !areQuantitiesEquivalentForUnit({
          left: actualQuantity,
          right: prescribedQuantity,
          unit: d.unit,
          referenceQuantity: prescribedQuantity,
        });
      if (needsDiscrepancyReason && !effectiveDiscrepancyReason) {
        throw new Error('DISCREPANCY_REASON_REQUIRED');
      }
      const assignedGroupId = groupId ?? s.writeContext.lineGroupByDid[d.did] ?? undefined;
      lines.push({
        line_id: d.did,
        actual_drug_name: d.name,
        actual_quantity: actualQuantity,
        actual_quantity_confirmed: true,
        actual_quantity_source: hasExistingQuantity
          ? 'existing_result'
          : isManualQuantity
            ? 'manual_entry'
            : 'prescription_quantity_confirmed',
        ...(d.unit ? { actual_unit: d.unit } : {}),
        carry_type: 'carry',
        ...(needsDiscrepancyReason && effectiveDiscrepancyReason
          ? { discrepancy_reason: effectiveDiscrepancyReason }
          : {}),
        packaging_method: packagingDecision.packaging_method,
        ...(assignedGroupId ? { packaging_group_id: assignedGroupId } : {}),
        ...(packagingDecision.special_notes
          ? { special_notes: packagingDecision.special_notes }
          : {}),
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

function outsideKindToEvidenceKind(kind: string): OutsideMedEvidenceKind {
  if (kind === '頓服') return 'prn';
  if (kind === '外用') return 'topical';
  if (kind === '冷所') return 'cold';
  if (kind === '注射') return 'injection';
  if (kind === '液剤') return 'liquid';
  return 'other';
}

function isCarryPacketItemKey(value: string): value is CarryPacketItemKey {
  return (
    value === 'cal' ||
    value === 'ton' ||
    value === 'gai' ||
    value === 'liq' ||
    value === 'doc' ||
    value === 'note'
  );
}

export function collectCarryPacketEvidence(
  s: ReturnType<typeof useWorkbenchStore.getState>,
): CarryPacketEvidenceInput | null {
  const planId = s.writeContext.planId;
  const cycleId = s.writeContext.cycleId;
  const patientId = s.selId;
  if (!planId || !cycleId || !patientId) return null;

  const calendar = calc(s.model, patientId);
  const outsideItems = calendar.outside.map((outside) => ({
    line_id: outside.line_id ?? '',
    kind: outsideKindToEvidenceKind(outside.kind),
    checked: s.outChk[`${patientId}:${outside.name}`] === true,
  }));
  const packetItems = packetKeys(s.model, patientId)
    .filter(isCarryPacketItemKey)
    .map((key) => ({
      key,
      checked: s.packet[`${patientId}:${key}`] === true,
    }));

  const allOutsideChecked = outsideItems.every(
    (item) => item.line_id.length > 0 && item.checked === true,
  );
  const allPacketChecked = packetItems.every((item) => item.checked === true);
  if (!allOutsideChecked || !allPacketChecked) return null;

  return {
    schema_version: CARRY_PACKET_EVIDENCE_SCHEMA_VERSION,
    plan_id: planId,
    cycle_id: cycleId,
    patient_id: patientId,
    outside_meds: outsideItems.map((item) => ({
      line_id: item.line_id,
      kind: item.kind,
      checked: true,
    })),
    packet_items: packetItems.map((item) => ({
      key: item.key,
      checked: true,
    })),
    summary: {
      outside_required_count: outsideItems.length,
      outside_confirmed_count: outsideItems.length,
      packet_required_count: packetItems.length,
      packet_confirmed_count: packetItems.length,
      all_checked: true,
    },
  };
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
