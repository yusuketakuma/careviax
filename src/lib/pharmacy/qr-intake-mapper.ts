/**
 * QR→PrescriptionIntake マッパー
 *
 * JAHIS QRデータを PrescriptionIntake + PrescriptionLine 入力に変換する。
 * DrugMaster から薬品情報を自動補完し、PharmacyDrugStock で採用薬を優先表示する。
 * PrescriberInstitution を QR の処方元医療機関情報から検索・自動登録する。
 */

import { prisma } from '@/lib/db/client';
import type { JahisQRData, JahisMedication } from './jahis-qr';
import { parseDaysOrTimes } from './jahis-qr';

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
  route: string | null;
  dispensing_method: string | null;
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

// ── Main Function ──

export async function mapJahisToIntake(
  qrData: JahisQRData,
  input: QrToIntakeInput,
): Promise<QrToIntakeResult> {
  const autoCompletedFields: AutoCompletedField[] = [];
  const unmatchedDrugs: UnmatchedDrug[] = [];
  const formularyStatus: FormularyMatch[] = [];
  const lines: QrIntakeLineInput[] = [];

  for (let i = 0; i < qrData.medications.length; i++) {
    const med = qrData.medications[i];
    const { line, autoCompleted, unmatched, formulary } = await mapMedicationLine(
      med,
      i,
      input.siteId,
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
    prescriberInstitution: institution.prescriberInstitutionName ?? qrData.prescribingInstitution.name ?? null,
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
    return { prescriberInstitutionId: null, prescriberInstitutionName: null, isNewlyRegistered: false };
  }

  // 1. Search by institution_code (most reliable)
  if (institutionCode) {
    const byCode = await prisma.prescriberInstitution.findFirst({
      where: { org_id: orgId, institution_code: institutionCode },
    });
    if (byCode) {
      return { prescriberInstitutionId: byCode.id, prescriberInstitutionName: byCode.name, isNewlyRegistered: false };
    }
  }

  // 2. Search by name (exact match)
  if (institutionName) {
    const byName = await prisma.prescriberInstitution.findFirst({
      where: { org_id: orgId, name: institutionName },
    });
    if (byName) {
      return { prescriberInstitutionId: byName.id, prescriberInstitutionName: byName.name, isNewlyRegistered: false };
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

async function mapMedicationLine(
  med: JahisMedication,
  index: number,
  siteId: string,
): Promise<{
  line: Omit<QrIntakeLineInput, 'line_number'>;
  autoCompleted: AutoCompletedField[];
  unmatched: UnmatchedDrug | null;
  formulary: FormularyMatch;
}> {
  const autoCompleted: AutoCompletedField[] = [];
  let unmatched: UnmatchedDrug | null = null;

  // Parse days/times — prefer usageQuantity+usageUnit (record 301), fall back to daysOrTimes
  const daysOrTimesRaw = med.usageQuantity && med.usageUnit
    ? `${med.usageQuantity}${med.usageUnit}`
    : (med.daysOrTimes ?? null);
  const daysOrTimes = daysOrTimesRaw ? parseDaysOrTimes(daysOrTimesRaw) : null;
  const days = daysOrTimes?.days ?? null;

  // Build dose string
  const dose = med.dose
    ? med.unit
      ? `${med.dose}${med.unit}`
      : med.dose
    : '';

  // DrugMaster lookup (drugCodeType-aware)
  const drugMaster = await lookupDrugMaster(med.drugCode, med.drugCodeType, med.drugName);

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
    const stock = await prisma.pharmacyDrugStock.findFirst({
      where: {
        site_id: siteId,
        drug_master_id: drugMaster.id,
        is_stocked: true,
      },
    });
    if (stock) {
      inFormulary = true;
      preferredGenericId = stock.preferred_generic_id;
      stockQty = stock.stock_qty;

      // Look up preferred generic name
      if (stock.preferred_generic_id) {
        const generic = await prisma.drugMaster.findFirst({
          where: { id: stock.preferred_generic_id },
          select: { drug_name: true },
        });
        preferredGenericName = generic?.drug_name ?? null;
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
    packaging_method: null,
    route: null,
    dispensing_method: null,
    notes: null,
  };

  return { line, autoCompleted, unmatched, formulary };
}

/**
 * DrugMaster lookup strategy (drugCodeType-aware):
 * - drugCodeType 2 → レセ電算コード (receipt_code)
 * - drugCodeType 3 → 厚労省コード (try yj_code + receipt_code)
 * - drugCodeType 4 → YJコード (yj_code)
 * - drugCodeType 6 → HOTコード (hot_code)
 * - no drugCodeType → length-based heuristic (12桁=YJ, 9桁=レセ電)
 * - fallback: drugName 部分一致（確度低）
 */
async function lookupDrugMaster(
  drugCode: string | undefined,
  drugCodeType: number | undefined,
  drugName: string,
) {
  if (drugCode && drugCodeType && drugCodeType !== 1) {
    const cleaned = drugCode.replace(/\s/g, '');

    switch (drugCodeType) {
      case 2: { // レセ電算コード
        const match = await prisma.drugMaster.findFirst({
          where: { receipt_code: cleaned },
        });
        if (match) return match;
        break;
      }
      case 4: { // YJコード
        const match = await prisma.drugMaster.findFirst({
          where: { yj_code: cleaned },
        });
        if (match) return match;
        break;
      }
      case 6: { // HOTコード
        const match = await prisma.drugMaster.findFirst({
          where: { hot_code: cleaned },
        });
        if (match) return match;
        break;
      }
      case 3: { // 厚労省コード — try both YJ and receipt
        const match = await prisma.drugMaster.findFirst({
          where: { OR: [{ yj_code: cleaned }, { receipt_code: cleaned }] },
        });
        if (match) return match;
        break;
      }
    }
  }

  // Fallback: try by code length (for QR without drugCodeType)
  if (drugCode) {
    const cleaned = drugCode.replace(/\s/g, '');
    if (cleaned.length === 12) {
      const match = await prisma.drugMaster.findFirst({ where: { yj_code: cleaned } });
      if (match) return match;
    }
    if (cleaned.length === 9) {
      const match = await prisma.drugMaster.findFirst({ where: { receipt_code: cleaned } });
      if (match) return match;
    }
    // Try any code field for other lengths
    const match = await prisma.drugMaster.findFirst({
      where: { OR: [{ yj_code: cleaned }, { receipt_code: cleaned }] },
    });
    if (match) return match;
  }

  // Last resort: name match (low confidence)
  if (drugName && drugName !== '不明') {
    return prisma.drugMaster.findFirst({
      where: { drug_name: { contains: drugName } },
    });
  }

  return null;
}
