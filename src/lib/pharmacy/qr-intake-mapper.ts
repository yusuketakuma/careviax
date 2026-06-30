/**
 * QR→PrescriptionIntake マッパー
 *
 * JAHIS QRデータを PrescriptionIntake + PrescriptionLine 入力に変換する。
 * DrugMaster から薬品情報を自動補完し、PharmacyDrugStock で採用薬を優先表示する。
 * PrescriberInstitution を QR の処方元医療機関情報から検索・自動登録する。
 */

import { prisma } from '@/lib/db/client';
import type { DrugMaster, PharmacyDrugStock, Prisma } from '@prisma/client';
import type { JahisQRData, JahisMedication } from './jahis-qr';
import { parseDaysOrTimes } from './jahis-qr';
import { extractPackagingInstructionTags, parsePackagingMethod } from '@/lib/dispensing/packaging';

// ── Types ──

export interface QrToIntakeInput {
  orgId: string;
  siteId: string;
  patientId: string;
  caseId: string;
  scannedBy: string;
}

export interface QrIntakeLineInput {
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  drug_code_resolution_status?: 'resolved' | 'review_required' | 'unresolved';
  drug_code_resolution_source?: 'drug_master_code' | 'drug_master_name_fallback' | 'none';
  candidate_drug_master_id?: string | null;
  candidate_drug_code?: string | null;
  candidate_drug_name?: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number | null; // null = needs manual input on PC
  quantity: number | null;
  unit: string | null;
  is_generic: boolean;
  packaging_method: string | null;
  packaging_instructions: string | null;
  packaging_instruction_tags: string[];
  route: string | null;
  dispensing_method: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

export interface AutoCompletedField {
  lineIndex: number;
  field: string;
  value: string;
  source: 'drug_master';
}

export interface FormularyMatch {
  lineIndex: number;
  drugName: string;
  drugCode: string | null;
  inFormulary: boolean;
  warningLevel: 'none' | 'warning';
  warningReason: 'not_stocked' | 'stocked_generic_available' | null;
  preferredGenericId: string | null;
  preferredGenericName: string | null;
  stockQty: number | null;
}

export interface UnmatchedDrug {
  lineIndex: number;
  drugName: string;
  drugCode: string | null;
  reason: 'code_not_found' | 'name_not_found' | 'no_code_provided';
  requiresReview?: boolean;
  suggestedDrugMasterId?: string | null;
  suggestedDrugCode?: string | null;
  suggestedDrugName?: string | null;
}

export interface InstitutionResolution {
  prescriberInstitutionId: string | null;
  prescriberInstitutionName: string | null;
  isNewlyRegistered: boolean;
}

export interface QrToIntakeResult {
  lines: QrIntakeLineInput[];
  prescribedDate: string | null;
  prescriberName: string | null;
  prescriberInstitution: string | null;
  prescriberInstitutionCode: string | null;
  prescriberInstitutionId: string | null;
  isNewInstitution: boolean;
  autoCompletedFields: AutoCompletedField[];
  unmatchedDrugs: UnmatchedDrug[];
  formularyStatus: FormularyMatch[];
}

const DRUG_MASTER_LOOKUP_BATCH_SIZE = 50;
const FORMULARY_LOOKUP_BATCH_SIZE = 100;

type FormularyStock = Pick<
  PharmacyDrugStock,
  'drug_master_id' | 'preferred_generic_id' | 'stock_qty'
> & {
  drug_master?: Pick<DrugMaster, 'id' | 'drug_name' | 'generic_name' | 'is_generic'> | null;
};

interface DrugLookupContext {
  drugMasterLookupByLine: DrugMasterLookupResult[];
  stockByDrugMasterId: Map<string, FormularyStock>;
  alternativeGenericStockByGenericName: Map<string, FormularyStock>;
  preferredGenericNameById: Map<string, string>;
}

type DrugMasterLookupResult =
  | { drugMaster: DrugMaster; matchSource: 'code' | 'name' }
  | { drugMaster: null; matchSource: null };

type PrescriptionLineSourceDrugCodeType = 'yj' | 'receipt' | 'hot' | 'unknown';

// ── Main Function ──

export async function mapJahisToIntake(
  qrData: JahisQRData,
  input: QrToIntakeInput,
): Promise<QrToIntakeResult> {
  const autoCompletedFields: AutoCompletedField[] = [];
  const unmatchedDrugs: UnmatchedDrug[] = [];
  const formularyStatus: FormularyMatch[] = [];
  const lines: QrIntakeLineInput[] = [];
  const drugLookupContext = await buildDrugLookupContext(
    qrData.medications,
    input.orgId,
    input.siteId,
  );

  for (let i = 0; i < qrData.medications.length; i++) {
    const med = qrData.medications[i];
    const { line, autoCompleted, unmatched, formulary } = mapMedicationLine(
      med,
      i,
      qrData.dispensingDate ?? null,
      qrData.remarks,
      drugLookupContext,
    );
    lines.push({ ...line, line_number: i + 1 });
    autoCompletedFields.push(...autoCompleted);
    if (unmatched) unmatchedDrugs.push(unmatched);
    formularyStatus.push(formulary);
  }

  // Resolve prescribing institution
  const institution = await resolveOrCreatePrescriberInstitution(
    input.orgId,
    qrData.prescribingInstitution.name,
    qrData.prescribingInstitution.institutionCode,
  );

  return {
    lines,
    prescribedDate: qrData.dispensingDate ?? null,
    prescriberName: qrData.prescribingDoctor ?? null,
    prescriberInstitution:
      institution.prescriberInstitutionName ?? qrData.prescribingInstitution.name ?? null,
    prescriberInstitutionCode: qrData.prescribingInstitution.institutionCode ?? null,
    prescriberInstitutionId: institution.prescriberInstitutionId,
    isNewInstitution: institution.isNewlyRegistered,
    autoCompletedFields,
    unmatchedDrugs,
    formularyStatus,
  };
}

// ── Institution Resolution ──

/**
 * QRの処方元医療機関情報からPrescriberInstitutionを検索。
 * 見つからない場合は新規登録する。
 */
async function resolveOrCreatePrescriberInstitution(
  orgId: string,
  institutionName: string | undefined,
  institutionCode: string | undefined,
): Promise<InstitutionResolution> {
  if (!institutionName && !institutionCode) {
    return {
      prescriberInstitutionId: null,
      prescriberInstitutionName: null,
      isNewlyRegistered: false,
    };
  }

  // 1. Search by institution_code (most reliable)
  if (institutionCode) {
    const byCode = await prisma.prescriberInstitution.findFirst({
      where: { org_id: orgId, institution_code: institutionCode },
    });
    if (byCode) {
      return {
        prescriberInstitutionId: byCode.id,
        prescriberInstitutionName: byCode.name,
        isNewlyRegistered: false,
      };
    }
  }

  // 2. Search by name (exact match)
  if (institutionName) {
    const byName = await prisma.prescriberInstitution.findFirst({
      where: { org_id: orgId, name: institutionName },
    });
    if (byName) {
      return {
        prescriberInstitutionId: byName.id,
        prescriberInstitutionName: byName.name,
        isNewlyRegistered: false,
      };
    }
  }

  // 3. Not found → auto-register (with validation)
  const INSTITUTION_CODE_PATTERN = /^\d{7,10}$/;

  // Validate institution code format before auto-registration
  if (institutionCode && !INSTITUTION_CODE_PATTERN.test(institutionCode)) {
    return {
      prescriberInstitutionId: null,
      prescriberInstitutionName: institutionName ?? null,
      isNewlyRegistered: false,
    };
  }

  // Sanitize name to strip control characters and enforce max length
  const sanitizedName = (institutionName || `医療機関 (${institutionCode})`)
    .replace(/[\x00-\x1f]/g, '')
    .slice(0, 200);

  const newInstitution = await prisma.prescriberInstitution.create({
    data: {
      org_id: orgId,
      name: sanitizedName,
      institution_code: institutionCode || null,
    },
  });

  return {
    prescriberInstitutionId: newInstitution.id,
    prescriberInstitutionName: newInstitution.name,
    isNewlyRegistered: true,
  };
}

// ── Helpers ──

async function buildDrugLookupContext(
  medications: JahisMedication[],
  orgId: string,
  siteId: string,
): Promise<DrugLookupContext> {
  if (medications.length === 0) {
    return {
      drugMasterLookupByLine: [],
      stockByDrugMasterId: new Map(),
      alternativeGenericStockByGenericName: new Map(),
      preferredGenericNameById: new Map(),
    };
  }

  const drugMasterCandidates = await fetchDrugMasterCandidates(medications);
  const drugMasterLookupByLine = medications.map((med) =>
    lookupDrugMasterFromCandidates(
      med.drugCode,
      med.drugCodeType,
      med.drugName,
      drugMasterCandidates,
    ),
  );
  const drugMasterIds = uniqueNonNullable(
    drugMasterLookupByLine
      .filter((lookup) => lookup.matchSource === 'code')
      .map((lookup) => lookup.drugMaster?.id ?? null),
  );
  const stocks = await fetchFormularyStocks(orgId, siteId, drugMasterIds);
  const stockByDrugMasterId = new Map<string, FormularyStock>();

  for (const stock of stocks) {
    if (!stockByDrugMasterId.has(stock.drug_master_id)) {
      stockByDrugMasterId.set(stock.drug_master_id, stock);
    }
  }

  const alternativeGenericNames = uniqueNonNullable(
    drugMasterLookupByLine
      .filter(
        (lookup) =>
          lookup.matchSource === 'code' &&
          lookup.drugMaster &&
          !stockByDrugMasterId.has(lookup.drugMaster.id),
      )
      .map((lookup) => lookup.drugMaster?.generic_name ?? null),
  );
  const alternativeGenericStocks = await fetchAlternativeGenericStocks(
    orgId,
    siteId,
    alternativeGenericNames,
    drugMasterIds,
  );
  const alternativeGenericStockByGenericName = new Map<string, FormularyStock>();
  for (const stock of alternativeGenericStocks) {
    const genericName = stock.drug_master?.generic_name;
    if (genericName && !alternativeGenericStockByGenericName.has(genericName)) {
      alternativeGenericStockByGenericName.set(genericName, stock);
    }
  }

  const preferredGenericIds = uniqueNonNullable([
    ...stocks.map((stock) => stock.preferred_generic_id),
    ...alternativeGenericStocks.map((stock) => stock.drug_master_id),
  ]);
  const preferredGenericNameById = await fetchPreferredGenericNames(preferredGenericIds);

  return {
    drugMasterLookupByLine,
    stockByDrugMasterId,
    alternativeGenericStockByGenericName,
    preferredGenericNameById,
  };
}

async function fetchDrugMasterCandidates(medications: JahisMedication[]) {
  const whereClauses = buildDrugMasterWhereClauses(medications);

  if (whereClauses.length === 0) {
    return [];
  }

  const candidatesById = new Map<string, DrugMaster>();

  for (const batch of chunk(whereClauses, DRUG_MASTER_LOOKUP_BATCH_SIZE)) {
    const rows = await prisma.drugMaster.findMany({
      where: { OR: batch },
    });

    for (const row of rows) {
      if (!candidatesById.has(row.id)) {
        candidatesById.set(row.id, row);
      }
    }
  }

  return Array.from(candidatesById.values());
}

function buildDrugMasterWhereClauses(medications: JahisMedication[]) {
  const whereClauses: Prisma.DrugMasterWhereInput[] = [];
  const seen = new Set<string>();

  for (const med of medications) {
    const cleanedCode = med.drugCode?.replace(/\s/g, '') ?? null;
    const hasUsableDrugCode =
      cleanedCode != null && cleanedCode.length > 0 && med.drugCodeType !== 1;

    if (hasUsableDrugCode && med.drugCodeType) {
      switch (med.drugCodeType) {
        case 2:
          addCodeLookup(whereClauses, seen, 'receipt_code', cleanedCode);
          break;
        case 4:
          addCodeLookup(whereClauses, seen, 'yj_code', cleanedCode);
          break;
        case 6:
          addCodeLookup(whereClauses, seen, 'hot_code', cleanedCode);
          break;
        case 3:
          addCodeLookup(whereClauses, seen, 'yj_code', cleanedCode);
          addCodeLookup(whereClauses, seen, 'receipt_code', cleanedCode);
          break;
      }
    }

    if (hasUsableDrugCode && cleanedCode) {
      addCodeLookup(whereClauses, seen, 'yj_code', cleanedCode);
      addCodeLookup(whereClauses, seen, 'receipt_code', cleanedCode);
    }

    if (med.drugName && med.drugName !== '不明') {
      const key = `drug_name:${med.drugName}`;
      if (!seen.has(key)) {
        seen.add(key);
        whereClauses.push({ drug_name: { contains: med.drugName } });
      }
    }
  }

  return whereClauses;
}

function addCodeLookup(
  whereClauses: Prisma.DrugMasterWhereInput[],
  seen: Set<string>,
  field: 'yj_code' | 'receipt_code' | 'hot_code',
  value: string,
) {
  const key = `${field}:${value}`;
  if (seen.has(key)) return;

  seen.add(key);
  whereClauses.push({ [field]: value } as Prisma.DrugMasterWhereInput);
}

async function fetchFormularyStocks(orgId: string, siteId: string, drugMasterIds: string[]) {
  if (drugMasterIds.length === 0) {
    return [];
  }

  const stocks: PharmacyDrugStock[] = [];

  for (const batch of chunk(drugMasterIds, FORMULARY_LOOKUP_BATCH_SIZE)) {
    stocks.push(
      ...(await prisma.pharmacyDrugStock.findMany({
        where: {
          org_id: orgId,
          site_id: siteId,
          drug_master_id: { in: batch },
          is_stocked: true,
        },
      })),
    );
  }

  return stocks;
}

async function fetchAlternativeGenericStocks(
  orgId: string,
  siteId: string,
  genericNames: string[],
  excludedDrugMasterIds: string[],
) {
  if (genericNames.length === 0) {
    return [];
  }

  const stocks: FormularyStock[] = [];

  for (const batch of chunk(genericNames, FORMULARY_LOOKUP_BATCH_SIZE)) {
    stocks.push(
      ...(await prisma.pharmacyDrugStock.findMany({
        where: {
          org_id: orgId,
          site_id: siteId,
          is_stocked: true,
          drug_master: {
            generic_name: { in: batch },
            is_generic: true,
            id: { notIn: excludedDrugMasterIds },
          },
        },
        orderBy: [{ updated_at: 'desc' }],
        select: {
          drug_master_id: true,
          preferred_generic_id: true,
          stock_qty: true,
          drug_master: {
            select: {
              id: true,
              drug_name: true,
              generic_name: true,
              is_generic: true,
            },
          },
        },
      })),
    );
  }

  return stocks;
}

async function fetchPreferredGenericNames(preferredGenericIds: string[]) {
  const preferredGenericNameById = new Map<string, string>();

  if (preferredGenericIds.length === 0) {
    return preferredGenericNameById;
  }

  for (const batch of chunk(preferredGenericIds, DRUG_MASTER_LOOKUP_BATCH_SIZE)) {
    const rows = await prisma.drugMaster.findMany({
      where: { id: { in: batch } },
      select: { id: true, drug_name: true },
    });

    for (const row of rows) {
      preferredGenericNameById.set(row.id, row.drug_name);
    }
  }

  return preferredGenericNameById;
}

function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < values.length; i += size) {
    batches.push(values.slice(i, i + size));
  }

  return batches;
}

function uniqueNonNullable(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function lookupDrugMasterFromCandidates(
  drugCode: string | undefined,
  drugCodeType: number | undefined,
  drugName: string,
  candidates: DrugMaster[],
): DrugMasterLookupResult {
  const hasUsableDrugCode = Boolean(drugCode && drugCodeType !== 1);

  if (hasUsableDrugCode && drugCode && drugCodeType) {
    const cleaned = drugCode.replace(/\s/g, '');

    switch (drugCodeType) {
      case 2: {
        const match = findFirstCandidate(
          candidates,
          (candidate) => candidate.receipt_code === cleaned,
        );
        if (match) return { drugMaster: match, matchSource: 'code' };
        break;
      }
      case 4: {
        const match = findFirstCandidate(candidates, (candidate) => candidate.yj_code === cleaned);
        if (match) return { drugMaster: match, matchSource: 'code' };
        break;
      }
      case 6: {
        const match = findFirstCandidate(candidates, (candidate) => candidate.hot_code === cleaned);
        if (match) return { drugMaster: match, matchSource: 'code' };
        break;
      }
      case 3: {
        const match = findFirstCandidate(
          candidates,
          (candidate) => candidate.yj_code === cleaned || candidate.receipt_code === cleaned,
        );
        if (match) return { drugMaster: match, matchSource: 'code' };
        break;
      }
    }
  }

  if (hasUsableDrugCode && drugCode) {
    const cleaned = drugCode.replace(/\s/g, '');
    if (cleaned.length === 12) {
      const match = findFirstCandidate(candidates, (candidate) => candidate.yj_code === cleaned);
      if (match) return { drugMaster: match, matchSource: 'code' };
    }
    if (cleaned.length === 9) {
      const match = findFirstCandidate(
        candidates,
        (candidate) => candidate.receipt_code === cleaned,
      );
      if (match) return { drugMaster: match, matchSource: 'code' };
    }

    const match = findFirstCandidate(
      candidates,
      (candidate) => candidate.yj_code === cleaned || candidate.receipt_code === cleaned,
    );
    if (match) return { drugMaster: match, matchSource: 'code' };
  }

  if (drugName && drugName !== '不明') {
    const match = findDrugNameFallbackCandidate(candidates, drugName);
    if (match) return { drugMaster: match, matchSource: 'name' };
  }

  return { drugMaster: null, matchSource: null };
}

function findFirstCandidate(
  candidates: DrugMaster[],
  predicate: (candidate: DrugMaster) => boolean,
) {
  return candidates.find(predicate) ?? null;
}

function findDrugNameFallbackCandidate(candidates: DrugMaster[], drugName: string) {
  const normalizedDrugName = drugName.trim();
  if (!normalizedDrugName) return null;

  const exactMatches = candidates.filter((candidate) => candidate.drug_name === normalizedDrugName);
  if (exactMatches.length === 1) return exactMatches[0] ?? null;
  if (exactMatches.length > 1) return null;

  const partialMatches = candidates.filter((candidate) =>
    candidate.drug_name.includes(normalizedDrugName),
  );
  return partialMatches.length === 1 ? (partialMatches[0] ?? null) : null;
}

function inferPrescriptionLineSourceDrugCodeType(
  drugCode: string | null,
  drugCodeType: number | undefined,
): PrescriptionLineSourceDrugCodeType | null {
  if (!drugCode || drugCodeType === 1) return null;
  switch (drugCodeType) {
    case 2:
      return 'receipt';
    case 4:
      return 'yj';
    case 6:
      return 'hot';
    case 3:
      if (drugCode.length === 12) return 'yj';
      if (drugCode.length === 9) return 'receipt';
      return 'unknown';
    default:
      if (drugCode.length === 12) return 'yj';
      if (drugCode.length === 9) return 'receipt';
      if (drugCode.length === 13) return 'hot';
      return 'unknown';
  }
}

function mapMedicationLine(
  med: JahisMedication,
  index: number,
  prescribedDate: string | null,
  qrRemarks: string[],
  drugLookupContext: DrugLookupContext,
): {
  line: Omit<QrIntakeLineInput, 'line_number'>;
  autoCompleted: AutoCompletedField[];
  unmatched: UnmatchedDrug | null;
  formulary: FormularyMatch;
} {
  const autoCompleted: AutoCompletedField[] = [];
  let unmatched: UnmatchedDrug | null = null;

  // Parse days/times — prefer usageQuantity+usageUnit (record 301), fall back to daysOrTimes
  const daysOrTimesRaw =
    med.usageQuantity && med.usageUnit
      ? `${med.usageQuantity}${med.usageUnit}`
      : (med.daysOrTimes ?? null);
  const daysOrTimes = daysOrTimesRaw ? parseDaysOrTimes(daysOrTimesRaw) : null;
  const days = daysOrTimes?.days ?? null;

  // Build dose string
  const dose = med.dose ? (med.unit ? `${med.dose}${med.unit}` : med.dose) : '';

  // DrugMaster lookup (drugCodeType-aware)
  const drugLookup = drugLookupContext.drugMasterLookupByLine[index] ?? {
    drugMaster: null,
    matchSource: null,
  };
  const suggestedDrugMaster = drugLookup.matchSource === 'name' ? drugLookup.drugMaster : null;
  const drugMaster = drugLookup.matchSource === 'code' ? drugLookup.drugMaster : null;
  const hasUsableDrugCode = Boolean(med.drugCode && med.drugCodeType !== 1);
  const sourceDrugCode = hasUsableDrugCode ? (med.drugCode?.replace(/\s/g, '') ?? null) : null;
  const sourceDrugCodeType = inferPrescriptionLineSourceDrugCodeType(
    sourceDrugCode,
    med.drugCodeType,
  );

  let dosageForm: string | null = null;
  let isGeneric = false;

  if (drugMaster) {
    if (drugMaster.dosage_form) {
      dosageForm = drugMaster.dosage_form;
      autoCompleted.push({
        lineIndex: index,
        field: 'dosage_form',
        value: dosageForm,
        source: 'drug_master',
      });
    }
    isGeneric = drugMaster.is_generic;
  } else {
    // No DrugMaster match
    if (!sourceDrugCode) {
      unmatched = {
        lineIndex: index,
        drugName: med.drugName,
        drugCode: null,
        reason: 'no_code_provided',
        requiresReview: true,
        suggestedDrugMasterId: suggestedDrugMaster?.id ?? null,
        suggestedDrugCode: suggestedDrugMaster?.yj_code ?? null,
        suggestedDrugName: suggestedDrugMaster?.drug_name ?? null,
      };
    } else {
      unmatched = {
        lineIndex: index,
        drugName: med.drugName,
        drugCode: sourceDrugCode,
        reason: 'code_not_found',
        requiresReview: true,
        suggestedDrugMasterId: suggestedDrugMaster?.id ?? null,
        suggestedDrugCode: suggestedDrugMaster?.yj_code ?? null,
        suggestedDrugName: suggestedDrugMaster?.drug_name ?? null,
      };
    }
  }

  // PharmacyDrugStock (formulary) check
  let inFormulary = false;
  let preferredGenericId: string | null = null;
  let preferredGenericName: string | null = null;
  let stockQty: number | null = null;

  if (drugMaster) {
    const stock = drugLookupContext.stockByDrugMasterId.get(drugMaster.id) ?? null;
    if (stock) {
      inFormulary = true;
      preferredGenericId = stock.preferred_generic_id;
      stockQty = stock.stock_qty;

      if (stock.preferred_generic_id) {
        preferredGenericName =
          drugLookupContext.preferredGenericNameById.get(stock.preferred_generic_id) ?? null;
      }
    } else if (drugMaster.generic_name) {
      const alternativeGeneric =
        drugLookupContext.alternativeGenericStockByGenericName.get(drugMaster.generic_name) ?? null;
      if (alternativeGeneric) {
        preferredGenericId = alternativeGeneric.drug_master_id;
        preferredGenericName =
          alternativeGeneric.drug_master?.drug_name ??
          drugLookupContext.preferredGenericNameById.get(alternativeGeneric.drug_master_id) ??
          null;
        stockQty = alternativeGeneric.stock_qty;
      }
    }
  }

  const formulary: FormularyMatch = {
    lineIndex: index,
    drugName: med.drugName,
    drugCode: med.drugCode ?? null,
    inFormulary,
    warningLevel: !inFormulary && drugMaster ? 'warning' : 'none',
    warningReason:
      !inFormulary && drugMaster
        ? preferredGenericId
          ? 'stocked_generic_available'
          : 'not_stocked'
        : null,
    preferredGenericId,
    preferredGenericName,
    stockQty,
  };

  const detailNotes = Array.from(
    new Set(
      [...med.supplements, ...med.usageNotes, ...qrRemarks]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const noteText = detailNotes.length > 0 ? detailNotes.join(' / ') : null;
  const packagingText =
    detailNotes
      .filter((value) =>
        /一包|粉砕|別包|別袋|分包|PTP|ヒート|シート|冷所|麻薬|ラベル|混合|賦形|脱カプ|手撒き|手まき|manual\s*ptp/i.test(
          value,
        ),
      )
      .join(' / ') || null;
  const parsedPackaging = parsePackagingMethod(packagingText);
  const route = inferRoute({
    dosageForm: drugMaster?.dosage_form ?? null,
    formCode: med.formCode,
    usage: med.usage ?? null,
    drugName: med.drugName,
  });
  const dispensingMethod =
    parsedPackaging.method === 'unit_dose' || parsedPackaging.method === 'morning_evening_unit_dose'
      ? 'unit_dose'
      : parsedPackaging.method === 'crush_and_pack'
        ? 'crushed'
        : null;
  const packagingInstructionTags = extractPackagingInstructionTags({
    packagingInstructions: packagingText,
    notes: noteText,
    packagingMethod:
      parsedPackaging.method === null || parsedPackaging.method === 'other'
        ? null
        : parsedPackaging.method,
  });

  const line: Omit<QrIntakeLineInput, 'line_number'> = {
    drug_name: med.drugName,
    drug_code: drugMaster?.yj_code ?? sourceDrugCode,
    source_drug_code: sourceDrugCode,
    source_drug_code_type: sourceDrugCodeType,
    drug_code_resolution_status: drugMaster
      ? 'resolved'
      : suggestedDrugMaster
        ? 'review_required'
        : 'unresolved',
    drug_code_resolution_source: drugMaster
      ? 'drug_master_code'
      : suggestedDrugMaster
        ? 'drug_master_name_fallback'
        : 'none',
    candidate_drug_master_id: suggestedDrugMaster?.id ?? null,
    candidate_drug_code: suggestedDrugMaster?.yj_code ?? null,
    candidate_drug_name: suggestedDrugMaster?.drug_name ?? null,
    dosage_form: dosageForm,
    dose,
    frequency: med.usage ?? '',
    days,
    quantity: med.dispensedQuantity ? parseFloat(med.dispensedQuantity) || null : null,
    unit: med.unit ?? null,
    is_generic: isGeneric,
    packaging_method: parsedPackaging.method,
    packaging_instructions: packagingText,
    packaging_instruction_tags: packagingInstructionTags,
    route,
    dispensing_method: dispensingMethod,
    start_date: prescribedDate,
    end_date: null,
    notes: noteText,
  };

  return { line, autoCompleted, unmatched, formulary };
}

function inferRoute(args: {
  dosageForm: string | null;
  formCode?: number;
  usage: string | null;
  drugName: string;
}) {
  const basis = `${args.dosageForm ?? ''} ${args.usage ?? ''} ${args.drugName}`.trim();

  if (/注射|注入|シリンジ|アンプル|バイアル/i.test(basis)) {
    return 'injection';
  }

  if (/軟膏|クリーム|貼付|テープ|坐剤|点眼|点鼻|吸入|ローション|ゲル|外用/i.test(basis)) {
    return 'external';
  }

  if (args.formCode === 3 || args.formCode === 4) {
    return 'external';
  }

  if (args.formCode === 5 || args.formCode === 6) {
    return 'injection';
  }

  return 'internal';
}
