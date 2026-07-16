import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { allocateDisplayId } from '@/lib/db/display-id';
import { normalizeMedicationCode } from '@/lib/pharmacy/drug-identity-resolution';
import { buildPackageCodeCandidates, buildPackageLookupOr } from '@/lib/pharmacy/package-code';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { isMedicationStockItemWriteAllowed } from '../domain/medication-equivalence';
import { resolveConfirmedPrescriptionReplenishmentHorizon } from './prescription-replenishment-horizon';
import {
  decimalToNumber,
  recalculateMedicationStockSnapshot,
  type MedicationStockSnapshotItem,
} from './stock-snapshot';

export type PrescriptionSupplyReviewReason =
  | 'ambiguous_stock_item'
  | 'existing_stock_item_missing'
  | 'unresolved_drug_identity'
  | 'name_only_identity'
  | 'package_only_identity'
  | 'ambiguous_package_identity'
  | 'package_metadata_missing'
  | 'package_level_unsupported'
  | 'package_quantity_invalid'
  | 'unsupported_unit'
  | 'unit_conversion_required'
  | 'quantity_missing'
  | 'quantity_non_positive'
  | 'idempotency_fingerprint_conflict'
  | 'equivalence_review_pending';

export type PrescriptionSupplySkipReason =
  | 'non_stock_relevant_line'
  | 'missing_patient_or_case'
  | 'unsupported_route';

export type ApplyPrescriptionSupplyLineResult =
  | {
      kind: 'applied';
      prescription_line_id: string;
      stock_item_id: string;
      stock_event_id: string;
      snapshot: {
        current_quantity: number | null;
        stock_risk_level: 'ok' | 'watch' | 'shortage_expected' | 'urgent' | 'unknown';
        calculated_at: string;
      };
      idempotent_replay: boolean;
    }
  | {
      kind: 'review_required';
      prescription_line_id: string;
      reason_code: PrescriptionSupplyReviewReason;
      task_id: string;
      candidate_count: number;
    }
  | {
      kind: 'skipped';
      prescription_line_id: string;
      reason_code: PrescriptionSupplySkipReason;
    }
  | {
      kind: 'not_found';
      prescription_line_id: string;
      reason_code: 'intake_not_found' | 'prescription_line_not_found';
    };

export type ApplyPrescriptionSupplyForIntakeResult = {
  intake_id: string;
  applied_count: number;
  review_required_count: number;
  skipped_count: number;
  results: ApplyPrescriptionSupplyLineResult[];
};

export type ApplyPrescriptionSupplyDb = Pick<
  Prisma.TransactionClient,
  | 'drugMaster'
  | 'drugPackage'
  | 'medicationStockEvent'
  | 'medicationStockSnapshot'
  | 'patientMedicationStockItem'
  | 'prescriptionIntake'
  | 'task'
>;

type PrescriptionSupplyLineRow = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  drug_master_id: string | null;
  source_drug_code: string | null;
  source_drug_code_type: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  route: string | null;
};

type PrescriptionSupplyIntakeRow = {
  id: string;
  source_type: string;
  prescribed_date: Date;
  refill_next_dispense_date: Date | null;
  split_dispense_total: number | null;
  split_dispense_current: number | null;
  split_next_dispense_date: Date | null;
  cycle: {
    id: string;
    patient_id: string;
    case_id: string | null;
  };
  lines: PrescriptionSupplyLineRow[];
};

type DrugMasterIdentityRow = {
  id: string;
  yj_code: string;
  receipt_code: string | null;
  hot_code: string | null;
  jan_code: string | null;
  drug_name: string;
  generic_name: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
};

type StockItemRow = MedicationStockSnapshotItem & {
  drug_master_id: string | null;
  drug_package_id: string | null;
  source_type: string;
  unit: string;
  equivalence_review_status: string;
};

type DrugPackageIdentityRow = {
  id: string;
  drug_master_id: string;
  gtin: string;
  jan_code: string | null;
  package_level: string | null;
  package_quantity: Prisma.Decimal | null;
  package_quantity_unit: string | null;
};

type DrugPackageIndexes = Map<string, DrugPackageIdentityRow[]>;

type ResolvedPrescriptionSupplyTarget =
  | {
      ok: true;
      quantity: number;
      unit: string;
      drugMasterId: string;
      drugPackage: DrugPackageIdentityRow | null;
      unitSupported: true;
      quantityPresent: true;
    }
  | {
      ok: false;
      reasonCode: PrescriptionSupplyReviewReason;
      candidateCount: number;
      unitSupported: boolean;
      quantityPresent: boolean;
    };

export type PrescriptionSupplyReviewPreview =
  | {
      kind: 'not_found';
      reason_code: 'intake_not_found' | 'prescription_line_not_found';
    }
  | {
      kind: 'blocked';
      reason_code: PrescriptionSupplyReviewReason | PrescriptionSupplySkipReason;
      line: PrescriptionSupplyReviewLine;
    }
  | {
      kind: 'reviewable';
      line: PrescriptionSupplyReviewLine;
      normalized_supply: { quantity: number; unit: string };
      candidates: PrescriptionSupplyReviewCandidate[];
    };

export type PrescriptionSupplyReviewLine = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  route: string | null;
};

export type PrescriptionSupplyReviewCandidate = {
  id: string;
  display_id: string | null;
  display_name: string;
  case_id: string | null;
  unit: string;
  dosage_form: string | null;
  route: string | null;
  equivalence_review_status: string;
  applicable: boolean;
  current_quantity: number | null;
  snapshot_calculated_at: string | null;
};

type DrugMasterIndexes = {
  byId: Map<string, DrugMasterIdentityRow>;
  byYj: Map<string, DrugMasterIdentityRow[]>;
  byReceipt: Map<string, DrugMasterIdentityRow[]>;
  byHot: Map<string, DrugMasterIdentityRow[]>;
};

const PRESCRIPTION_SUPPLY_REVIEW_TASK_TYPE =
  'pharmacy.medication_stock_unlinked_prescription_supply';

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  return normalized ? normalized : null;
}

function normalizeSourceCodeType(value: string | null | undefined) {
  const normalized = normalizeText(value)?.replace(/[\s_-]+/g, '');
  if (!normalized) return null;
  if (['yj', 'yjcode', 'drugcode'].includes(normalized)) return 'yj';
  if (['receipt', 'receiptcode', 'receiptdrugcode', 'レセ電', 'レセプト'].includes(normalized)) {
    return 'receipt';
  }
  if (['hot', 'hotcode'].includes(normalized)) return 'hot';
  if (['jan', 'jancode', 'gs1', 'gtin', 'gsi'].includes(normalized)) return 'package';
  return normalized;
}

function appendIndex(
  index: Map<string, DrugMasterIdentityRow[]>,
  code: string | null,
  row: DrugMasterIdentityRow,
) {
  const normalized = normalizeMedicationCode(code);
  if (!normalized) return;
  const rows = index.get(normalized) ?? [];
  rows.push(row);
  index.set(normalized, rows);
}

function buildDrugMasterIndexes(rows: DrugMasterIdentityRow[]): DrugMasterIndexes {
  const indexes: DrugMasterIndexes = {
    byId: new Map(),
    byYj: new Map(),
    byReceipt: new Map(),
    byHot: new Map(),
  };
  for (const row of rows) {
    indexes.byId.set(row.id, row);
    appendIndex(indexes.byYj, row.yj_code, row);
    appendIndex(indexes.byReceipt, row.receipt_code, row);
    appendIndex(indexes.byHot, row.hot_code, row);
  }
  return indexes;
}

function uniqueCandidate(rows: DrugMasterIdentityRow[] | undefined) {
  if (!rows || rows.length !== 1) return null;
  return rows[0];
}

function resolveLineDrugMaster(line: PrescriptionSupplyLineRow, indexes: DrugMasterIndexes) {
  if (line.drug_master_id) {
    return indexes.byId.get(line.drug_master_id) ?? null;
  }

  const yjCode = normalizeMedicationCode(line.drug_code);
  if (yjCode) {
    const yjCandidate = uniqueCandidate(indexes.byYj.get(yjCode));
    if (yjCandidate) return yjCandidate;
  }

  const sourceType = normalizeSourceCodeType(line.source_drug_code_type);
  const sourceCode = normalizeMedicationCode(line.source_drug_code);
  if (!sourceCode) return null;
  if (sourceType === 'yj') return uniqueCandidate(indexes.byYj.get(sourceCode));
  if (sourceType === 'receipt') return uniqueCandidate(indexes.byReceipt.get(sourceCode));
  if (sourceType === 'hot') return uniqueCandidate(indexes.byHot.get(sourceCode));
  return null;
}

function isPackageOnlyIdentity(line: PrescriptionSupplyLineRow) {
  return normalizeSourceCodeType(line.source_drug_code_type) === 'package';
}

function isLikelyPrnLine(line: PrescriptionSupplyLineRow) {
  const text = normalizeText(
    [line.frequency, line.dose, line.dosage_form].filter(Boolean).join(' '),
  );
  if (!text) return false;
  return /頓服|必要時|疼痛時|発熱時|不眠時|prn|asneeded/.test(text.replace(/\s+/g, ''));
}

function isLikelyExternalLine(line: PrescriptionSupplyLineRow) {
  if (line.route === 'external') return true;
  const text = normalizeText(
    [line.dosage_form, line.drug_name, line.unit].filter(Boolean).join(' '),
  );
  if (!text) return false;
  return /外用|貼付|湿布|軟膏|クリーム|ゲル|ローション|点眼|点鼻|吸入|坐剤|坐薬|塗布|パッチ/.test(
    text,
  );
}

function isStockRelevantLine(line: PrescriptionSupplyLineRow) {
  return isLikelyExternalLine(line) || isLikelyPrnLine(line);
}

function normalizeMedicationStockUnit(
  value: string | null | undefined,
  line: Pick<PrescriptionSupplyLineRow, 'dosage_form' | 'drug_name'>,
) {
  const raw = normalizeText(value)?.replace(/\s+/g, '');
  if (!raw) return null;
  if (['錠', 'tablet', 'tablets', 'tab'].includes(raw)) return 'tablet';
  if (['カプセル', 'capsule', 'capsules', 'cap'].includes(raw)) return 'capsule';
  if (['包', '袋', 'packet', 'packets', '包分'].includes(raw)) return 'packet';
  if (['枚', 'シート', 'sheet', 'sheets'].includes(raw)) return 'sheet';
  if (['貼', 'パッチ', 'patch', 'patches'].includes(raw)) return 'patch';
  if (['ml', 'ｍｌ', 'ミリリットル'].includes(raw)) return 'ml';
  if (['g', 'ｇ', 'グラム'].includes(raw)) return 'g';
  if (['回', '回分', 'dose', 'doses'].includes(raw)) return 'dose';
  if (['瓶', 'ボトル', 'bottle', 'bottles'].includes(raw)) return 'bottle';
  if (['本', 'tube', 'tubes'].includes(raw)) {
    const text = normalizeText([line.dosage_form, line.drug_name].filter(Boolean).join(' '));
    return text && /軟膏|クリーム|ゲル|ローション|塗布/.test(text) ? 'tube' : 'bottle';
  }
  if (['個', '個分', 'other'].includes(raw)) return 'other';
  return null;
}

function normalizePrescriptionSupplyUnit(line: PrescriptionSupplyLineRow) {
  return normalizeMedicationStockUnit(line.unit, line);
}

function isSalesPackageCountUnit(value: string | null | undefined) {
  const raw = normalizeText(value)?.replace(/\s+/g, '');
  return (
    raw != null && ['箱', '販売包装', 'box', 'boxes', 'package', 'packages', 'pkg'].includes(raw)
  );
}

function buildSupplyEventIdempotencyKeyHash(args: { orgId: string; prescriptionLineId: string }) {
  return `medication-stock-prescription-supply:v1:${sha256Hex(
    stableStringify({
      org_id: args.orgId,
      prescription_line_id: args.prescriptionLineId,
    }),
  )}`;
}

function buildSupplyRequestFingerprint(args: {
  prescriptionLineId: string;
  stockItemId: string;
  drugMasterId: string | null;
  drugCode: string | null;
  quantity: number;
  unit: string;
  drugPackageId?: string;
}) {
  return `medication-stock-prescription-supply-request:v1:${sha256Hex(
    stableStringify({
      prescription_line_id: args.prescriptionLineId,
      stock_item_id: args.stockItemId,
      drug_master_id: args.drugMasterId,
      drug_code: args.drugCode,
      quantity: args.quantity,
      unit: args.unit,
      event_type: 'prescription_supply',
      ...(args.drugPackageId ? { drug_package_id: args.drugPackageId } : {}),
    }),
  )}`;
}

function reviewTaskDedupeKey(lineId: string) {
  return `medication-stock-prescription-supply:${lineId}:review`;
}

function evidenceAxes(input: {
  line: PrescriptionSupplyLineRow;
  unitSupported: boolean;
  quantityPresent: boolean;
}) {
  const sourceType = normalizeSourceCodeType(input.line.source_drug_code_type);
  return {
    has_drug_master_id: Boolean(input.line.drug_master_id),
    has_yj_code: Boolean(normalizeMedicationCode(input.line.drug_code)),
    has_hot_or_receipt: sourceType === 'hot' || sourceType === 'receipt',
    has_package_evidence: sourceType === 'package',
    has_name_only_evidence: Boolean(
      normalizeText(input.line.drug_name) && !input.line.drug_master_id && !input.line.drug_code,
    ),
    unit_supported: input.unitSupported,
    quantity_present: input.quantityPresent,
  };
}

async function createReviewTask(args: {
  db: ApplyPrescriptionSupplyDb;
  orgId: string;
  userId: string;
  intake: PrescriptionSupplyIntakeRow;
  line: PrescriptionSupplyLineRow;
  reasonCode: PrescriptionSupplyReviewReason;
  candidateCount: number;
  unitSupported: boolean;
  quantityPresent: boolean;
}) {
  const task = (await upsertOperationalTask(args.db, {
    orgId: args.orgId,
    taskType: PRESCRIPTION_SUPPLY_REVIEW_TASK_TYPE,
    title: '処方供給の残数台帳紐づけ確認',
    description: '処方供給量を外用薬・頓服薬残数台帳へ紐づけてください。',
    priority: 'high',
    assignedTo: args.userId,
    dedupeKey: reviewTaskDedupeKey(args.line.id),
    relatedEntityType: 'prescription_line',
    relatedEntityId: args.line.id,
    metadata: {
      prescription_line_id: args.line.id,
      prescription_intake_id: args.intake.id,
      cycle_id: args.intake.cycle.id,
      case_id: args.intake.cycle.case_id,
      reason_code: args.reasonCode,
      candidate_count: args.candidateCount,
      evidence_axes: evidenceAxes({
        line: args.line,
        unitSupported: args.unitSupported,
        quantityPresent: args.quantityPresent,
      }),
    },
  })) as { id: string };

  return {
    kind: 'review_required',
    prescription_line_id: args.line.id,
    reason_code: args.reasonCode,
    task_id: task.id,
    candidate_count: args.candidateCount,
  } satisfies ApplyPrescriptionSupplyLineResult;
}

async function loadPrescriptionSupplyIntake(
  db: ApplyPrescriptionSupplyDb,
  args: { orgId: string; intakeId: string; patientId?: string | null },
) {
  return (await db.prescriptionIntake.findFirst({
    where: {
      id: args.intakeId,
      org_id: args.orgId,
      ...(args.patientId ? { cycle: { patient_id: args.patientId } } : {}),
    },
    select: {
      id: true,
      source_type: true,
      prescribed_date: true,
      refill_next_dispense_date: true,
      split_dispense_total: true,
      split_dispense_current: true,
      split_next_dispense_date: true,
      cycle: {
        select: {
          id: true,
          patient_id: true,
          case_id: true,
        },
      },
      lines: {
        select: {
          id: true,
          drug_name: true,
          drug_code: true,
          drug_master_id: true,
          source_drug_code: true,
          source_drug_code_type: true,
          dosage_form: true,
          dose: true,
          frequency: true,
          days: true,
          quantity: true,
          unit: true,
          route: true,
        },
        orderBy: [{ line_number: 'asc' }, { id: 'asc' }],
      },
    },
  })) as PrescriptionSupplyIntakeRow | null;
}

async function loadDrugMasterIndexes(
  db: ApplyPrescriptionSupplyDb,
  lines: PrescriptionSupplyLineRow[],
) {
  const drugMasterIds = new Set<string>();
  const yjCodes = new Set<string>();
  const receiptCodes = new Set<string>();
  const hotCodes = new Set<string>();

  for (const line of lines) {
    if (line.drug_master_id) drugMasterIds.add(line.drug_master_id);
    const yjCode = normalizeMedicationCode(line.drug_code);
    if (yjCode) yjCodes.add(yjCode);

    const sourceType = normalizeSourceCodeType(line.source_drug_code_type);
    const sourceCode = normalizeMedicationCode(line.source_drug_code);
    if (!sourceCode) continue;
    if (sourceType === 'yj') yjCodes.add(sourceCode);
    if (sourceType === 'receipt') receiptCodes.add(sourceCode);
    if (sourceType === 'hot') hotCodes.add(sourceCode);
  }

  const where: Prisma.DrugMasterWhereInput[] = [];
  if (drugMasterIds.size > 0) where.push({ id: { in: [...drugMasterIds] } });
  if (yjCodes.size > 0) where.push({ yj_code: { in: [...yjCodes] } });
  if (receiptCodes.size > 0) where.push({ receipt_code: { in: [...receiptCodes] } });
  if (hotCodes.size > 0) where.push({ hot_code: { in: [...hotCodes] } });

  if (where.length === 0) return buildDrugMasterIndexes([]);

  const rows = (await db.drugMaster.findMany({
    where: { OR: where },
    select: {
      id: true,
      yj_code: true,
      receipt_code: true,
      hot_code: true,
      jan_code: true,
      drug_name: true,
      generic_name: true,
      dosage_form: true,
      manufacturer: true,
    },
  })) as DrugMasterIdentityRow[];

  return buildDrugMasterIndexes(rows);
}

function appendPackageIndex(
  index: DrugPackageIndexes,
  code: string | null,
  row: DrugPackageIdentityRow,
) {
  for (const candidate of buildPackageCodeCandidates(code)) {
    const rows = index.get(candidate) ?? [];
    if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
    index.set(candidate, rows);
  }
}

async function loadDrugPackageIndexes(
  db: ApplyPrescriptionSupplyDb,
  lines: PrescriptionSupplyLineRow[],
  prescribedDate: Date,
) {
  const lookupOr = lines
    .filter(isPackageOnlyIdentity)
    .flatMap((line) => buildPackageLookupOr(line.source_drug_code));
  const uniqueLookupOr = [
    ...new Map(lookupOr.map((condition) => [stableStringify(condition), condition])).values(),
  ];
  if (uniqueLookupOr.length === 0) return new Map() as DrugPackageIndexes;

  const rows = (await db.drugPackage.findMany({
    where: {
      is_active: true,
      AND: [
        { OR: uniqueLookupOr },
        { OR: [{ effective_from: null }, { effective_from: { lte: prescribedDate } }] },
        { OR: [{ effective_to: null }, { effective_to: { gte: prescribedDate } }] },
      ],
    },
    select: {
      id: true,
      drug_master_id: true,
      gtin: true,
      jan_code: true,
      package_level: true,
      package_quantity: true,
      package_quantity_unit: true,
    },
  })) as DrugPackageIdentityRow[];

  const indexes: DrugPackageIndexes = new Map();
  for (const row of rows) {
    appendPackageIndex(indexes, row.gtin, row);
    appendPackageIndex(indexes, row.jan_code, row);
  }
  return indexes;
}

function resolveLineDrugPackage(line: PrescriptionSupplyLineRow, indexes: DrugPackageIndexes) {
  const matches = new Map<string, DrugPackageIdentityRow>();
  for (const code of buildPackageCodeCandidates(line.source_drug_code)) {
    for (const row of indexes.get(code) ?? []) matches.set(row.id, row);
  }
  return [...matches.values()];
}

function convertPackageSupplyQuantity(args: {
  line: PrescriptionSupplyLineRow;
  packageRow: DrugPackageIdentityRow;
  quantity: number;
}):
  | { ok: true; quantity: number; unit: string }
  | {
      ok: false;
      reasonCode:
        | 'package_metadata_missing'
        | 'package_level_unsupported'
        | 'package_quantity_invalid'
        | 'unsupported_unit';
    } {
  if (args.packageRow.package_level !== 'sales') {
    return { ok: false, reasonCode: 'package_level_unsupported' };
  }
  if (!args.packageRow.package_quantity || !args.packageRow.package_quantity_unit) {
    return { ok: false, reasonCode: 'package_metadata_missing' };
  }

  const packageUnit = normalizeMedicationStockUnit(
    args.packageRow.package_quantity_unit,
    args.line,
  );
  if (!packageUnit) return { ok: false, reasonCode: 'package_metadata_missing' };

  const lineUnit = normalizePrescriptionSupplyUnit(args.line);
  const sourceQuantity = new Prisma.Decimal(args.quantity);
  const converted =
    lineUnit === packageUnit
      ? sourceQuantity
      : isSalesPackageCountUnit(args.line.unit)
        ? sourceQuantity.mul(args.packageRow.package_quantity)
        : null;
  if (!converted) return { ok: false, reasonCode: 'unsupported_unit' };
  if (
    !converted.isFinite() ||
    converted.lessThanOrEqualTo(0) ||
    converted.decimalPlaces() > 4 ||
    converted.greaterThan('99999999.9999')
  ) {
    return { ok: false, reasonCode: 'package_quantity_invalid' };
  }
  return { ok: true, quantity: converted.toNumber(), unit: packageUnit };
}

function resolvePrescriptionSupplyTarget(args: {
  line: PrescriptionSupplyLineRow;
  drugMasters: DrugMasterIndexes;
  drugPackages: DrugPackageIndexes;
}): ResolvedPrescriptionSupplyTarget {
  const parsedQuantity = readSupplyQuantity(args.line);
  let unit = normalizePrescriptionSupplyUnit(args.line);
  const quantityPresent = parsedQuantity != null;
  let unitSupported = unit != null || isSalesPackageCountUnit(args.line.unit);

  if (parsedQuantity == null) {
    return {
      ok: false,
      reasonCode: 'quantity_missing',
      candidateCount: 0,
      unitSupported,
      quantityPresent,
    };
  }
  if (parsedQuantity <= 0) {
    return {
      ok: false,
      reasonCode: 'quantity_non_positive',
      candidateCount: 0,
      unitSupported,
      quantityPresent,
    };
  }

  let quantity = parsedQuantity;
  let drugPackage: DrugPackageIdentityRow | null = null;
  let drugMasterId: string | null = null;
  if (isPackageOnlyIdentity(args.line)) {
    const packageCandidates = resolveLineDrugPackage(args.line, args.drugPackages);
    if (packageCandidates.length !== 1) {
      return {
        ok: false,
        reasonCode:
          packageCandidates.length > 1 ? 'ambiguous_package_identity' : 'package_only_identity',
        candidateCount: packageCandidates.length,
        unitSupported,
        quantityPresent,
      };
    }
    drugPackage = packageCandidates[0];
    const conversion = convertPackageSupplyQuantity({
      line: args.line,
      packageRow: drugPackage,
      quantity,
    });
    if (!conversion.ok) {
      return {
        ok: false,
        reasonCode: conversion.reasonCode,
        candidateCount: 1,
        unitSupported,
        quantityPresent,
      };
    }
    quantity = conversion.quantity;
    unit = conversion.unit;
    unitSupported = true;
    drugMasterId = drugPackage.drug_master_id;
  } else {
    if (!unitSupported || !unit) {
      return {
        ok: false,
        reasonCode: 'unsupported_unit',
        candidateCount: 0,
        unitSupported,
        quantityPresent,
      };
    }
    drugMasterId = resolveLineDrugMaster(args.line, args.drugMasters)?.id ?? null;
  }

  if (!drugMasterId || !unit) {
    return {
      ok: false,
      reasonCode: normalizeText(args.line.drug_name)
        ? 'name_only_identity'
        : 'unresolved_drug_identity',
      candidateCount: 0,
      unitSupported,
      quantityPresent,
    };
  }

  return {
    ok: true,
    quantity,
    unit,
    drugMasterId,
    drugPackage,
    unitSupported: true,
    quantityPresent: true,
  };
}

async function findExactStockItemCandidates(args: {
  db: ApplyPrescriptionSupplyDb;
  orgId: string;
  patientId: string;
  caseId: string | null;
  drugMasterId: string;
  drugPackageId?: string;
  stockItemId?: string;
}) {
  return (await args.db.patientMedicationStockItem.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      active: true,
      ...(args.stockItemId ? { id: args.stockItemId } : {}),
      drug_master_id: args.drugMasterId,
      ...(args.drugPackageId ? { drug_package_id: args.drugPackageId } : {}),
      ...(args.caseId ? { OR: [{ case_id: args.caseId }, { case_id: null }] } : { case_id: null }),
    },
    orderBy: [{ case_id: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      drug_master_id: true,
      drug_package_id: true,
      source_type: true,
      unit: true,
      default_usage_amount_per_day: true,
      medication_category: true,
      equivalence_review_status: true,
    },
  })) as StockItemRow[];
}

function readSupplyQuantity(line: PrescriptionSupplyLineRow) {
  if (line.quantity == null) return null;
  const quantity = Number(line.quantity);
  return Number.isFinite(quantity) ? quantity : null;
}

async function returnExistingApplication(args: {
  db: ApplyPrescriptionSupplyDb;
  orgId: string;
  userId: string;
  intake: PrescriptionSupplyIntakeRow;
  line: PrescriptionSupplyLineRow;
  stockItem: StockItemRow;
  event: { id: string; request_fingerprint_hash: string };
  requestFingerprintHash: string;
  now: Date;
  unitSupported: boolean;
  quantityPresent: boolean;
}): Promise<ApplyPrescriptionSupplyLineResult> {
  if (args.event.request_fingerprint_hash !== args.requestFingerprintHash) {
    return createReviewTask({
      db: args.db,
      orgId: args.orgId,
      userId: args.userId,
      intake: args.intake,
      line: args.line,
      reasonCode: 'idempotency_fingerprint_conflict',
      candidateCount: 1,
      unitSupported: args.unitSupported,
      quantityPresent: args.quantityPresent,
    });
  }

  const snapshot = await args.db.medicationStockSnapshot.findFirst({
    where: {
      org_id: args.orgId,
      stock_item_id: args.stockItem.id,
    },
    select: {
      current_quantity: true,
      stock_risk_level: true,
      calculated_at: true,
    },
  });

  return {
    kind: 'applied',
    prescription_line_id: args.line.id,
    stock_item_id: args.stockItem.id,
    stock_event_id: args.event.id,
    snapshot: {
      current_quantity: decimalToNumber(snapshot?.current_quantity),
      stock_risk_level: snapshot?.stock_risk_level ?? 'unknown',
      calculated_at: snapshot?.calculated_at.toISOString() ?? args.now.toISOString(),
    },
    idempotent_replay: true,
  };
}

async function applyPrescriptionSupplyLine(args: {
  db: ApplyPrescriptionSupplyDb;
  orgId: string;
  userId: string;
  intake: PrescriptionSupplyIntakeRow;
  line: PrescriptionSupplyLineRow;
  drugMasters: DrugMasterIndexes;
  drugPackages: DrugPackageIndexes;
  selectedStockItemId?: string;
  now: Date;
}): Promise<ApplyPrescriptionSupplyLineResult> {
  if (!args.intake.cycle.patient_id) {
    return {
      kind: 'skipped',
      prescription_line_id: args.line.id,
      reason_code: 'missing_patient_or_case',
    };
  }
  if (!isStockRelevantLine(args.line)) {
    return {
      kind: 'skipped',
      prescription_line_id: args.line.id,
      reason_code: 'non_stock_relevant_line',
    };
  }

  const target = resolvePrescriptionSupplyTarget(args);
  if (!target.ok) {
    return createReviewTask({
      ...args,
      reasonCode: target.reasonCode,
      candidateCount: target.candidateCount,
      unitSupported: target.unitSupported,
      quantityPresent: target.quantityPresent,
    });
  }

  const { drugMasterId, drugPackage, quantity, unit, unitSupported, quantityPresent } = target;

  const candidates = await findExactStockItemCandidates({
    db: args.db,
    orgId: args.orgId,
    patientId: args.intake.cycle.patient_id,
    caseId: args.intake.cycle.case_id,
    drugMasterId,
    ...(drugPackage ? { drugPackageId: drugPackage.id } : {}),
    ...(args.selectedStockItemId ? { stockItemId: args.selectedStockItemId } : {}),
  });
  if (candidates.length === 0) {
    return createReviewTask({
      ...args,
      reasonCode: 'existing_stock_item_missing',
      candidateCount: 0,
      unitSupported,
      quantityPresent,
    });
  }
  if (candidates.length > 1) {
    return createReviewTask({
      ...args,
      reasonCode: 'ambiguous_stock_item',
      candidateCount: candidates.length,
      unitSupported,
      quantityPresent,
    });
  }

  const stockItem = candidates[0];
  if (stockItem.unit !== unit) {
    return createReviewTask({
      ...args,
      reasonCode: 'unit_conversion_required',
      candidateCount: 1,
      unitSupported,
      quantityPresent,
    });
  }

  const idempotencyKeyHash = buildSupplyEventIdempotencyKeyHash({
    orgId: args.orgId,
    prescriptionLineId: args.line.id,
  });
  const requestFingerprintHash = buildSupplyRequestFingerprint({
    prescriptionLineId: args.line.id,
    stockItemId: stockItem.id,
    drugMasterId,
    drugCode: normalizeMedicationCode(args.line.drug_code),
    quantity,
    unit,
    ...(drugPackage ? { drugPackageId: drugPackage.id } : {}),
  });
  const existingEvent = await args.db.medicationStockEvent.findFirst({
    where: {
      org_id: args.orgId,
      idempotency_key_hash: idempotencyKeyHash,
    },
    select: {
      id: true,
      stock_item_id: true,
      request_fingerprint_hash: true,
    },
  });
  if (existingEvent) {
    if (existingEvent.stock_item_id !== stockItem.id) {
      return createReviewTask({
        ...args,
        reasonCode: 'idempotency_fingerprint_conflict',
        candidateCount: 1,
        unitSupported,
        quantityPresent,
      });
    }
    return returnExistingApplication({
      db: args.db,
      orgId: args.orgId,
      userId: args.userId,
      intake: args.intake,
      line: args.line,
      stockItem,
      event: existingEvent,
      requestFingerprintHash,
      now: args.now,
      unitSupported,
      quantityPresent,
    });
  }

  if (!isMedicationStockItemWriteAllowed(stockItem.equivalence_review_status)) {
    return createReviewTask({
      ...args,
      reasonCode: 'equivalence_review_pending',
      candidateCount: 1,
      unitSupported,
      quantityPresent,
    });
  }

  const stockEvent = await args.db.medicationStockEvent.create({
    data: {
      org_id: args.orgId,
      display_id: await allocateDisplayId(
        args.db as Prisma.TransactionClient,
        'MedicationStockEvent',
        args.orgId,
      ),
      patient_id: args.intake.cycle.patient_id,
      case_id: stockItem.case_id ?? args.intake.cycle.case_id,
      stock_item_id: stockItem.id,
      event_type: 'prescription_supply',
      event_at: args.intake.prescribed_date,
      recorded_at: args.now,
      recorded_by: args.userId,
      quantity_kind: 'delta',
      quantity_delta: new Prisma.Decimal(quantity),
      observed_quantity: null,
      usage_quantity: null,
      usage_period_days: null,
      unit: unit as never,
      source_entity_type: 'prescription_line',
      source_entity_id: args.line.id,
      source_signal_id: null,
      external_observation_id: null,
      idempotency_key_hash: idempotencyKeyHash,
      request_fingerprint_hash: requestFingerprintHash,
    },
    select: {
      id: true,
    },
  });
  const replenishmentHorizon = resolveConfirmedPrescriptionReplenishmentHorizon({
    intake: args.intake,
    stockItem,
    asOf: args.now,
  });
  const snapshot = await recalculateMedicationStockSnapshot({
    db: args.db,
    orgId: args.orgId,
    stockItem,
    eventId: stockEvent.id,
    asOf: args.now,
    confirmedReplenishmentDateKey: replenishmentHorizon?.dateKey ?? null,
  });

  return {
    kind: 'applied',
    prescription_line_id: args.line.id,
    stock_item_id: stockItem.id,
    stock_event_id: stockEvent.id,
    snapshot,
    idempotent_replay: false,
  };
}

function toPrescriptionSupplyReviewLine(
  line: PrescriptionSupplyLineRow,
): PrescriptionSupplyReviewLine {
  return {
    id: line.id,
    drug_name: line.drug_name,
    drug_code: line.drug_code,
    dosage_form: line.dosage_form,
    dose: line.dose,
    frequency: line.frequency,
    days: line.days,
    quantity: line.quantity,
    unit: line.unit,
    route: line.route,
  };
}

export async function previewPrescriptionSupplyReview(
  db: ApplyPrescriptionSupplyDb,
  args: {
    orgId: string;
    intakeId: string;
    patientId: string;
    prescriptionLineId: string;
  },
): Promise<PrescriptionSupplyReviewPreview> {
  const intake = await loadPrescriptionSupplyIntake(db, args);
  if (!intake) return { kind: 'not_found', reason_code: 'intake_not_found' };

  const line = intake.lines.find((candidate) => candidate.id === args.prescriptionLineId);
  if (!line) return { kind: 'not_found', reason_code: 'prescription_line_not_found' };

  const reviewLine = toPrescriptionSupplyReviewLine(line);
  if (!isStockRelevantLine(line)) {
    return { kind: 'blocked', reason_code: 'non_stock_relevant_line', line: reviewLine };
  }

  const drugMasters = await loadDrugMasterIndexes(db, [line]);
  const drugPackages = await loadDrugPackageIndexes(db, [line], intake.prescribed_date);
  const target = resolvePrescriptionSupplyTarget({ line, drugMasters, drugPackages });
  if (!target.ok) {
    return { kind: 'blocked', reason_code: target.reasonCode, line: reviewLine };
  }

  const matchingItems = await findExactStockItemCandidates({
    db,
    orgId: args.orgId,
    patientId: args.patientId,
    caseId: intake.cycle.case_id,
    drugMasterId: target.drugMasterId,
    ...(target.drugPackage ? { drugPackageId: target.drugPackage.id } : {}),
  });
  const itemIds = matchingItems.map((item) => item.id);
  if (itemIds.length === 0) {
    return {
      kind: 'reviewable',
      line: reviewLine,
      normalized_supply: { quantity: target.quantity, unit: target.unit },
      candidates: [],
    };
  }

  const [items, snapshots] = await Promise.all([
    db.patientMedicationStockItem.findMany({
      where: { org_id: args.orgId, id: { in: itemIds } },
      orderBy: [{ case_id: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        display_id: true,
        display_name: true,
        case_id: true,
        unit: true,
        dosage_form: true,
        route: true,
        equivalence_review_status: true,
      },
    }),
    db.medicationStockSnapshot.findMany({
      where: { org_id: args.orgId, stock_item_id: { in: itemIds } },
      select: {
        stock_item_id: true,
        current_quantity: true,
        unit: true,
        calculated_at: true,
      },
    }),
  ]);
  const snapshotByItemId = new Map(snapshots.map((snapshot) => [snapshot.stock_item_id, snapshot]));

  return {
    kind: 'reviewable',
    line: reviewLine,
    normalized_supply: { quantity: target.quantity, unit: target.unit },
    candidates: items.map((item) => {
      const snapshot = snapshotByItemId.get(item.id);
      const applicable =
        item.unit === target.unit &&
        isMedicationStockItemWriteAllowed(item.equivalence_review_status);
      return {
        id: item.id,
        display_id: item.display_id,
        display_name: item.display_name,
        case_id: item.case_id,
        unit: item.unit,
        dosage_form: item.dosage_form,
        route: item.route,
        equivalence_review_status: item.equivalence_review_status,
        applicable,
        current_quantity:
          snapshot?.unit === item.unit ? decimalToNumber(snapshot.current_quantity) : null,
        snapshot_calculated_at: snapshot?.calculated_at.toISOString() ?? null,
      };
    }),
  };
}

export async function applyPrescriptionSupplyForIntake(
  db: ApplyPrescriptionSupplyDb,
  args: {
    orgId: string;
    userId: string;
    intakeId: string;
    patientId?: string | null;
    reviewSelection?: {
      prescriptionLineId: string;
      stockItemId: string;
    };
  },
): Promise<ApplyPrescriptionSupplyForIntakeResult> {
  const intake = await loadPrescriptionSupplyIntake(db, args);
  if (!intake) {
    return {
      intake_id: args.intakeId,
      applied_count: 0,
      review_required_count: 0,
      skipped_count: 0,
      results: [
        {
          kind: 'not_found',
          prescription_line_id: 'unknown',
          reason_code: 'intake_not_found',
        },
      ],
    };
  }

  const targetLines = args.reviewSelection
    ? intake.lines.filter((line) => line.id === args.reviewSelection?.prescriptionLineId)
    : intake.lines;
  if (args.reviewSelection && targetLines.length !== 1) {
    return {
      intake_id: intake.id,
      applied_count: 0,
      review_required_count: 0,
      skipped_count: 0,
      results: [
        {
          kind: 'not_found',
          prescription_line_id: args.reviewSelection.prescriptionLineId,
          reason_code: 'prescription_line_not_found',
        },
      ],
    };
  }

  const drugMasters = await loadDrugMasterIndexes(db, targetLines);
  const drugPackages = await loadDrugPackageIndexes(db, targetLines, intake.prescribed_date);
  const now = new Date();
  const results: ApplyPrescriptionSupplyLineResult[] = [];
  for (const line of targetLines) {
    results.push(
      await applyPrescriptionSupplyLine({
        db,
        orgId: args.orgId,
        userId: args.userId,
        intake,
        line,
        drugMasters,
        drugPackages,
        ...(args.reviewSelection ? { selectedStockItemId: args.reviewSelection.stockItemId } : {}),
        now,
      }),
    );
  }

  return {
    intake_id: intake.id,
    applied_count: results.filter((result) => result.kind === 'applied').length,
    review_required_count: results.filter((result) => result.kind === 'review_required').length,
    skipped_count: results.filter((result) => result.kind === 'skipped').length,
    results,
  };
}
