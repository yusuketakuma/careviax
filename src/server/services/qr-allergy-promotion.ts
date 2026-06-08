import { Prisma } from '@prisma/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { allergyEntrySchema, type AllergyEntry } from '@/lib/validations/patient-allergy';

type MedicationIssueForQrAllergy = {
  id: string;
  patient_id: string;
  title: string;
  description: string;
  category: string | null;
};

type Tx = {
  patient: {
    findFirst(args: unknown): Promise<{ id: string; allergy_info: Prisma.JsonValue | null } | null>;
    update(args: unknown): Promise<unknown>;
  };
};

const QR_SUPPLEMENTAL_MARKER_PATTERN = /\[qr_supplemental:[^\]]+\]/;
const QR_ALLERGY_TITLE_PATTERN = /QR由来のアレルギー・副作用歴確認候補/;
const ALLERGY_REACTION_PATTERN =
  /(アレルギ|アナフィラ|発疹|じんましん|蕁麻疹|喘息|息苦し|かゆみ|掻痒)/;
const NON_DRUG_NAME_PATTERN =
  /^(なし|無し|ない|無い|なしです|無しです|不明|未確認|不詳|特になし|特に無し|記載なし|記載無し)$/;
const BOILERPLATE_DRUG_NAME_PATTERN = /(自動起票|レビュー候補|確認|レコード|補助レコード)/;

function normalizeDrugName(value: string) {
  return value
    .replace(/^(薬剤名|薬品名|原因薬|原因薬剤|医薬品|お薬|薬)[:：]\s*/, '')
    .replace(/[「」『』（）()【】]/g, '')
    .trim();
}

function readExtractedDrugName(value: string | undefined) {
  if (!value) return null;
  const normalized = normalizeDrugName(value);
  if (!normalized) return null;
  if (NON_DRUG_NAME_PATTERN.test(normalized)) return null;
  if (BOILERPLATE_DRUG_NAME_PATTERN.test(normalized)) return null;
  return normalized;
}

export function extractQrAllergyDrugName(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const clinicalLines = lines.filter(
    (line) =>
      !line.startsWith('[qr_supplemental:') &&
      !line.includes('自動起票したレビュー候補') &&
      !line.includes('確定情報として扱う前に'),
  );

  for (const line of clinicalLines) {
    const labeled = line.match(
      /(?:薬剤名|薬品名|原因薬|原因薬剤|医薬品|お薬|薬)[:：]\s*([^、,。;\s]+)/,
    );
    const drugName = readExtractedDrugName(labeled?.[1]);
    if (drugName) return drugName;
  }

  for (const line of clinicalLines) {
    const causal = line.match(
      /([^\s、,。;:：]{2,40}?)(?:で|により|による|服用後|使用後).{0,40}?(?:アレルギ|アナフィラ|発疹|じんましん|蕁麻疹|喘息|息苦し|かゆみ|掻痒)/,
    );
    const drugName = readExtractedDrugName(causal?.[1]);
    if (drugName) return drugName;
  }

  const joined = clinicalLines.join('。');
  const allergyPrefix = joined.match(/(?:アレルギー|副作用)[:：]\s*([^、,。;\s]+)/);
  const drugName = readExtractedDrugName(allergyPrefix?.[1]);
  if (drugName) return drugName;

  return null;
}

export function buildQrAllergyEntryFromMedicationIssue(args: {
  issue: MedicationIssueForQrAllergy;
  confirmedAt: Date;
}): AllergyEntry | null {
  const { issue, confirmedAt } = args;
  if (issue.category !== 'side_effect') return null;
  if (!QR_ALLERGY_TITLE_PATTERN.test(issue.title)) return null;
  if (!QR_SUPPLEMENTAL_MARKER_PATTERN.test(issue.description)) return null;
  if (!ALLERGY_REACTION_PATTERN.test(issue.description)) return null;

  const drugName = extractQrAllergyDrugName(issue.description);
  if (!drugName) return null;

  const dateKey = confirmedAt.toISOString().slice(0, 10);
  const entry = {
    drug_name: drugName,
    category: 'drug',
    severity: 'unknown',
    confirmed_at: dateKey,
    source: `qr_supplemental:${issue.id}`,
  };
  return allergyEntrySchema.parse(entry);
}

function readAllergyRawEntries(value: Prisma.JsonValue | null): Prisma.JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function readAllergyEntries(entries: Prisma.JsonValue[]): AllergyEntry[] {
  return entries.flatMap((item) => {
    const parsed = allergyEntrySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function hasSameQrAllergySource(entries: AllergyEntry[], source: string) {
  return entries.some((entry) => entry.source === source);
}

function readRawDrugName(value: Prisma.JsonValue) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const drugName = value.drug_name;
  return typeof drugName === 'string' ? readExtractedDrugName(drugName) : null;
}

function hasSameQrAllergyDrugName(entries: Prisma.JsonValue[], drugName: string) {
  return entries.some((entry) => readRawDrugName(entry) === drugName);
}

export async function promoteResolvedQrAllergyIssueToPatient(
  tx: Tx,
  args: {
    orgId: string;
    issue: MedicationIssueForQrAllergy;
    confirmedAt: Date;
  },
) {
  const entry = buildQrAllergyEntryFromMedicationIssue({
    issue: args.issue,
    confirmedAt: args.confirmedAt,
  });
  if (!entry) return { promoted: false as const, reason: 'not_qr_allergy_candidate' as const };

  const patient = await tx.patient.findFirst({
    where: { id: args.issue.patient_id, org_id: args.orgId },
    select: { id: true, allergy_info: true },
  });
  if (!patient) return { promoted: false as const, reason: 'patient_not_found' as const };

  const rawEntries = readAllergyRawEntries(patient.allergy_info);
  const existingEntries = readAllergyEntries(rawEntries);
  if (entry.source && hasSameQrAllergySource(existingEntries, entry.source)) {
    return { promoted: false as const, reason: 'duplicate_source' as const };
  }
  if (hasSameQrAllergyDrugName(rawEntries, entry.drug_name)) {
    return { promoted: false as const, reason: 'duplicate_drug_name' as const };
  }

  await tx.patient.update({
    where: { id: patient.id },
    data: {
      allergy_info: toPrismaJsonInput([...rawEntries, entry]),
    },
  });

  return { promoted: true as const, entry };
}
