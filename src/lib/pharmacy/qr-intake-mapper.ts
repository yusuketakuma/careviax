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
import {
  extractPackagingInstructionTags,
  parsePackagingMethod,
} from '@/lib/prescription/packaging';

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
  preferredGenericId: string | null;
  preferredGenericName: string | null;
  stockQty: number | null;
}

export interface UnmatchedDrug {
  lineIndex: number;
  drugName: string;
  drugCode: string | null;
  reason: 'code_not_found' | 'name_not_found' | 'no_code_provided';
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

interface DrugLookupContext {
  drugMasterByLine: Array<DrugMaster | null>;
  stockByDrugMasterId: Map<string, PharmacyDrugStock>;
  preferredGenericNameById: Map<string, string>;
}

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
      drugMasterByLine: [],
      stockByDrugMasterId: new Map(),
      preferredGenericNameById: new Map(),
    };
  }

  const drugMasterCandidates = await fetchDrugMasterCandidates(medications);
  const drugMasterByLine = medications.map((med) =>
    lookupDrugMasterFromCandidates(
      med.drugCode,
      med.drugCodeType,
      med.drugName,
      drugMasterCandidates,
    ),
  );
  const drugMasterIds = uniqueNonNullable(
    drugMasterByLine.map((drugMaster) => drugMaster?.id ?? null),
  );
  const stocks = await fetchFormularyStocks(orgId, siteId, drugMasterIds);
  const stockByDrugMasterId = new Map<string, PharmacyDrugStock>();

  for (const stock of stocks) {
    if (!stockByDrugMasterId.has(stock.drug_master_id)) {
      stockByDrugMasterId.set(stock.drug_master_id, stock);
    }
  }

  const preferredGenericIds = uniqueNonNullable(stocks.map((stock) => stock.preferred_generic_id));
  const preferredGenericNameById = await fetchPreferredGenericNames(preferredGenericIds);

  return {
    drugMasterByLine,
    stockByDrugMasterId,
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

    if (cleanedCode && med.drugCodeType && med.drugCodeType !== 1) {
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

    if (cleanedCode) {
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
) {
  if (drugCode && drugCodeType && drugCodeType !== 1) {
    const cleaned = drugCode.replace(/\s/g, '');

    switch (drugCodeType) {
      case 2: {
        const match = findFirstCandidate(
          candidates,
          (candidate) => candidate.receipt_code === cleaned,
        );
        if (match) return match;
        break;
      }
      case 4: {
        const match = findFirstCandidate(candidates, (candidate) => candidate.yj_code === cleaned);
        if (match) return match;
        break;
      }
      case 6: {
        const match = findFirstCandidate(candidates, (candidate) => candidate.hot_code === cleaned);
        if (match) return match;
        break;
      }
      case 3: {
        const match = findFirstCandidate(
          candidates,
          (candidate) => candidate.yj_code === cleaned || candidate.receipt_code === cleaned,
        );
        if (match) return match;
        break;
      }
    }
  }

  if (drugCode) {
    const cleaned = drugCode.replace(/\s/g, '');
    if (cleaned.length === 12) {
      const match = findFirstCandidate(candidates, (candidate) => candidate.yj_code === cleaned);
      if (match) return match;
    }
    if (cleaned.length === 9) {
      const match = findFirstCandidate(
        candidates,
        (candidate) => candidate.receipt_code === cleaned,
      );
      if (match) return match;
    }

    const match = findFirstCandidate(
      candidates,
      (candidate) => candidate.yj_code === cleaned || candidate.receipt_code === cleaned,
    );
    if (match) return match;
  }

  if (drugName && drugName !== '不明') {
    return findFirstCandidate(candidates, (candidate) => candidate.drug_name.includes(drugName));
  }

  return null;
}

function findFirstCandidate(
  candidates: DrugMaster[],
  predicate: (candidate: DrugMaster) => boolean,
) {
  return candidates.find(predicate) ?? null;
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
  const drugMaster = drugLookupContext.drugMasterByLine[index] ?? null;

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
    if (!med.drugCode) {
      unmatched = {
        lineIndex: index,
        drugName: med.drugName,
        drugCode: null,
        reason: 'no_code_provided',
      };
    } else {
      unmatched = {
        lineIndex: index,
        drugName: med.drugName,
        drugCode: med.drugCode,
        reason: 'code_not_found',
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
    }
  }

  const formulary: FormularyMatch = {
    lineIndex: index,
    drugName: med.drugName,
    drugCode: med.drugCode ?? null,
    inFormulary,
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
      .filter((value) => /一包|粉砕|別包|別袋|分包|PTP|ヒート|冷所|麻薬|ラベル/i.test(value))
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
    drug_code: drugMaster?.yj_code ?? med.drugCode ?? null,
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
