import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import {
  buildSetAuditAssignmentWhere,
  buildSetPlanAssignmentWhere,
} from '@/server/services/prescription-access';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { toPrismaJsonInput } from '@/lib/db/json';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/dispensing/set-batch-history';
import {
  CARRY_PACKET_EVIDENCE_SCHEMA_VERSION,
  CARRY_PACKET_ITEM_KEYS,
  OUTSIDE_MED_EVIDENCE_KINDS,
  SET_AUDIT_REQUIRED_CHECKLIST_KEYS,
  type CarryPacketItemKey,
  type OutsideMedEvidenceKind,
} from '@/lib/dispensing/set-audit-constants';
import { RejectCode, SetAuditCellState, type ScheduleStatus } from '@prisma/client';
import { ADMIN_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { deriveOutsideMedEvidenceKind } from '@/lib/dispensing/outside-med-classification';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { z } from 'zod';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

const ROUTE = '/api/set-audits';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

// 調剤ワークベンチ共通 NG 分類 (RejectCode, 14種)。差戻し/セル NG の理由を構造化する。
const REJECT_CODE_VALUES = Object.values(RejectCode) as [RejectCode, ...RejectCode[]];

// セル単位の監査判定。SetBatch.audit_state を ok/ng に確定する (unaudited は確定対象外)。
const cellAuditSchema = z.object({
  batch_id: z.string().min(1, 'バッチIDは必須です'),
  audit_state: z.enum(['ok', 'ng'], { error: 'セル監査結果を選択してください' }),
  ng_code: z.enum(REJECT_CODE_VALUES).optional(),
  expected_version: z
    .number({ error: 'セルの版番号が不正です' })
    .int('セルの版番号が不正です')
    .nonnegative('セルの版番号が不正です'),
});

// B3: approved_scope keys must match pattern day_number-slot
const approvedScopeSchema = z
  .record(z.string().regex(/^\d+-(?:morning|noon|evening|bedtime|prn)$/), z.boolean())
  .optional();

// p0_15: 6項目チェックリスト(項目キー → 真偽)。3ペイン再構築の右ペインで記録する。
const checklistSchema = z.record(z.string().min(1), z.boolean()).optional();

const outsideMedEvidenceSchema = z
  .object({
    line_id: z.string().min(1).max(128),
    kind: z.enum(OUTSIDE_MED_EVIDENCE_KINDS),
    checked: z.literal(true),
  })
  .strict();

const packetItemEvidenceSchema = z
  .object({
    key: z.enum(CARRY_PACKET_ITEM_KEYS),
    checked: z.literal(true),
  })
  .strict();

const carryPacketEvidenceSchema = z
  .object({
    schema_version: z.literal(CARRY_PACKET_EVIDENCE_SCHEMA_VERSION),
    plan_id: z.string().min(1).max(128),
    cycle_id: z.string().min(1).max(128),
    patient_id: z.string().min(1).max(128),
    outside_meds: z.array(outsideMedEvidenceSchema).max(300),
    packet_items: z.array(packetItemEvidenceSchema).min(1).max(CARRY_PACKET_ITEM_KEYS.length),
    summary: z
      .object({
        outside_required_count: z.number().int().nonnegative().max(300),
        outside_confirmed_count: z.number().int().nonnegative().max(300),
        packet_required_count: z.number().int().min(1).max(CARRY_PACKET_ITEM_KEYS.length),
        packet_confirmed_count: z.number().int().min(1).max(CARRY_PACKET_ITEM_KEYS.length),
        all_checked: z.literal(true),
      })
      .strict(),
  })
  .strict();

const createSetAuditSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  result: z.enum(['approved', 'partial_approved', 'rejected'], {
    error: '鑑査結果を選択してください',
  }),
  approved_scope: approvedScopeSchema,
  reject_reason: z.string().optional(),
  // 差戻し/部分承認時の構造化 NG 分類 (RejectCode, 14種)。rejected では必須。
  reject_reason_code: z.enum(REJECT_CODE_VALUES).optional(),
  // D6: 監査時刻はサーバ信頼時刻 (new Date()) に統一する (§12-5 14.3)。
  // クライアントが監査時刻を偽造できないよう audited_at は受け付けない。
  // D1=B: 単独薬剤師の自己監査=限定例外。セット実施者=監査者の場合のみ、理由必須 + admin 承認で許可する。
  same_operator_reason: z.string().trim().min(1).max(1000).optional(),
  // p0_15 セット監査 3ペイン: チェックリストと写真資産(セット前/セット後/設置予定)。
  checklist: checklistSchema,
  carry_packet_evidence: carryPacketEvidenceSchema.optional(),
  photo_asset_ids: z.array(z.string().min(1)).max(50).optional(),
  // 調剤ワークベンチ セル単位監査 (P0): SetBatch.audit_state / ng_code を確定する。
  cell_audits: z.array(cellAuditSchema).max(500).optional(),
});

const NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES: ScheduleStatus[] = [
  'planned',
  'in_preparation',
  'postponed',
];

class SetAuditRollback extends Error {
  constructor(
    readonly result:
      | { error: 'cell_version_conflict'; conflict: true }
      | { error: 'already_audited'; conflict: true }
      | { error: string; conflict?: true },
  ) {
    super('set audit transaction rolled back');
  }
}

type ExistingSetAuditForReplay = {
  id: string;
  result: string;
  approved_scope: unknown;
  reject_reason: string | null;
  checklist: unknown;
  photo_asset_ids: string[];
  audited_by: string;
  same_operator_reason: string | null;
};

type IdempotentSetAuditReplay = ExistingSetAuditForReplay & {
  idempotent: true;
};

type CarryPacketEvidence = z.infer<typeof carryPacketEvidenceSchema>;
type CarryPacketEvidenceValidationResult =
  | { ok: true; evidence: CarryPacketEvidence; summary: CarryPacketEvidence['summary'] }
  | { ok: false; reason: string };

type SetAuditEvidenceBatch = {
  line_id: string;
  line: {
    id: string;
    drug_name: string;
    drug_code: string | null;
    dosage_form: string | null;
    dose: string;
    frequency: string;
    unit: string | null;
    route: string | null;
    packaging_instructions: string | null;
    packaging_instruction_tags: string[];
    notes: string | null;
  };
};

function normalizeApprovedScope(scope: unknown) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(scope).filter(([key, value]) => typeof key === 'string' && value === true),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function mergeApprovedScope(previousScope: unknown, currentScope?: Record<string, boolean>) {
  const previous = normalizeApprovedScope(previousScope) ?? {};
  const current = normalizeApprovedScope(currentScope) ?? {};
  const merged = { ...previous, ...current };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeJsonForCompare(value: unknown) {
  return JSON.stringify(value ?? null);
}

function sortedTextValues(values: readonly string[] | null | undefined) {
  return [...(values ?? [])].sort();
}

function hasDuplicateTextValues(values: readonly string[]) {
  return new Set(values).size !== values.length;
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function textSetEquals(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function deriveExpectedOutsideMeds(batches: SetAuditEvidenceBatch[]) {
  const lineById = new Map<string, SetAuditEvidenceBatch['line']>();
  for (const batch of batches) {
    if (!lineById.has(batch.line_id)) lineById.set(batch.line_id, batch.line);
  }

  return Array.from(lineById.values())
    .map((line) => {
      const kind = deriveOutsideMedEvidenceKind(line);
      return kind ? { line_id: line.id, kind } : null;
    })
    .filter((value): value is { line_id: string; kind: OutsideMedEvidenceKind } => value !== null)
    .sort((a, b) => a.line_id.localeCompare(b.line_id));
}

function deriveExpectedPacketKeys(
  outsideMeds: Array<{ kind: OutsideMedEvidenceKind }>,
): CarryPacketItemKey[] {
  const keys: CarryPacketItemKey[] = ['cal'];
  if (outsideMeds.some((item) => item.kind === 'prn')) keys.push('ton');
  if (outsideMeds.some((item) => item.kind === 'topical')) keys.push('gai');
  if (outsideMeds.some((item) => item.kind === 'liquid' || item.kind === 'cold')) {
    keys.push('liq');
  }
  keys.push('doc', 'note');
  return keys;
}

function normalizeCarryPacketEvidence(
  evidence: CarryPacketEvidence,
  expectedOutsideMeds: Array<{ line_id: string; kind: OutsideMedEvidenceKind }>,
  expectedPacketKeys: CarryPacketItemKey[],
): CarryPacketEvidence {
  return {
    schema_version: CARRY_PACKET_EVIDENCE_SCHEMA_VERSION,
    plan_id: evidence.plan_id,
    cycle_id: evidence.cycle_id,
    patient_id: evidence.patient_id,
    outside_meds: expectedOutsideMeds.map((item) => ({
      line_id: item.line_id,
      kind: item.kind,
      checked: true,
    })),
    packet_items: expectedPacketKeys.map((key) => ({ key, checked: true })),
    summary: {
      outside_required_count: expectedOutsideMeds.length,
      outside_confirmed_count: expectedOutsideMeds.length,
      packet_required_count: expectedPacketKeys.length,
      packet_confirmed_count: expectedPacketKeys.length,
      all_checked: true,
    },
  };
}

function validateCarryPacketEvidence(args: {
  evidence: CarryPacketEvidence;
  planId: string;
  cycleId: string;
  patientId: string | null;
  batches: SetAuditEvidenceBatch[];
}): CarryPacketEvidenceValidationResult {
  const { evidence, planId, cycleId, patientId, batches } = args;
  if (evidence.plan_id !== planId || evidence.cycle_id !== cycleId) {
    return { ok: false, reason: 'plan_or_cycle_mismatch' };
  }
  if (!patientId || evidence.patient_id !== patientId) {
    return { ok: false, reason: 'patient_mismatch' };
  }

  const expectedOutsideMeds = deriveExpectedOutsideMeds(batches);
  const expectedOutsideIds = expectedOutsideMeds.map((item) => item.line_id);
  const submittedOutsideIds = evidence.outside_meds.map((item) => item.line_id);
  if (uniqueValues(submittedOutsideIds).length !== submittedOutsideIds.length) {
    return { ok: false, reason: 'duplicate_outside_line' };
  }
  if (!textSetEquals(submittedOutsideIds, expectedOutsideIds)) {
    return { ok: false, reason: 'outside_line_mismatch' };
  }

  const submittedOutsideById = new Map(
    evidence.outside_meds.map((item) => [item.line_id, item.kind]),
  );
  for (const expected of expectedOutsideMeds) {
    if (submittedOutsideById.get(expected.line_id) !== expected.kind) {
      return { ok: false, reason: 'outside_kind_mismatch' };
    }
  }

  const expectedPacketKeys = deriveExpectedPacketKeys(expectedOutsideMeds);
  const submittedPacketKeys = evidence.packet_items.map((item) => item.key);
  if (uniqueValues(submittedPacketKeys).length !== submittedPacketKeys.length) {
    return { ok: false, reason: 'duplicate_packet_key' };
  }
  if (!textSetEquals(submittedPacketKeys, expectedPacketKeys)) {
    return { ok: false, reason: 'packet_key_mismatch' };
  }

  const summary = evidence.summary;
  if (
    summary.outside_required_count !== expectedOutsideMeds.length ||
    summary.outside_confirmed_count !== expectedOutsideMeds.length ||
    summary.packet_required_count !== expectedPacketKeys.length ||
    summary.packet_confirmed_count !== expectedPacketKeys.length
  ) {
    return { ok: false, reason: 'summary_mismatch' };
  }

  const normalized = normalizeCarryPacketEvidence(
    evidence,
    expectedOutsideMeds,
    expectedPacketKeys,
  );
  return { ok: true, evidence: normalized, summary: normalized.summary };
}

function buildPersistedSetAuditChecklist(
  checklist: Record<string, boolean> | undefined,
  carryPacketEvidence: CarryPacketEvidence | null,
) {
  if (!checklist && !carryPacketEvidence) return undefined;
  return {
    ...(checklist ?? {}),
    ...(carryPacketEvidence ? { carry_packet_evidence: carryPacketEvidence } : {}),
  };
}

async function findInvalidSetAuditPhotoAssetIds(
  tx: {
    fileAsset: {
      findMany(args: {
        where: {
          id: { in: string[] };
          org_id: string;
          purpose: string;
          status: string;
          storage_key: { startsWith: string };
        };
        select: { id: true };
      }): Promise<Array<{ id: string }>>;
    };
  },
  args: {
    orgId: string;
    photoAssetIds: readonly string[] | undefined;
  },
) {
  const photoAssetIds = args.photoAssetIds ?? [];
  if (photoAssetIds.length === 0) return [];
  if (hasDuplicateTextValues(photoAssetIds)) return photoAssetIds;

  const assets = await tx.fileAsset.findMany({
    where: {
      id: { in: [...photoAssetIds] },
      org_id: args.orgId,
      purpose: 'set-photo',
      status: 'completed',
      storage_key: { startsWith: `set-audits/${args.orgId}/` },
    },
    select: { id: true },
  });
  const validIds = new Set(assets.map((asset) => asset.id));
  return photoAssetIds.filter((id) => !validIds.has(id));
}

function isIdempotentSetAuditReplay(value: unknown): value is IdempotentSetAuditReplay {
  return typeof value === 'object' && value !== null && 'idempotent' in value;
}

function existingSetAuditMatchesApprovedReplay(args: {
  existingAudit: ExistingSetAuditForReplay;
  userId: string;
  approvedScope: unknown;
  checklist: unknown;
  photoAssetIds: readonly string[] | undefined;
  sameOperatorReason: string | undefined;
}) {
  return (
    args.existingAudit.audited_by === args.userId &&
    args.existingAudit.result === 'approved' &&
    normalizeJsonForCompare(args.existingAudit.approved_scope) ===
      normalizeJsonForCompare(args.approvedScope) &&
    normalizeJsonForCompare(args.existingAudit.checklist) ===
      normalizeJsonForCompare(args.checklist) &&
    normalizeJsonForCompare(sortedTextValues(args.existingAudit.photo_asset_ids)) ===
      normalizeJsonForCompare(sortedTextValues(args.photoAssetIds)) &&
    nullableText(args.existingAudit.same_operator_reason) === nullableText(args.sameOperatorReason)
  );
}

function cellAuditsAlreadyApplied(
  setBatches: Array<{ id: string; audit_state: string; ng_code: RejectCode | null }>,
  cellAudits: Array<{ batch_id: string; audit_state: 'ok' | 'ng'; ng_code?: RejectCode }> = [],
) {
  const batchById = new Map(setBatches.map((batch) => [batch.id, batch]));
  return cellAudits.every((cell) => {
    const batch = batchById.get(cell.batch_id);
    if (!batch) return false;
    const expectedNgCode = cell.audit_state === 'ng' ? (cell.ng_code ?? null) : null;
    return batch.audit_state === cell.audit_state && batch.ng_code === expectedNgCode;
  });
}

function buildSetCarryItems(
  batches: Array<{
    id: string;
    slot: string;
    day_number: number;
    quantity: number;
    carry_type: string;
    set_state: string;
    audit_state: string;
    line: {
      id: string;
      drug_name: string;
      drug_code: string | null;
      dose: string;
      frequency: string;
      unit: string | null;
    };
  }>,
  approvedScope?: Record<string, unknown>,
) {
  const approvedKeys =
    approvedScope == null
      ? null
      : new Set(Object.keys(approvedScope).filter((key) => approvedScope[key] === true));

  return batches
    .filter((batch) => {
      if (batch.set_state !== 'set' || batch.audit_state !== 'ok') return false;
      if (!approvedKeys) return true;
      return approvedKeys.has(`${batch.day_number}-${batch.slot}`);
    })
    .map((batch) => ({
      batch_id: batch.id,
      line_id: batch.line.id,
      drug_name: batch.line.drug_name,
      drug_code: batch.line.drug_code,
      dose: batch.line.dose,
      frequency: batch.line.frequency,
      day_number: batch.day_number,
      slot: batch.slot,
      quantity: batch.quantity,
      unit: batch.line.unit,
      carry_type: batch.carry_type,
    }));
}

function applyCellAuditPreview<
  TBatch extends { id: string; audit_state: string; ng_code?: RejectCode | null },
>(batches: TBatch[], cellAudits: Array<z.infer<typeof cellAuditSchema>> | undefined) {
  if (!cellAudits || cellAudits.length === 0) return batches;
  const auditByBatchId = new Map(cellAudits.map((cell) => [cell.batch_id, cell]));
  return batches.map((batch) => {
    const cell = auditByBatchId.get(batch.id);
    if (!cell) return batch;
    return {
      ...batch,
      audit_state: cell.audit_state,
      ng_code: cell.audit_state === 'ng' ? (cell.ng_code ?? null) : null,
    };
  });
}

function findSetAuditApprovalBlockers(
  batches: Array<{
    id: string;
    set_state: string;
    audit_state: string;
    ng_code?: RejectCode | null;
  }>,
) {
  return batches.filter((batch) => batch.set_state !== 'set' || batch.audit_state !== 'ok');
}

function findPartialApprovalScopeBlockers(
  batches: Array<{
    id: string;
    day_number: number;
    slot: string;
    set_state: string;
    audit_state: string;
    ng_code?: RejectCode | null;
  }>,
  approvedScope: Record<string, unknown>,
) {
  const selected = batches.filter((batch) => approvedScope[`${batch.day_number}-${batch.slot}`]);
  const blockers = selected.filter(
    (batch) => batch.set_state !== 'set' || batch.audit_state !== 'ok',
  );
  const ready = selected.filter((batch) => batch.set_state === 'set' && batch.audit_state === 'ok');
  return { blockers, readyCount: ready.length };
}

// セル状態の集計 (audit_state 別件数)。監査キュー一覧の進捗表示に使う。
function summarizeCellStates(batches: Array<{ audit_state: SetAuditCellState }>) {
  const summary = { total: batches.length, unaudited: 0, ok: 0, ng: 0 };
  for (const batch of batches) {
    summary[batch.audit_state] += 1;
  }
  return summary;
}

async function authenticatedGET(req: NextRequest) {
  const auth = await requireAuthContext(req, {
    permission: 'canAuditSet',
    message: 'セット鑑査の閲覧権限がありません',
  });
  if ('response' in auth) return auth.response;

  const { ctx } = auth;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('plan_id') ?? undefined;
    const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);

    // 監査待ち = サイクルが setting 状態のセットプラン。plan_id 指定で単一プランに絞れる。
    const plans = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.setPlan.findMany({
          where: {
            org_id: ctx.orgId,
            ...(planId ? { id: planId } : {}),
            cycle: { overall_status: 'setting' },
            ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            cycle_id: true,
            target_period_start: true,
            target_period_end: true,
            set_method: true,
            created_at: true,
            updated_at: true,
            cycle: {
              select: {
                id: true,
                overall_status: true,
                patient_id: true,
                case_: {
                  select: {
                    patient: {
                      select: { id: true, name: true, name_kana: true },
                    },
                  },
                },
              },
            },
            batches: {
              orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
              select: {
                id: true,
                slot: true,
                day_number: true,
                quantity: true,
                carry_type: true,
                set_state: true,
                audit_state: true,
                ng_code: true,
                set_by: true,
                audited_by: true,
                audited_at: true,
                version: true,
                line: {
                  select: {
                    id: true,
                    drug_name: true,
                    drug_code: true,
                    dose: true,
                    frequency: true,
                    unit: true,
                  },
                },
              },
            },
            audits: {
              orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
              take: 1,
              select: {
                id: true,
                result: true,
                reject_reason: true,
                audited_at: true,
                audited_by: true,
              },
            },
          },
        }),
      { requestContext: ctx },
    );

    return success({
      data: plans.map((plan) => ({
        ...plan,
        cell_summary: summarizeCellStates(plan.batches),
      })),
    });
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('set_audits_get_unhandled_error', undefined, {
        event: 'set_audits_get_unhandled_error',
        route: ROUTE,
        method: 'GET',
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPOST(req: NextRequest) {
  const auth = await requireAuthContext(req, {
    permission: 'canAuditSet',
    message: 'セット鑑査の実行権限がありません',
  });
  if ('response' in auth) return auth.response;

  const { ctx } = auth;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createSetAuditSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      plan_id,
      result,
      approved_scope,
      reject_reason,
      reject_reason_code,
      same_operator_reason,
      checklist,
      carry_packet_evidence,
      photo_asset_ids,
      cell_audits,
    } = parsed.data;

    // 監査OKはサーバ側でも現行3ペインUIの全6項目チェック完了を必須にする。
    if (result === 'approved') {
      const allChecked = SET_AUDIT_REQUIRED_CHECKLIST_KEYS.every(
        (key) => checklist?.[key] === true,
      );
      if (!allChecked) {
        return validationError('監査OKには全6項目のチェックが必要です');
      }
      if (!carry_packet_evidence) {
        return validationError('監査OKにはその他薬同梱と訪問持出パケットの確認証跡が必要です');
      }
    }

    // 差戻し時は構造化 NG 分類 (RejectCode) を必須にする (§12-5 監査証跡)。
    // 自由記述 reject_reason だけでは集計/分析できないため、コード化を強制する。
    if (result === 'rejected' && !reject_reason_code) {
      return validationError('差戻し時はNG分類コード(reject_reason_code)が必須です');
    }

    // セル監査: NG セルには必ず NG 分類コードを添付する。重複バッチ指定も拒否する。
    if (cell_audits && cell_audits.length > 0) {
      const seen = new Set<string>();
      for (const cell of cell_audits) {
        if (seen.has(cell.batch_id)) {
          return validationError('セル監査のバッチIDが重複しています', {
            batch_id: cell.batch_id,
          });
        }
        seen.add(cell.batch_id);
        if (cell.audit_state === 'ng' && !cell.ng_code) {
          return validationError('NGセルにはNG分類コード(ng_code)が必須です', {
            batch_id: cell.batch_id,
          });
        }
      }
    }

    const auditResult = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);
        const auditAssignmentWhere = buildSetAuditAssignmentWhere(ctx);
        const plan = await tx.setPlan.findFirst({
          where: {
            id: plan_id,
            org_id: ctx.orgId,
            ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
          },
          select: {
            id: true,
            cycle_id: true,
            cycle: {
              select: {
                patient_id: true,
              },
            },
          },
        });

        if (!plan) return null;

        // D6: 監査時刻はサーバ信頼時刻に統一 (クライアント audited_at は不採用)。
        const now = new Date();
        const setBatches = await tx.setBatch.findMany({
          where: { plan_id, org_id: ctx.orgId },
          include: {
            line: {
              select: {
                id: true,
                drug_name: true,
                drug_code: true,
                dosage_form: true,
                dose: true,
                frequency: true,
                unit: true,
                route: true,
                packaging_instructions: true,
                packaging_instruction_tags: true,
                notes: true,
              },
            },
          },
        });

        // B3: Zero-batch guard
        if (setBatches.length === 0) {
          return { error: 'no_batches' as const };
        }

        const carryPacketValidation =
          result === 'approved' && carry_packet_evidence
            ? validateCarryPacketEvidence({
                evidence: carry_packet_evidence,
                planId: plan_id,
                cycleId: plan.cycle_id,
                patientId: plan.cycle?.patient_id ?? null,
                batches: setBatches,
              })
            : null;
        if (carryPacketValidation && !carryPacketValidation.ok) {
          return {
            error: 'invalid_carry_packet_evidence' as const,
            reason: carryPacketValidation.reason,
          };
        }
        const normalizedCarryPacketEvidence =
          carryPacketValidation && carryPacketValidation.ok ? carryPacketValidation.evidence : null;
        const carryPacketEvidenceSummary =
          carryPacketValidation && carryPacketValidation.ok ? carryPacketValidation.summary : null;
        const persistedChecklist = buildPersistedSetAuditChecklist(
          checklist,
          normalizedCarryPacketEvidence,
        );

        const existingTerminalAudit = await tx.setAudit.findFirst({
          where: {
            plan_id,
            org_id: ctx.orgId,
            result: { in: ['approved', 'rejected'] },
            ...(auditAssignmentWhere ? { AND: [auditAssignmentWhere] } : {}),
          },
          orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
          select: {
            id: true,
            result: true,
            approved_scope: true,
            reject_reason: true,
            checklist: true,
            photo_asset_ids: true,
            audited_by: true,
            same_operator_reason: true,
          },
        });
        if (existingTerminalAudit) {
          if (
            result === 'approved' &&
            existingSetAuditMatchesApprovedReplay({
              existingAudit: existingTerminalAudit,
              userId: ctx.userId,
              approvedScope: normalizeApprovedScope(approved_scope),
              checklist: persistedChecklist ? toPrismaJsonInput(persistedChecklist) : undefined,
              photoAssetIds: photo_asset_ids,
              sameOperatorReason: same_operator_reason,
            }) &&
            cellAuditsAlreadyApplied(setBatches, cell_audits)
          ) {
            return { ...existingTerminalAudit, idempotent: true } as const;
          }
          return { error: 'already_audited' as const, conflict: true };
        }

        const invalidPhotoAssetIds = await findInvalidSetAuditPhotoAssetIds(tx, {
          orgId: ctx.orgId,
          photoAssetIds: photo_asset_ids,
        });
        if (invalidPhotoAssetIds.length > 0) {
          return {
            error: 'invalid_photo_assets' as const,
            photoAssetIds: invalidPhotoAssetIds,
          };
        }

        // B3: Validate approved_scope keys match actual batches
        if (approved_scope) {
          const validKeys = new Set(setBatches.map((b) => `${b.day_number}-${b.slot}`));
          const invalidKeys = Object.keys(approved_scope).filter((key) => !validKeys.has(key));
          if (invalidKeys.length > 0) {
            return { error: 'invalid_scope_keys' as const, keys: invalidKeys };
          }
        }

        // セル単位監査の事前検証 (職務分離 + バッチ所属確認)。
        // 確定 (SetBatch.audit_state/ng_code 更新) は監査記録作成後にまとめて行う。
        // D1=B: セット実施者=監査者 (自己監査) を検出する。two-person rule の原則は維持し、
        // 自己監査は「理由必須 + admin 承認」を満たした限定例外でのみ許可する。
        let selfAuditDetected = false;
        if (cell_audits && cell_audits.length > 0) {
          const batchById = new Map(setBatches.map((batch) => [batch.id, batch]));

          for (const cell of cell_audits) {
            const batch = batchById.get(cell.batch_id);
            // 指定バッチが当該プランに属さない → 不正リクエスト。
            if (!batch) {
              return { error: 'invalid_batch' as const, batchId: cell.batch_id };
            }
            // The auditor must confirm the same SetBatch version they saw in the calendar UI.
            if (cell.expected_version !== batch.version) {
              return { error: 'cell_version_conflict' as const, conflict: true };
            }
            // 職務分離 (§12-5): セット実施者は自身がセットしたセルを監査できない (原則)。
            if (batch.set_by && batch.set_by === ctx.userId) {
              selfAuditDetected = true;
            }
          }
        }

        // D1=B: 自己監査の限定例外ガード。
        // ① 理由 (same_operator_reason) 必須。② admin 承認権限 (owner/admin) 必須。
        // いずれかを欠く場合は従来どおり職務分離違反として拒否する。
        let selfAuditApprovedBy: string | null = null;
        if (selfAuditDetected) {
          if (!same_operator_reason) {
            return { error: 'self_audit' as const };
          }
          const adminMembership = await tx.membership.findFirst({
            where: {
              org_id: ctx.orgId,
              user_id: ctx.userId,
              is_active: true,
              role: { in: [...ADMIN_MEMBER_ROLES] },
            },
            select: { id: true },
          });
          if (!adminMembership) {
            return { error: 'self_audit_not_approved' as const };
          }
          selfAuditApprovedBy = ctx.userId;
        }

        const effectiveSetBatches = applyCellAuditPreview(setBatches, cell_audits);

        const latestAudit =
          result === 'partial_approved'
            ? await tx.setAudit.findFirst({
                where: {
                  plan_id,
                  org_id: ctx.orgId,
                  ...(auditAssignmentWhere ? { AND: [auditAssignmentWhere] } : {}),
                },
                orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
                select: {
                  result: true,
                  approved_scope: true,
                },
              })
            : null;

        const effectiveApprovedScope =
          result === 'partial_approved'
            ? latestAudit?.result === 'partial_approved'
              ? mergeApprovedScope(latestAudit.approved_scope, approved_scope)
              : normalizeApprovedScope(approved_scope)
            : normalizeApprovedScope(approved_scope);

        if (result === 'partial_approved' && !effectiveApprovedScope) {
          return { error: 'missing_scope' as const };
        }

        if (result === 'partial_approved' && effectiveApprovedScope) {
          const partialScope = findPartialApprovalScopeBlockers(
            effectiveSetBatches,
            effectiveApprovedScope,
          );
          if (partialScope.readyCount === 0 || partialScope.blockers.length > 0) {
            return {
              error: 'partial_scope_not_ready' as const,
              blockers: partialScope.blockers.map((batch) => ({
                batch_id: batch.id,
                set_state: batch.set_state,
                audit_state: batch.audit_state,
                ng_code: batch.ng_code ?? null,
              })),
            };
          }
        }

        if (result === 'approved') {
          const approvalBlockers = findSetAuditApprovalBlockers(effectiveSetBatches);
          if (approvalBlockers.length > 0) {
            return {
              error: 'approval_not_ready' as const,
              blockers: approvalBlockers.map((batch) => ({
                batch_id: batch.id,
                set_state: batch.set_state,
                audit_state: batch.audit_state,
                ng_code: batch.ng_code ?? null,
              })),
            };
          }
        }

        // セル単位監査の確定: SetBatch.audit_state / ng_code を先に OCC 更新する。
        // ここで競合した場合は cycle / visit / SetAudit に触らず 409 を返す。
        if (cell_audits && cell_audits.length > 0) {
          const batchById = new Map(setBatches.map((batch) => [batch.id, batch]));

          for (const cell of cell_audits) {
            const before = batchById.get(cell.batch_id);
            if (!before) continue; // 事前検証済み: 通常到達しない。
            const ngCode = cell.audit_state === 'ng' ? (cell.ng_code as RejectCode) : null;

            const updateResult = await tx.setBatch.updateMany({
              where: { id: cell.batch_id, org_id: ctx.orgId, version: before.version },
              data: {
                audit_state: cell.audit_state satisfies SetAuditCellState,
                ng_code: ngCode,
                audited_by: ctx.userId,
                audited_at: now,
                version: { increment: 1 },
              },
            });
            if (updateResult.count === 0) {
              throw new SetAuditRollback({ error: 'cell_version_conflict', conflict: true });
            }

            const after = {
              ...before,
              audit_state: cell.audit_state satisfies SetAuditCellState,
              ng_code: ngCode,
              audited_by: ctx.userId,
              audited_at: now,
              version: before.version + 1,
            };

            await createSetBatchChangeLog(tx, {
              orgId: ctx.orgId,
              planId: plan_id,
              batchId: cell.batch_id,
              action: 'cell_audit',
              triggerSource: 'set_audit',
              reason: ngCode ? `セルNG: ${ngCode}` : 'セルOK',
              lineIds: [before.line_id],
              beforeSnapshot: [buildSetBatchHistorySnapshot(before)],
              afterSnapshot: [buildSetBatchHistorySnapshot(after)],
              changedBy: ctx.userId,
            });

            await createAuditLogEntry(tx, ctx, {
              action: 'set_audit.cell',
              targetType: 'set_batch',
              targetId: cell.batch_id,
              changes: {
                plan_id,
                cycle_id: plan.cycle_id,
                line_id: before.line_id,
                day_number: before.day_number,
                slot: before.slot,
                audit_state: cell.audit_state,
                ng_code: ngCode,
              },
            });
          }
        }

        const transitionHelper = async (
          toStatus: string,
          options?: { exceptionStatus?: string | null },
        ) => {
          try {
            await transitionCycleStatus(
              tx,
              plan.cycle_id,
              ctx.orgId,
              toStatus,
              ctx.userId,
              options,
            );
          } catch (err) {
            if (err instanceof InvalidTransitionError) {
              return {
                error: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
              } as const;
            }
            if (err instanceof VersionConflictError) {
              return { error: err.message, conflict: true } as const;
            }
            throw err;
          }
          return null;
        };

        if (result === 'approved') {
          // carry_items confirmed — advance cycle to set_audited
          const carryItems = buildSetCarryItems(effectiveSetBatches);
          const carryItemsInput = toPrismaJsonInput(carryItems);
          const transitionErr = await transitionHelper('set_audited');
          if (transitionErr) throw new SetAuditRollback(transitionErr);
          await tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: {
                in: NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES,
              },
            },
            data: {
              carry_items: carryItemsInput,
              carry_items_status: 'ready',
            },
          });
          await tx.visitPreparation.updateMany({
            where: {
              org_id: ctx.orgId,
              schedule: {
                org_id: ctx.orgId,
                cycle_id: plan.cycle_id,
                schedule_status: 'ready',
              },
            },
            data: {
              carry_items_confirmed: false,
              prepared_at: null,
            },
          });
          await tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: 'ready',
            },
            data: {
              carry_items: carryItemsInput,
              carry_items_status: 'ready',
              schedule_status: 'in_preparation',
              pre_visit_checklist_completed: false,
            },
          });

          // B4: Auto-resolve open set_audit_rejected exceptions on approval
          await tx.workflowException.updateMany({
            where: {
              cycle_id: plan.cycle_id,
              exception_type: 'set_audit_rejected',
              status: 'open' satisfies ExceptionStatus,
            },
            data: {
              status: 'resolved' satisfies ExceptionStatus,
              resolved_by: ctx.userId,
              resolved_at: new Date(),
            },
          });
        } else if (result === 'partial_approved') {
          // Partial: carry_items_partial + re-work task
          const carryItems = buildSetCarryItems(effectiveSetBatches, effectiveApprovedScope);
          const carryItemsInput = toPrismaJsonInput(carryItems);
          const transitionErr = await transitionHelper('set_audited', {
            exceptionStatus: 'carry_items_partial',
          });
          if (transitionErr) throw new SetAuditRollback(transitionErr);
          await tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: {
                in: NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES,
              },
            },
            data: {
              carry_items: carryItemsInput,
              carry_items_status: 'partial',
            },
          });
          await tx.visitPreparation.updateMany({
            where: {
              org_id: ctx.orgId,
              schedule: {
                org_id: ctx.orgId,
                cycle_id: plan.cycle_id,
                schedule_status: 'ready',
              },
            },
            data: {
              carry_items_confirmed: false,
              prepared_at: null,
            },
          });
          await tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: 'ready',
            },
            data: {
              carry_items: carryItemsInput,
              carry_items_status: 'partial',
              schedule_status: 'in_preparation',
              pre_visit_checklist_completed: false,
            },
          });

          await tx.task.create({
            data: {
              org_id: ctx.orgId,
              title: 'セット再作業（部分承認）',
              description: `セット鑑査で部分承認となりました。承認範囲: ${
                effectiveApprovedScope ? JSON.stringify(effectiveApprovedScope) : '未指定'
              }`,
              status: 'pending',
              priority: 'high',
              related_entity_type: 'cycle',
              related_entity_id: plan.cycle_id,
            },
          });
        } else {
          // rejected — notify + WorkflowException + hold for rework.
          const transitionErr = await transitionHelper('on_hold');
          if (transitionErr) throw new SetAuditRollback(transitionErr);
          await tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: {
                in: NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES,
              },
            },
            data: {
              carry_items: [],
              carry_items_status: 'blocked',
            },
          });
          await tx.visitPreparation.updateMany({
            where: {
              org_id: ctx.orgId,
              schedule: {
                org_id: ctx.orgId,
                cycle_id: plan.cycle_id,
                schedule_status: 'ready',
              },
            },
            data: {
              carry_items_confirmed: false,
              prepared_at: null,
            },
          });
          await tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: 'ready',
            },
            data: {
              carry_items: [],
              carry_items_status: 'blocked',
              schedule_status: 'in_preparation',
              pre_visit_checklist_completed: false,
            },
          });

          await tx.workflowException.create({
            data: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              patient_id: plan.cycle?.patient_id ?? null,
              exception_type: 'set_audit_rejected',
              description: `セット鑑査差戻し: ${reject_reason ?? '理由未記入'}`,
              severity: 'warning' satisfies ExceptionSeverity,
              status: 'open' satisfies ExceptionStatus,
            },
          });
        }

        const audit = await tx.setAudit.create({
          data: {
            org_id: ctx.orgId,
            plan_id,
            result,
            approved_scope: effectiveApprovedScope
              ? toPrismaJsonInput(effectiveApprovedScope)
              : undefined,
            reject_reason: reject_reason ?? null,
            checklist: persistedChecklist ? toPrismaJsonInput(persistedChecklist) : undefined,
            photo_asset_ids: photo_asset_ids ?? [],
            audited_by: ctx.userId,
            audited_at: now,
            // D1=B: 自己監査の限定例外を満たした場合のみ理由 + 承認者を記録 (それ以外は NULL)。
            same_operator_reason: selfAuditDetected ? same_operator_reason : null,
            same_operator_approved_by: selfAuditApprovedBy,
          },
        });

        // 監査ログ(audit-by-default): セット鑑査の判定・チェックリスト・写真資産を記録。
        await createAuditLogEntry(tx, ctx, {
          action: 'set_audit.create',
          targetType: 'set_audit',
          targetId: audit.id,
          changes: {
            plan_id,
            cycle_id: plan.cycle_id,
            result,
            reject_reason: reject_reason ?? null,
            reject_reason_code: reject_reason_code ?? null,
            checklist: checklist ?? null,
            carry_packet_evidence_summary: carryPacketEvidenceSummary,
            photo_asset_ids: photo_asset_ids ?? [],
          },
        });

        // D1=B: 自己監査の限定例外を発動した場合は append-only で別途記録する。
        // two-person rule の例外行使を監査証跡で追跡可能にする (§12-5)。
        if (selfAuditDetected) {
          await createAuditLogEntry(tx, ctx, {
            action: 'set_audit.self_audit_exception',
            targetType: 'set_audit',
            targetId: audit.id,
            changes: {
              plan_id,
              cycle_id: plan.cycle_id,
              result,
              same_operator_reason: same_operator_reason ?? null,
              same_operator_approved_by: selfAuditApprovedBy,
            },
          });
        }

        return audit;
      },
      { requestContext: ctx },
    ).catch((err: unknown) => {
      if (err instanceof SetAuditRollback) return err.result;
      throw err;
    });

    if (!auditResult) return notFound('指定されたセットプランが見つかりません');
    if ('error' in auditResult) {
      if (auditResult.error === 'no_batches') {
        return validationError('セットバッチが存在しないプランは鑑査できません');
      }
      if (auditResult.error === 'missing_scope') {
        return validationError('部分承認時は承認済みスロットを1件以上指定してください');
      }
      if (auditResult.error === 'approval_not_ready') {
        return validationError('未セットまたは未監査のセルがあるため監査OKにはできません', {
          blockers: 'blockers' in auditResult ? auditResult.blockers : [],
        });
      }
      if (auditResult.error === 'partial_scope_not_ready') {
        return validationError('部分承認範囲に未セットまたは未監査のセルが含まれています', {
          blockers: 'blockers' in auditResult ? auditResult.blockers : [],
        });
      }
      if (auditResult.error === 'invalid_scope_keys') {
        return validationError('承認範囲のキーが実際のバッチと一致しません', {
          invalid_keys: 'keys' in auditResult ? auditResult.keys : [],
        });
      }
      if (auditResult.error === 'invalid_batch') {
        return validationError('指定されたセルが当該プランに存在しません', {
          batch_id: 'batchId' in auditResult ? auditResult.batchId : null,
        });
      }
      if (auditResult.error === 'invalid_carry_packet_evidence') {
        return validationError('その他薬同梱と訪問持出パケットの確認証跡が不正です', {
          reason: 'reason' in auditResult ? auditResult.reason : null,
        });
      }
      if (auditResult.error === 'invalid_photo_assets') {
        return validationError('セット監査写真が見つからないか、監査証跡に利用できません', {
          photo_asset_ids: 'photoAssetIds' in auditResult ? auditResult.photoAssetIds : [],
        });
      }
      if (auditResult.error === 'self_audit') {
        return validationError(
          'ご自身がセットしたセルの監査はできません。自己監査の例外には理由(same_operator_reason)の入力が必要です',
        );
      }
      if (auditResult.error === 'self_audit_not_approved') {
        return validationError('自己監査の例外承認は管理者のみ実行できます');
      }
      if (auditResult.error === 'cell_version_conflict') {
        return conflict('セルが他のユーザーによって更新されています。再読み込みしてください');
      }
      if (auditResult.error === 'already_audited') {
        return conflict('このセット監査は既に確定済みです');
      }
      if ('conflict' in auditResult && auditResult.conflict) return conflict(auditResult.error);
      return validationError(auditResult.error ?? 'セット監査に失敗しました');
    }

    if (isIdempotentSetAuditReplay(auditResult)) {
      return success(auditResult);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'set_audits', plan_id },
    });

    return success({ data: auditResult }, 201);
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('set_audits_post_unhandled_error', undefined, {
        event: 'set_audits_post_unhandled_error',
        route: ROUTE,
        method: 'POST',
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
