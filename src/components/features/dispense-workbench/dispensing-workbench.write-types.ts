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

import type { CalendarMatrix } from '@/app/api/medication-sets/workspace/set-derivations';
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
  /** gid(view 合成) → packaging_group_id（PackagingGroup.id）。 */
  groupIdByGid: Record<string, string>;
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
    groupIdByGid: {},
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

export const SET_AUDIT_CHECK_ITEMS = [
  { key: 'date_match', label: '日付が正しい' },
  { key: 'timing_match', label: '用法が正しい' },
  { key: 'quantity_match', label: '数量が正しい' },
  { key: 'no_discontinued', label: '中止薬が混入していない' },
  { key: 'residual_usage_ok', label: '残薬使用の指示と一致' },
  { key: 'cold_storage_separated', label: '冷所薬を分離している' },
] as const;

export type SetAuditChecklistKey = (typeof SET_AUDIT_CHECK_ITEMS)[number]['key'];

export const CARRY_PACKET_EVIDENCE_SCHEMA_VERSION = 1;

export const OUTSIDE_MED_EVIDENCE_KINDS = [
  'prn',
  'topical',
  'cold',
  'injection',
  'liquid',
  'other',
] as const;
export type OutsideMedEvidenceKind = (typeof OUTSIDE_MED_EVIDENCE_KINDS)[number];

export const CARRY_PACKET_ITEM_KEYS = ['cal', 'ton', 'gai', 'liq', 'doc', 'note'] as const;
export type CarryPacketItemKey = (typeof CARRY_PACKET_ITEM_KEYS)[number];

export interface CarryPacketEvidenceInput {
  schema_version: typeof CARRY_PACKET_EVIDENCE_SCHEMA_VERSION;
  plan_id: string;
  cycle_id: string;
  patient_id: string;
  outside_meds: Array<{
    line_id: string;
    kind: OutsideMedEvidenceKind;
    checked: true;
  }>;
  packet_items: Array<{
    key: CarryPacketItemKey;
    checked: true;
  }>;
  summary: {
    outside_required_count: number;
    outside_confirmed_count: number;
    packet_required_count: number;
    packet_confirmed_count: number;
    all_checked: true;
  };
}

// ============================================================================
// API I/O DTO（W2 レスポンスの最小サブセット）
// ============================================================================

/** GET /api/set-plans/[id]/calendar のレスポンス（success({data})）。 */
export type CalendarMatrixResponse = CalendarMatrix & {
  plan_id: string;
  cycle_id: string;
  cycle_version: number;
  cycle_status: string;
  set_method: string;
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
  carry_type: 'carry' | 'facility_deposit' | 'deferred';
  discrepancy_reason?: string;
}

export interface SubmitDispenseResultsInput {
  task_id: string;
  lines: DispenseResultLineInput[];
  expected_version: number;
}

export interface SubmitDispenseAuditInput {
  task_id: string;
  result: 'approved' | 'rejected' | 'hold' | 'emergency_approved';
  expected_version: number;
  reject_reason?: string;
  reject_reason_code?: string;
  reject_detail?: string;
  same_operator_reason?: string;
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
