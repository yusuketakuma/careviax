/**
 * 調剤プリフィルジェネレーター
 *
 * PrescriptionLine データから DispenseResult のプリフィルデータを生成する。
 * Compute-on-GET パターン: データは永続化せず、GET リクエスト時に毎回計算する。
 */

import { prisma } from '@/lib/db/client';
import { checkDateContinuity, type DateContinuityWarning } from './date-continuity';
import {
  detectMedicationChanges,
  formatDoseFrequency,
  matchMedicationDiffLines,
  prescriptionLineKey,
  type MedicationChange,
} from '@/lib/prescription/medication-diff';
import { generatePackagingGroups, type PackagingGroupAssignment } from './packaging-group';
import { findPreviousPrescriptionIntakeForMedicationDiff } from '@/server/services/prescription-intake-pair';

// ── Types ──

export interface DispensePrefillLine {
  lineId: string;
  lineNumber: number;
  drugName: string;
  drugCode: string | null;
  actualDrugName: string;
  actualDrugCode: string | null;
  actualQuantity: number | null;
  actualUnit: string | null;
  carryType: 'carry' | 'facility_deposit' | 'deferred';
  specialNotes: string | null;
  discrepancyReason: string | null;
  genericSuggestion: {
    available: boolean;
    genericDrugName: string | null;
    genericDrugCode: string | null;
  } | null;
  changeMarker: 'added' | 'removed' | 'dose_changed' | 'frequency_changed' | 'days_changed' | null;
  changeDetail: { previous: string | null; current: string | null } | null;
}

export interface DispensePrefillResult {
  lines: DispensePrefillLine[];
  packagingGroups: PackagingGroupAssignment[];
  medicationChanges: MedicationChange[];
  dateWarnings: DateContinuityWarning[];
  sourceType: string;
  isPrefillAvailable: boolean;
}

export type { PackagingGroupAssignment };

// ── Main Function ──

/**
 * DispenseTask に紐づく PrescriptionLine からプリフィルデータを生成する。
 * @param cycleId - MedicationCycle ID
 * @param orgId - Organization ID
 * @param siteId - Pharmacy site ID (for stock guidance)
 */
export async function generateDispensePrefill(
  cycleId: string,
  orgId: string,
  siteId: string | null,
): Promise<DispensePrefillResult> {
  // 1. Get the latest intake with lines for this cycle
  const currentIntake = await prisma.prescriptionIntake.findFirst({
    where: { cycle_id: cycleId, org_id: orgId },
    orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      source_type: true,
      prescribed_date: true,
      prescriber_name: true,
      created_at: true,
      cycle: {
        select: {
          patient_id: true,
          case_id: true,
        },
      },
      lines: {
        select: {
          id: true,
          line_number: true,
          drug_name: true,
          drug_code: true,
          dose: true,
          frequency: true,
          days: true,
          quantity: true,
          unit: true,
          notes: true,
          packaging_instructions: true,
          packaging_instruction_tags: true,
          route: true,
          start_date: true,
          end_date: true,
        },
        orderBy: { line_number: 'asc' },
      },
    },
  });

  if (!currentIntake || currentIntake.lines.length === 0) {
    return {
      lines: [],
      packagingGroups: [],
      medicationChanges: [],
      dateWarnings: [],
      sourceType: currentIntake?.source_type ?? 'unknown',
      isPrefillAvailable: false,
    };
  }

  // 2. Get previous intake + generic suggestions in parallel
  const [previousIntake, genericSuggestions] = await Promise.all([
    findPreviousPrescriptionIntakeForMedicationDiff(prisma, {
      orgId,
      patientId: currentIntake.cycle.patient_id,
      caseId: currentIntake.cycle.case_id,
      currentIntakeId: currentIntake.id,
      currentPrescribedDate: currentIntake.prescribed_date,
      currentCreatedAt: currentIntake.created_at,
    }),
    siteId
      ? lookupGenericSuggestions(currentIntake.lines, siteId)
      : Promise.resolve(new Map<string, { genericDrugName: string; genericDrugCode: string }>()),
  ]);

  // 3. Detect medication changes
  const medicationChanges = detectMedicationChanges(
    currentIntake.lines,
    previousIntake?.lines ?? [],
  );

  // 4. Check date continuity
  const dateWarnings = previousIntake
    ? checkDateContinuity(currentIntake.lines, previousIntake.lines)
    : [];

  // 5. Build line-scoped change marker map. Do not key by drug name: the same drug can
  // appear on multiple lines with different frequencies or durations.
  const changeByLineId = new Map<
    string,
    { marker: DispensePrefillLine['changeMarker']; detail: DispensePrefillLine['changeDetail'] }
  >();
  for (const match of matchMedicationDiffLines(currentIntake.lines, previousIntake?.lines ?? [])) {
    const line = match.current;
    const previous = match.previous;
    if (!line) continue;

    if (!previous) {
      changeByLineId.set(line.id, {
        marker: 'added',
        detail: { previous: null, current: formatDoseFrequency(line) },
      });
      continue;
    }

    if (prescriptionLineKey(previous) === prescriptionLineKey(line)) continue;

    const marker: DispensePrefillLine['changeMarker'] =
      previous.dose !== line.dose
        ? 'dose_changed'
        : previous.frequency !== line.frequency
          ? 'frequency_changed'
          : (previous.days ?? null) !== (line.days ?? null)
            ? 'days_changed'
            : null;
    if (!marker) continue;

    changeByLineId.set(line.id, {
      marker,
      detail: {
        previous: formatDoseFrequency(previous),
        current: formatDoseFrequency(line),
      },
    });
  }

  // 6. Build prefill lines
  const prefillLines: DispensePrefillLine[] = currentIntake.lines.map((line) => {
    const key = prescriptionLineKey(line);
    const change = changeByLineId.get(line.id);
    const generic = genericSuggestions.get(key);

    // Calculate quantity: use quantity if available, otherwise cannot calculate without parsing dose
    const actualQuantity = line.quantity ?? null;

    // Build special_notes from notes + packaging_instructions
    const notesParts = [line.packaging_instructions, line.notes].filter(Boolean);
    const specialNotes = notesParts.length > 0 ? notesParts.join(' / ') : null;

    return {
      lineId: line.id,
      lineNumber: line.line_number,
      drugName: line.drug_name,
      drugCode: line.drug_code,
      actualDrugName: line.drug_name, // No auto-conversion — generic is suggestion only
      actualDrugCode: line.drug_code,
      actualQuantity,
      actualUnit: line.unit,
      carryType:
        currentIntake.source_type === 'facility_batch'
          ? ('facility_deposit' as const)
          : ('carry' as const),
      specialNotes,
      discrepancyReason: null, // No auto-conversion, so no discrepancy
      genericSuggestion: generic
        ? {
            available: true,
            genericDrugName: generic.genericDrugName,
            genericDrugCode: generic.genericDrugCode,
          }
        : { available: false, genericDrugName: null, genericDrugCode: null },
      changeMarker: change?.marker ?? null,
      changeDetail: change?.detail ?? null,
    };
  });

  const packagingGroups = generatePackagingGroups(
    currentIntake.lines.map((line) => ({
      id: line.id,
      drug_name: line.drug_name,
      frequency: line.frequency,
      route: line.route,
      packaging_instruction_tags: line.packaging_instruction_tags as string[],
    })),
  );

  return {
    lines: prefillLines,
    packagingGroups,
    medicationChanges,
    dateWarnings,
    sourceType: currentIntake.source_type,
    isPrefillAvailable: true,
  };
}

// ── Helpers ──

/**
 * PharmacyDrugStock から後発品提案を取得（バッチクエリ版）
 */
async function lookupGenericSuggestions(
  lines: Array<{ drug_code: string | null; drug_name: string }>,
  siteId: string,
): Promise<Map<string, { genericDrugName: string; genericDrugCode: string }>> {
  const result = new Map<string, { genericDrugName: string; genericDrugCode: string }>();

  const drugCodes = lines.map((l) => l.drug_code).filter((c): c is string => !!c);
  if (drugCodes.length === 0) return result;

  // Batch 1: Find all matching DrugMasters
  const drugMasters = await prisma.drugMaster.findMany({
    where: { OR: [{ yj_code: { in: drugCodes } }, { receipt_code: { in: drugCodes } }] },
    select: { id: true, yj_code: true, receipt_code: true },
  });

  const masterIdsByCode = new Map<string, string>();
  for (const dm of drugMasters) {
    if (dm.yj_code) masterIdsByCode.set(dm.yj_code, dm.id);
    if (dm.receipt_code) masterIdsByCode.set(dm.receipt_code, dm.id);
  }

  const masterIds = [...new Set(drugMasters.map((dm) => dm.id))];
  if (masterIds.length === 0) return result;

  // Batch 2: Find all stocks with preferred generics
  const stocks = await prisma.pharmacyDrugStock.findMany({
    where: {
      site_id: siteId,
      drug_master_id: { in: masterIds },
      preferred_generic_id: { not: null },
    },
    select: { drug_master_id: true, preferred_generic_id: true },
  });

  const genericIds = stocks.map((s) => s.preferred_generic_id).filter((id): id is string => !!id);
  if (genericIds.length === 0) return result;

  // Batch 3: Fetch generic drug names
  const generics = await prisma.drugMaster.findMany({
    where: { id: { in: genericIds } },
    select: { id: true, drug_name: true, yj_code: true },
  });

  const genericMap = new Map(generics.map((g) => [g.id, g]));
  const stockByMasterId = new Map(stocks.map((s) => [s.drug_master_id, s.preferred_generic_id]));

  // Build result map
  for (const line of lines) {
    if (!line.drug_code) continue;
    const masterId = masterIdsByCode.get(line.drug_code);
    if (!masterId) continue;
    const genericId = stockByMasterId.get(masterId);
    if (!genericId) continue;
    const generic = genericMap.get(genericId);
    if (!generic) continue;

    result.set(prescriptionLineKey(line), {
      genericDrugName: generic.drug_name,
      genericDrugCode: generic.yj_code ?? '',
    });
  }

  return result;
}
