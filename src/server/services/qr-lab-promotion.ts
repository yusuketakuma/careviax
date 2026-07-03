import type { LabAnalyteCode, Prisma } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { allocateDisplayIdRange } from '@/lib/db/display-id';

type MedicationIssueForQrLab = {
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
  patientLabObservation: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

type QrLabCandidate = {
  analyte_code: LabAnalyteCode;
  value_numeric: number;
  unit: string | null;
  measured_at: Date | null;
};

const QR_SUPPLEMENTAL_MARKER_PATTERN = /\[qr_supplemental:[^\]]+\]/;
const QR_LAB_TITLE_PATTERN = /QR由来の検査値・腎機能確認候補/;
const BOILERPLATE_LINE_PATTERN = /(自動起票したレビュー候補|確定情報として扱う前に)/;
const UNCERTAIN_LAB_LINE_PATTERN = /(前回|予定|確認予定|不明|記憶|未測定|くらい|ぐらい|約|[?？])/;
const AMBIGUOUS_K_CONTEXT_PATTERN = /(ビタミン\s*K|vitamin\s*K)/i;
const NUMERIC_VALUE_PATTERN = '([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))';

const LAB_PATTERNS: Array<{
  analyte_code: LabAnalyteCode;
  unit: string | null;
  pattern: RegExp;
}> = [
  {
    analyte_code: 'egfr',
    unit: 'mL/min/1.73m2',
    pattern: new RegExp(`(?:eGFR|egfr|ＥＧＦＲ)\\s*(?:[:：=]?\\s*)${NUMERIC_VALUE_PATTERN}`, 'i'),
  },
  {
    analyte_code: 'scr',
    unit: 'mg/dL',
    pattern: new RegExp(
      `(?:\\b(?:s?cr|CRE|Cre)\\b|クレアチニン|血清クレアチニン)\\s*(?:[:：=]?\\s*)${NUMERIC_VALUE_PATTERN}\\s*(?:mg/dL|mg\\/dl|ｍｇ\\/ｄＬ)`,
      'i',
    ),
  },
  {
    analyte_code: 'k',
    unit: 'mEq/L',
    pattern: new RegExp(
      `(?:\\bK\\b|Ｋ|K値|カリウム)\\s*(?:[:：=]?\\s*)${NUMERIC_VALUE_PATTERN}`,
      'i',
    ),
  },
  {
    analyte_code: 'pt_inr',
    unit: null,
    pattern: new RegExp(
      `(?:PT-?INR|ＰＴ-?ＩＮＲ|\\bINR\\b)\\s*(?:[:：=]?\\s*)${NUMERIC_VALUE_PATTERN}`,
      'i',
    ),
  },
];

function normalizeNumericText(value: string) {
  return value.replace(/[０-９．－＋]/g, (char) => {
    const offset = '０'.charCodeAt(0);
    const code = char.charCodeAt(0);
    if (code >= offset && code <= offset + 9) return String(code - offset);
    if (char === '．') return '.';
    if (char === '－') return '-';
    if (char === '＋') return '+';
    return char;
  });
}

function readQrSupplementalMarker(text: string) {
  return text.match(QR_SUPPLEMENTAL_MARKER_PATTERN)?.[0] ?? null;
}

function clinicalLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('[qr_supplemental:'))
    .filter((line) => !BOILERPLATE_LINE_PATTERN.test(line));
}

function parseDateKey(value: string) {
  const match = value.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const dateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || formatUtcDateKey(date) !== dateKey ? null : date;
}

function readMeasuredAt(line: string, confirmedAt?: Date) {
  const measuredAt = parseDateKey(line);
  if (!measuredAt) return null;
  if (confirmedAt && measuredAt.getTime() > confirmedAt.getTime()) return null;
  return measuredAt;
}

function isPlausibleLabValue(candidate: QrLabCandidate) {
  const value = candidate.value_numeric;
  if (!Number.isFinite(value)) return false;
  if (candidate.analyte_code === 'egfr') return value > 0 && value <= 200;
  if (candidate.analyte_code === 'scr') return value >= 0.1 && value <= 20;
  if (candidate.analyte_code === 'k') return value >= 1.5 && value <= 8;
  if (candidate.analyte_code === 'pt_inr') return value >= 0.5 && value <= 10;
  return false;
}

export function extractQrLabCandidates(text: string, confirmedAt?: Date): QrLabCandidate[] {
  const found = new Map<LabAnalyteCode, QrLabCandidate>();
  for (const line of clinicalLines(normalizeNumericText(text))) {
    if (UNCERTAIN_LAB_LINE_PATTERN.test(line)) continue;
    if (AMBIGUOUS_K_CONTEXT_PATTERN.test(line)) continue;
    for (const definition of LAB_PATTERNS) {
      if (found.has(definition.analyte_code)) continue;
      const match = line.match(definition.pattern);
      const value = match?.[1] ? Number(match[1]) : NaN;
      const candidate = {
        analyte_code: definition.analyte_code,
        value_numeric: value,
        unit: definition.unit,
        measured_at: readMeasuredAt(line, confirmedAt),
      };
      if (isPlausibleLabValue(candidate)) found.set(definition.analyte_code, candidate);
    }
  }
  return [...found.values()];
}

export function buildQrLabObservationsFromMedicationIssue(args: {
  issue: MedicationIssueForQrLab;
  confirmedAt: Date;
}) {
  const { issue, confirmedAt } = args;
  if (issue.category !== 'other') return [];
  if (!QR_LAB_TITLE_PATTERN.test(issue.title)) return [];
  const marker = readQrSupplementalMarker(issue.description);
  if (!marker) return [];

  return extractQrLabCandidates(issue.description, confirmedAt).flatMap((candidate) => {
    if (!candidate.measured_at) return [];
    return [
      {
        ...candidate,
        measured_at: candidate.measured_at,
        source_type: 'import' as const,
        note: [marker, `medication_issue_id=${issue.id}`, `analyte=${candidate.analyte_code}`]
          .filter(Boolean)
          .join(' '),
      },
    ];
  });
}

export async function promoteResolvedQrLabIssueToPatientLabs(
  tx: Tx,
  args: {
    orgId: string;
    issue: MedicationIssueForQrLab;
    confirmedAt: Date;
  },
) {
  const observations = buildQrLabObservationsFromMedicationIssue({
    issue: args.issue,
    confirmedAt: args.confirmedAt,
  });
  if (observations.length === 0) {
    return { promotedCount: 0, reason: 'not_qr_lab_candidate' as const };
  }

  const patient = await tx.patient.findFirst({
    where: { id: args.issue.patient_id, org_id: args.orgId },
    select: { id: true },
  });
  if (!patient) return { promotedCount: 0, reason: 'patient_not_found' as const };

  const observationsToCreate: typeof observations = [];
  for (const observation of observations) {
    const existing = await tx.patientLabObservation.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: patient.id,
        analyte_code: observation.analyte_code,
        note: { contains: observation.note.split(' medication_issue_id=')[0] },
      },
      select: { id: true },
    });
    if (existing) continue;
    observationsToCreate.push(observation);
  }

  const displayIds =
    observationsToCreate.length > 0
      ? await allocateDisplayIdRange(
          tx as unknown as Prisma.TransactionClient,
          'PatientLabObservation',
          args.orgId,
          observationsToCreate.length,
        )
      : [];

  let promotedCount = 0;
  for (const [index, observation] of observationsToCreate.entries()) {
    const displayId = displayIds[index];
    if (!displayId) throw new Error('PatientLabObservation display_id allocation range is short');
    await tx.patientLabObservation.create({
      data: {
        display_id: displayId,
        org_id: args.orgId,
        patient_id: patient.id,
        analyte_code: observation.analyte_code,
        measured_at: observation.measured_at,
        value_numeric: observation.value_numeric,
        value_text: null,
        unit: observation.unit,
        abnormal_flag: null,
        reference_low: null,
        reference_high: null,
        source_type: observation.source_type,
        source_visit_record_id: null,
        note: observation.note,
      },
    });
    promotedCount += 1;
  }

  return { promotedCount, observations };
}
