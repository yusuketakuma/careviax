/**
 * 調剤ワークベンチ 書込結線の型 SSOT（計画 §12 / W3）。
 *
 * 既存の安定契約（dispensing-workbench.types.ts の SeedPatient / Group / Drug / view model）には
 * 一切触れない。書込（楽観更新 / 競合 / オフライン）で必要になる「実データ識別子」と
 * W2 API の I/O DTO だけをここに集約する。
 *
 * 最重要ギャップ（設計メモ）: store / view の単位は selId(患者ID) / did(line_id) /
 * gid(合成) / cellKey('{患者id}:{di}:{tk}') で、API が要求する task_id / plan_id /
 * batch_id / cycle.version とは別系。両者を橋渡しするのが {@link WorkbenchWriteContext}。
 *
 * 既定（モック）では writeContext は空のままで、書込は一切発火しない（現行 UI 不変）。
 * 実データ時のみ hydrate / カレンダー取得時に writeContext を充填する。
 */

import type { HoldReason, RejectCode, HoldScope } from '@prisma/client';
export type { RejectCode } from '@prisma/client';

import type { CalendarMatrix } from '@/lib/dispensing/set-derivations';
import type { PackagingMethodValue } from '@/lib/dispensing/packaging';
import type { CarryPacketEvidenceInput } from '@/lib/dispensing/set-audit-constants';
import type { Phase, TimingKey } from './dispensing-workbench.types';

// ============================================================================
// 競合エラー（409 WORKFLOW_CONFLICT）
// ============================================================================

/**
 * 409 WORKFLOW_CONFLICT を表す専用エラー。
 * mutateJson が 409 を受けたとき throw し、mutations hook が toast + invalidate に振り分ける。
 */
export class WorkbenchConflictError extends Error {
  readonly details: unknown;
  readonly status: number;
  constructor(details: unknown, status = 409) {
    super('WORKFLOW_CONFLICT');
    this.name = 'WorkbenchConflictError';
    this.details = details;
    this.status = status;
  }
}

/** 書込 fetch の一般失敗（非 2xx・ネットワーク）。message は API の message を引き継ぐ。 */
export class WorkbenchWriteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkbenchWriteError';
    this.status = status;
  }
}

// ============================================================================
// 実データ識別子（store ↔ API の橋）
// ============================================================================

/** カレンダー 1 セル（{患者id}:{di}:{tk}）に対応する SetBatch 群のメタ。 */
export interface CellMeta {
  /** 当該 day_number(1始まり) × slot に属する SetBatch.id 群（line 単位で複数）。 */
  batchIds: string[];
  /** 各 batch の現在 version（OCC アンカー）。batchIds と同順。 */
  versions: number[];
  /** 1始まりの通日（API day_number）。 */
  dayNumber: number;
  /** API slot キー（morning/noon/evening/bedtime/prn）。 */
  slot: string;
}

export interface PrescriptionLineMeta {
  updatedAt: string;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
}

/**
 * ワークベンチ書込に必要な実データ識別子の束（非永続・実データ時のみ充填）。
 * mock では全フィールド未設定（mutations hook はゲートで何もしない）。
 */
export interface WorkbenchWriteContext {
  /** dispense/audit 書込のアンカー（DispenseTask.id）。 */
  taskId: string | null;
  /** MedicationCycle.id（保留 create の cycle_id）。 */
  cycleId: string | null;
  /** OCC: dispense-results expected_version の元（cycle.version）。 */
  cycleVersion: number | null;
  /** set/seta 書込のアンカー（SetPlan.id）。 */
  planId: string | null;
  /** did(line_id) → packaging_group_id（グループ割当の現在値）。 */
  lineGroupByDid: Record<string, string | null>;
  /** did(line_id) → PrescriptionLine.updated_at/start/end/days（明細編集の OCC アンカー）。 */
  lineMetaByDid?: Record<string, PrescriptionLineMeta>;
  /** gid(view 合成) → packaging_group_id（PackagingGroup.id）。 */
  groupIdByGid: Record<string, string>;
  /** gid(view 合成) → PackagingGroup.version（グループ属性更新の OCC アンカー）。 */
  groupVersionByGid?: Record<string, number>;
  /** cellKey('{id}:{di}:{tk}') → CellMeta（セル set/hold/bulk のアンカー）。 */
  cellMeta: Record<string, CellMeta>;
}

/**
 * writeContext の部分更新（setWriteContext / アダプタが返す束）。
 * 取得経路ごと（workbench / calendar）に該当フィールドだけを充填する。
 */
export type WorkbenchWriteContextPatch = Partial<WorkbenchWriteContext>;

/** 空の writeContext（mock 既定 / 初期化）。 */
export function emptyWriteContext(): WorkbenchWriteContext {
  return {
    taskId: null,
    cycleId: null,
    cycleVersion: null,
    planId: null,
    lineGroupByDid: {},
    lineMetaByDid: {},
    groupIdByGid: {},
    groupVersionByGid: {},
    cellMeta: {},
  };
}

// ============================================================================
// マッピング（view ↔ API enum）
// ============================================================================

/** view 時点キー（朝/昼/夕/眠前） → API slot キー。 */
export const TIMING_TO_SLOT: Record<TimingKey, string> = {
  朝: 'morning',
  昼: 'noon',
  夕: 'evening',
  眠前: 'bedtime',
};

/** API slot キー → view 時点キー。 */
export const SLOT_TO_TIMING: Record<string, TimingKey> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
};

/** 保留理由（日本語ラベル → HoldReason enum）。HoldReasonDialog のラジオラベルに対応。 */
export const HOLD_REASON_TO_CODE: Record<string, HoldReason> = {
  処方変更待ち: 'prescription_change_wait',
  医師確認待ち: 'doctor_confirm_wait',
  残薬確認待ち: 'residual_confirm_wait',
  在庫不足: 'stock_shortage',
  '家族・施設確認待ち': 'family_facility_confirm_wait',
  訪問時に現地でセット: 'onsite_set_at_visit',
  その他: 'other',
};

/** NG 分類（日本語ラベル → RejectCode enum, 14種）。setNg のラジオラベル（NgCode）に対応。 */
export const NG_LABEL_TO_CODE: Record<string, RejectCode> = {
  患者違い: 'patient_mismatch',
  セット期間違い: 'set_period_mismatch',
  日付違い: 'date_mismatch',
  用法違い: 'frequency_mismatch',
  薬剤違い: 'drug_mismatch',
  数量不足: 'quantity_short',
  数量超過: 'quantity_over',
  中止薬混入: 'discontinued_mixed',
  休薬反映漏れ: 'washout_missed',
  変更前薬剤混入: 'previous_drug_mixed',
  カレンダー外薬未同梱: 'outside_med_missing',
  残薬指示反映漏れ: 'residual_instruction_missed',
  写真不鮮明: 'photo_unclear',
  判断不能: 'undeterminable',
};

export {
  CARRY_PACKET_EVIDENCE_SCHEMA_VERSION,
  CARRY_PACKET_ITEM_KEYS,
  OUTSIDE_MED_EVIDENCE_KINDS,
  SET_AUDIT_CHECK_ITEMS,
} from '@/lib/dispensing/set-audit-constants';
export type {
  CarryPacketEvidenceInput,
  CarryPacketItemKey,
  OutsideMedEvidenceKind,
  SetAuditChecklistKey,
} from '@/lib/dispensing/set-audit-constants';

// ============================================================================
// API I/O DTO（W2 レスポンスの最小サブセット）
// ============================================================================

export type NarcoticClassificationStatus = 'normal' | 'needs_review';

export interface NarcoticClassificationSummary {
  unresolved_line_count: number;
  status: NarcoticClassificationStatus;
}

export interface SetBatchGenerationMetadata {
  batch_count: number;
  /** True only when FE should call non-force initial generation. Existing batches require force regeneration. */
  needs_initial_generation: boolean;
  latest_batch_updated_at: string | null;
  expected_updated_at: string;
  /** Status-level permission; use needs_initial_generation or can_force_regenerate to choose the action. */
  can_generate: boolean;
  can_force_regenerate: boolean;
}

/** GET /api/set-plans/[id]/calendar のレスポンス（success({data})）。 */
export type CalendarMatrixResponse = CalendarMatrix & {
  plan_id: string;
  cycle_id: string;
  cycle_version: number;
  cycle_status: string;
  set_method: string;
  generation?: SetBatchGenerationMetadata;
  narcotic_classification?: NarcoticClassificationSummary;
};

/** cell/bulk-set が返す SetBatch DTO（version 追従に使用）。 */
export interface SetBatchDto {
  id: string;
  line_id: string;
  set_state: string;
  audit_state: string;
  version: number;
  day_number: number;
  slot: string;
}

/** mock ゲート時の no-op センチネル（書込関数の早期 return 値）。 */
export const MOCK_WRITE_NOOP = { __mock: true } as const;
export type MockWriteNoop = typeof MOCK_WRITE_NOOP;

// ============================================================================
// 書込関数の入力型
// ============================================================================

export interface DispenseResultLineInput {
  line_id: string;
  actual_drug_name: string;
  actual_quantity: number;
  actual_quantity_confirmed?: boolean;
  actual_quantity_source?: 'existing_result' | 'prescription_quantity_confirmed' | 'manual_entry';
  actual_unit?: string;
  carry_type: 'carry' | 'facility_deposit' | 'deferred';
  discrepancy_reason?: string;
  packaging_method?: PackagingMethodValue;
  packaging_group_id?: string;
  special_notes?: string;
}

export interface PrescriptionLinePeriodUpdateInput {
  line_id: string;
  expected_updated_at: string;
  start_date?: string | null;
  end_date?: string | null;
  days?: number;
}

export interface UpdatePrescriptionLinesInput {
  taskId: string;
  client_action_id?: string;
  packaging_group_id?: string | null;
  lines: PrescriptionLinePeriodUpdateInput[];
}

export interface SubmitDispenseResultsInput {
  task_id: string;
  lines: DispenseResultLineInput[];
  expected_version: number;
}

export interface VerifyDispenseBarcodeInput {
  taskId: string;
  line_id: string;
  barcode: string;
}

export interface VerifyDispenseBarcodeResponse {
  match: boolean;
  decoded: {
    gtin?: string;
    expiryDate?: string;
    lotNumber?: string;
  };
  expected: {
    drug_code: string | null;
    drug_name: string;
  };
  warnings: string[];
}

export interface SubmitDispenseAuditInput {
  task_id: string;
  result: 'approved' | 'rejected' | 'hold' | 'emergency_approved';
  expected_version: number;
  reject_reason?: string;
  reject_reason_code?: string;
  reject_detail?: string;
  same_operator_reason?: string;
  double_count?: Array<{
    line_id: string;
    drug_name: string;
    dispensed_quantity: number | null;
    first_count: number | null;
    second_count: number | null;
  }>;
}

export type CellMutationTarget =
  | { batch_id: string; expected_version: number; cells?: never }
  | {
      batch_id?: never;
      expected_version?: never;
      cells: Array<{ batch_id: string; expected_version: number }>;
    };

export type CellMutationInput = CellMutationTarget & {
  action: 'set' | 'hold' | 'clear';
  held_reason?: HoldReason;
  held_detail?: string;
};

export interface SubmitSetAuditInput {
  plan_id: string;
  result: 'approved' | 'partial_approved' | 'rejected';
  approved_scope?: Record<string, boolean>;
  reject_reason?: string;
  reject_reason_code?: RejectCode;
  checklist?: Record<string, boolean>;
  carry_packet_evidence?: CarryPacketEvidenceInput;
  cell_audits?: Array<{
    batch_id: string;
    audit_state: 'ok' | 'ng';
    ng_code?: RejectCode;
    expected_version: number;
  }>;
}

// ============================================================================
// 不可逆 sign-off 確認（ConfirmDialog gating / S0）
// ============================================================================

/**
 * 監査承認時に二重計数を確認すべき麻薬 line（confirm ダイアログ表示用）。
 * `collectDispenseAuditDoubleCount()` の戻り要素を再利用する
 * （line_id / drug_name / dispensed_quantity / first_count / second_count）。
 */
export type AuditNarcoticLine = NonNullable<SubmitDispenseAuditInput['double_count']>[number];

/**
 * 確認待ちの主操作（不可逆 sign-off）。real-data の onPrimary が request 段で生成し、
 * ConfirmDialog の onConfirm から commitPrimary が消費する。
 * setp（セット完了→監査）は可逆ナビゲーションのため S0 では対象外（除外）。
 */
export type PendingPrimary =
  | { phase: 'dispense'; next: Phase }
  | { phase: 'audit'; next: Phase; narcoticLines: AuditNarcoticLine[] } // 空配列=非麻薬
  | { phase: 'seta'; next: Phase };

export interface CreateCycleHoldInput {
  cycle_id: string;
  phase: Phase | string;
  scope: HoldScope;
  reason: HoldReason;
  reason_detail?: string;
  line_id?: string;
  day_number?: number;
  slot?: string;
  due_at?: string;
  assigned_to?: string;
  note?: string;
}
