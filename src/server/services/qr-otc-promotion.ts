import { formatUtcDateKey } from '@/lib/date-key';

type MedicationIssueForQrOtc = {
  id: string;
  patient_id: string;
  title: string;
  description: string;
  category: string | null;
};

type Tx = {
  patient: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  drugMaster?: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  medicationProfile: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

type QrOtcCandidate = {
  drug_name: string;
  jan_code: string | null;
  start_date: Date | null;
  end_date: Date | null;
};

const QR_OTC_TITLE_PATTERN = /QR由来のOTC・一般用薬確認候補/;
const QR_SUPPLEMENTAL_MARKER_PATTERN = /\[qr_supplemental:[^:\]]+:([^:\]]+):[^\]]+\]/;
const BOILERPLATE_LINE_PATTERN = /(自動起票したレビュー候補|確定情報として扱う前に)/;
const NON_DRUG_NAME_PATTERN = /^(なし|無し|ない|無い|不明|未確認|特になし|特に無し)$/;

function readQrSupplementalRecordType(text: string) {
  return text.match(QR_SUPPLEMENTAL_MARKER_PATTERN)?.[1] ?? null;
}

function clinicalLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('[qr_supplemental:'))
    .filter((line) => !BOILERPLATE_LINE_PATTERN.test(line));
}

function normalizeDrugName(value: string) {
  return value
    .replace(/^(薬品名称|薬剤名|薬品名|医薬品|お薬|薬)[:：]\s*/, '')
    .replace(/[「」『』（）()【】]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readDrugName(value: string | undefined) {
  if (!value) return null;
  const normalized = normalizeDrugName(value);
  if (!normalized || NON_DRUG_NAME_PATTERN.test(normalized)) return null;
  if (normalized.length > 120) return null;
  return normalized;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  const separated = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const match = compact ?? separated;
  if (!match) return null;
  const [, year, month, day] = match;
  const dateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || formatUtcDateKey(date) !== dateKey ? null : date;
}

function readJanCode(value: string | null | undefined) {
  const normalized = value?.replace(/[\s-]/g, '') ?? '';
  return /^(\d{8}|\d{13})$/.test(normalized) ? normalized : null;
}

function extractLabeledValue(lines: string[], labels: string[]) {
  for (const line of lines) {
    const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (match?.[1] && labels.includes(match[1].trim()) && match[2]) return match[2].trim();
  }
  return null;
}

function extractRawLineField(lines: string[], index: number) {
  const rawLine = lines.find((line) => line.startsWith('3,'));
  return rawLine?.split(',')[index]?.trim() || null;
}

function extractRawLineJanCode(lines: string[]) {
  const rawLine = lines.find((line) => line.startsWith('3,'));
  if (!rawLine) return null;
  const fields = rawLine.split(',').map((field) => field.trim());
  const candidates = fields
    .slice(4)
    .map(readJanCode)
    .filter((value): value is string => Boolean(value));
  return candidates.find((value) => value.length === 13) ?? candidates[0] ?? null;
}

export function extractQrOtcCandidate(text: string): QrOtcCandidate | null {
  const lines = clinicalLines(text);
  const drugName = readDrugName(
    extractLabeledValue(lines, ['薬品名称', '薬剤名', '薬品名']) ??
      extractRawLineField(lines, 1) ??
      lines[0],
  );
  if (!drugName) return null;

  const startDate = parseDate(
    extractLabeledValue(lines, ['服用開始年月日', '開始日']) ??
      extractRawLineField(lines, 2) ??
      undefined,
  );
  const endDate = parseDate(
    extractLabeledValue(lines, ['服用終了年月日', '終了日']) ??
      extractRawLineField(lines, 3) ??
      undefined,
  );

  if (startDate && endDate && endDate.getTime() < startDate.getTime()) return null;

  const janCode =
    readJanCode(extractLabeledValue(lines, ['JANコード', 'JAN'])) ?? extractRawLineJanCode(lines);

  return { drug_name: drugName, jan_code: janCode, start_date: startDate, end_date: endDate };
}

export function buildQrOtcMedicationProfileFromIssue(args: {
  issue: MedicationIssueForQrOtc;
}): QrOtcCandidate | null {
  if (args.issue.category !== 'other') return null;
  if (!QR_OTC_TITLE_PATTERN.test(args.issue.title)) return null;
  if (readQrSupplementalRecordType(args.issue.description) !== '3') return null;
  return extractQrOtcCandidate(args.issue.description);
}

export async function promoteResolvedQrOtcIssueToMedicationProfile(
  tx: Tx,
  args: {
    orgId: string;
    issue: MedicationIssueForQrOtc;
    confirmedAt: Date;
  },
) {
  const candidate = buildQrOtcMedicationProfileFromIssue({ issue: args.issue });
  if (!candidate) return { promoted: false as const, reason: 'not_qr_otc_candidate' as const };
  if (!candidate.start_date) {
    return { promoted: false as const, reason: 'start_date_required' as const };
  }
  if (candidate.end_date && candidate.end_date.getTime() < args.confirmedAt.getTime()) {
    return { promoted: false as const, reason: 'already_ended' as const };
  }

  const patient = await tx.patient.findFirst({
    where: { id: args.issue.patient_id, org_id: args.orgId },
    select: { id: true },
  });
  if (!patient) return { promoted: false as const, reason: 'patient_not_found' as const };

  const drugMaster = candidate.jan_code
    ? ((await tx.drugMaster?.findFirst({
        where: { jan_code: candidate.jan_code },
        select: { id: true },
      })) ?? null)
    : null;
  const drugMasterId = drugMaster?.id ?? null;
  const duplicateWhere = [
    ...(drugMasterId ? [{ drug_master_id: drugMasterId }] : []),
    { drug_master_id: null, drug_name: candidate.drug_name },
  ];
  const existing = await tx.medicationProfile.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: patient.id,
      is_current: true,
      source: 'otc_qr',
      OR: duplicateWhere,
    },
    select: { id: true },
  });
  if (existing) return { promoted: false as const, reason: 'duplicate_current_profile' as const };

  await tx.medicationProfile.create({
    data: {
      org_id: args.orgId,
      patient_id: patient.id,
      drug_name: candidate.drug_name,
      drug_master_id: drugMasterId,
      dose: null,
      frequency: null,
      start_date: candidate.start_date,
      end_date: candidate.end_date,
      prescriber: null,
      is_current: true,
      source: 'otc_qr',
    },
  });

  return { promoted: true as const, candidate };
}
