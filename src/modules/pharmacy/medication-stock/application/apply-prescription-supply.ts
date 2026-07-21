import { Prisma } from '@prisma/client';

import { allocateDisplayId } from '@/lib/db/display-id';
import { normalizeMedicationCode } from '@/lib/pharmacy/drug-identity-resolution';
import { buildPackageCodeCandidates, buildPackageLookupOr } from '@/lib/pharmacy/package-code';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { isMedicationStockItemWriteAllowed } from '../domain/medication-equivalence';
import { resolveConfirmedPrescriptionReplenishmentHorizon } from './prescription-replenishment-horizon';
import { decimalToNumber, recalculateMedicationStockSnapshot } from './stock-snapshot';

import {
  type ApplyPrescriptionSupplyDb,
  type ApplyPrescriptionSupplyForIntakeResult,
  type ApplyPrescriptionSupplyLineResult,
  type CreatePrescriptionSupplyStockItemResult,
  type DrugMasterIdentityRow,
  type DrugMasterIndexes,
  type DrugPackageIdentityRow,
  type DrugPackageIndexes,
  type PrescriptionSupplyIntakeRow,
  type PrescriptionSupplyLineRow,
  type PrescriptionSupplyManagingParty,
  type PrescriptionSupplyReviewLine,
  type PrescriptionSupplyReviewPreview,
  type PrescriptionSupplyReviewReason,
  type ResolvedPrescriptionSupplyTarget,
  type StockItemRow,
} from './apply-prescription-supply-contract';
export * from './apply-prescription-supply-contract';

const PRESCRIPTION_SUPPLY_REVIEW_TASK_TYPE =
  'pharmacy.medication_stock_unlinked_prescription_supply';

import {
  buildDrugMasterIndexes,
  buildSupplyEventIdempotencyKeyHash,
  buildSupplyRequestFingerprint,
  isLikelyPrnLine,
  isPackageOnlyIdentity,
  isSalesPackageCountUnit,
  isStockRelevantLine,
  normalizeMedicationStockUnit,
  normalizePrescriptionSupplyUnit,
  normalizeSourceCodeType,
  normalizeText,
  resolveLineDrugMaster,
  reviewTaskDedupeKey,
  stableStringify,
} from './apply-prescription-supply-resolution';

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

function medicationStockCategoryForLine(
  line: PrescriptionSupplyLineRow,
): 'prn' | 'topical' | 'external' {
  if (isLikelyPrnLine(line)) return 'prn';
  const text = normalizeText([line.dosage_form, line.drug_name].filter(Boolean).join(' '));
  return text && /軟膏|クリーム|ゲル|ローション|塗布/.test(text) ? 'topical' : 'external';
}

export async function createPrescriptionSupplyStockItemForReview(
  db: ApplyPrescriptionSupplyDb,
  args: {
    orgId: string;
    userId: string;
    intakeId: string;
    patientId: string;
    prescriptionLineId: string;
    managingParty: PrescriptionSupplyManagingParty;
  },
): Promise<CreatePrescriptionSupplyStockItemResult> {
  const intake = await loadPrescriptionSupplyIntake(db, args);
  if (!intake) return { kind: 'not_found', reason_code: 'intake_not_found' };
  const line = intake.lines.find((candidate) => candidate.id === args.prescriptionLineId);
  if (!line) return { kind: 'not_found', reason_code: 'prescription_line_not_found' };
  if (!isStockRelevantLine(line)) {
    return { kind: 'review_required', reason_code: 'non_stock_relevant_line' };
  }

  const drugMasters = await loadDrugMasterIndexes(db, [line]);
  const drugPackages = await loadDrugPackageIndexes(db, [line], intake.prescribed_date);
  const target = resolvePrescriptionSupplyTarget({ line, drugMasters, drugPackages });
  if (!target.ok) {
    return { kind: 'review_required', reason_code: target.reasonCode };
  }

  const existingItems = await findExactStockItemCandidates({
    db,
    orgId: args.orgId,
    patientId: args.patientId,
    caseId: intake.cycle.case_id,
    drugMasterId: target.drugMasterId,
    ...(target.drugPackage ? { drugPackageId: target.drugPackage.id } : {}),
  });
  if (existingItems.length > 0) {
    return { kind: 'review_required', reason_code: 'existing_stock_item_available' };
  }

  const stockItem = await db.patientMedicationStockItem.create({
    data: {
      org_id: args.orgId,
      display_id: await allocateDisplayId(
        db as Prisma.TransactionClient,
        'PatientMedicationStockItem',
        args.orgId,
      ),
      patient_id: args.patientId,
      case_id: intake.cycle.case_id,
      drug_master_id: target.drugMasterId,
      drug_package_id: target.drugPackage?.id ?? null,
      canonical_medication_group_id: null,
      source_type: 'prescription',
      medication_category: medicationStockCategoryForLine(line),
      display_name: line.drug_name,
      normalized_name: normalizeText(line.drug_name),
      ingredient_name: null,
      strength: null,
      dosage_form: line.dosage_form,
      route: line.route,
      unit: target.unit as never,
      default_usage_amount_per_day: null,
      default_usage_frequency_text: line.frequency,
      max_usage_amount_per_day: null,
      indication_text: null,
      usage_instruction_text: [line.dose, line.frequency].filter(Boolean).join(' / '),
      managing_party: args.managingParty,
      equivalence_review_status: 'reviewed',
      equivalence_confidence: 'exact_code',
      active: true,
      archived_at: null,
      archived_by: null,
      created_by: args.userId,
    },
    select: { id: true },
  });

  return { kind: 'created', stock_item_id: stockItem.id };
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
