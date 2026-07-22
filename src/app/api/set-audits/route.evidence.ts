import { RejectCode, SetAuditCellState } from '@prisma/client';
import { z } from 'zod';
import {
  CARRY_PACKET_EVIDENCE_SCHEMA_VERSION,
  CARRY_PACKET_ITEM_KEYS,
  OUTSIDE_MED_EVIDENCE_KINDS,
  type CarryPacketItemKey,
  type OutsideMedEvidenceKind,
} from '@/lib/dispensing/set-audit-constants';
import { deriveOutsideMedEvidenceKind } from '@/lib/dispensing/outside-med-classification';

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

export const createSetAuditSchema = z.object({
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
  // Backward-compatible input only; self-audits remain denied until a distinct approver is ratified.
  same_operator_reason: z.string().trim().min(1).max(1000).optional(),
  // p0_15 セット監査 3ペイン: チェックリストと写真資産(セット前/セット後/設置予定)。
  checklist: checklistSchema,
  carry_packet_evidence: carryPacketEvidenceSchema.optional(),
  photo_asset_ids: z.array(z.string().min(1)).max(50).optional(),
  // 調剤ワークベンチ セル単位監査 (P0): SetBatch.audit_state / ng_code を確定する。
  cell_audits: z.array(cellAuditSchema).max(500).optional(),
});

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

export function normalizeApprovedScope(scope: unknown) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(scope).filter(([key, value]) => typeof key === 'string' && value === true),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function mergeApprovedScope(previousScope: unknown, currentScope?: Record<string, boolean>) {
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

export function validateCarryPacketEvidence(args: {
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

export function buildPersistedSetAuditChecklist(
  checklist: Record<string, boolean> | undefined,
  carryPacketEvidence: CarryPacketEvidence | null,
) {
  if (!checklist && !carryPacketEvidence) return undefined;
  return {
    ...(checklist ?? {}),
    ...(carryPacketEvidence ? { carry_packet_evidence: carryPacketEvidence } : {}),
  };
}

export async function findInvalidSetAuditPhotoAssetIds(
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

export function isIdempotentSetAuditReplay(value: unknown): value is IdempotentSetAuditReplay {
  return typeof value === 'object' && value !== null && 'idempotent' in value;
}

export function existingSetAuditMatchesApprovedReplay(args: {
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

export function cellAuditsAlreadyApplied(
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

export function buildSetCarryItems(
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

export function applyCellAuditPreview<
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

export function findSetAuditApprovalBlockers(
  batches: Array<{
    id: string;
    set_state: string;
    audit_state: string;
    ng_code?: RejectCode | null;
  }>,
) {
  return batches.filter((batch) => batch.set_state !== 'set' || batch.audit_state !== 'ok');
}

export function findPartialApprovalScopeBlockers(
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
export function summarizeCellStates(batches: Array<{ audit_state: SetAuditCellState }>) {
  const summary = { total: batches.length, unaudited: 0, ok: 0, ng: 0 };
  for (const batch of batches) {
    summary[batch.audit_state] += 1;
  }
  return summary;
}
