import { isValidDateKey, parseSourceDate } from '@/lib/validations/date-key';
import { encodeJahisShiftJis } from '@/lib/pharmacy/jahis-shift-jis';
import {
  assertJahisExportRecordOrder,
  JAHIS_EXPORT_CONTRACT_V2_6,
  serializeJahisExportRecord,
} from '@/lib/pharmacy/jahis-export-contract';

/**
 * JAHIS お薬手帳データフォーマット ver.2.6 (JAHISTC08) パーサー
 *
 * QR コードは Shift-JIS エンコードされており、複数枚に分割される場合がある。
 * 分割情報はレコード 911 で管理される（ヘッダ行ではない）。
 *
 * フォーマット概要:
 *   1行目: JAHISTC08,1（バージョン識別子）
 *   2行目以降: カンマ区切りのレコード
 *     レコード種別:
 *       1   — 患者情報
 *       2   — 患者特記
 *       5   — 調剤等年月日（調剤日）
 *       11  — 調剤-医療機関等（調剤薬局情報）
 *       15  — 調剤-医師・薬剤師
 *       51  — 処方-医療機関
 *       55  — 処方-医師
 *       201 — 薬品
 *       281 — 薬品補足
 *       291 — 薬品服用注意
 *       301 — 用法
 *       311 — 用法補足
 *       391 — 処方服用注意
 *       401 — 服用注意
 *       411 — 医療機関等提供情報
 *       421 — 残薬確認
 *       501 — 備考
 *       601 — 患者等記入
 *       701 — かかりつけ薬剤師
 *       911 — 分割制御（マルチQR）
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface JahisPatient {
  name: string; // 患者氏名（漢字）
  nameKana?: string; // 患者氏名（カナ）
  birthDate?: string; // YYYY-MM-DD
  gender?: 'male' | 'female' | 'other';
}

export interface JahisMedication {
  rpNumber?: number; // 処方グループ番号
  drugCode?: string; // 薬剤コード
  drugCodeType?: number; // コード種別: 1=なし, 2=レセ電, 3=厚労省, 4=YJ, 6=HOT
  drugName: string; // 薬剤名称
  genericName?: string; // 一般名（ver.2.5以降）
  genericCodeType?: number;
  genericCode?: string;
  dose?: string; // 1回用量
  unit?: string; // 単位
  usage?: string; // 用法テキスト（record 301 usage_name）
  usageQuantity?: string; // 用法数量（record 301 quantity, e.g. "14"）
  usageUnit?: string; // 用法単位（record 301 unit, e.g. "日分"）
  formCode?: number; // 剤形コード（record 301）
  /** @deprecated use usageQuantity + usageUnit */
  daysOrTimes?: string; // 後方互換: record 301 の quantity+unit を結合した文字列
  /** @deprecated dispensed quantity is not a separate JAHIS record */
  dispensedQuantity?: string;
  supplements: string[]; // 補足情報（record 281, 311）
  usageNotes: string[]; // 服用注意（record 291, 391）
}

export interface JahisInstitution {
  name?: string;
  prefCode?: string;
  scoreTableCode?: string;
  institutionCode?: string; // 7桁
  address?: string;
  phone?: string;
}

export interface JahisSplitInfo {
  dataId: string; // 14桁ユニークID
  splitCount: number; // 分割総数
  sequenceNumber: number; // このQRの順番
}

export interface JahisPrescriptionPublicSubsidy {
  rank: 1 | 2 | 3;
  payerNumber: string;
  recipientNumber?: string;
}

export interface JahisPrescriptionInsurance {
  insuranceType?: string;
  insurerNumber?: string;
  symbol?: string;
  number?: string;
  branchNumber?: string;
  insuredPersonType?: string;
  patientCopayRatio?: number;
  benefitRatio?: number;
  publicSubsidies: JahisPrescriptionPublicSubsidy[];
}

export interface JahisRawRecord {
  recordType: string;
  lineNumber: number;
  fields: string[];
  rawLine: string;
}

export type JahisSupplementalRecordType = '3' | '31' | '4' | '411' | '421' | '601' | '701';

export interface JahisSupplementalRecordDetail {
  label: string;
  value: string;
}

export interface JahisSupplementalRecord {
  recordType: JahisSupplementalRecordType;
  recordLabel: string;
  lineNumber: number;
  fields: string[];
  details: JahisSupplementalRecordDetail[];
  summary: string;
  rawLine: string;
}

export interface JahisQRData {
  patient: JahisPatient;
  medications: JahisMedication[];
  prescribingInstitution: JahisInstitution; // record 51: 処方-医療機関
  dispensingInstitution: JahisInstitution; // record 11: 調剤-医療機関
  dispensingPharmacist?: string; // record 15: 調剤-薬剤師名
  prescribingDoctor?: string; // record 55: 処方-医師名
  prescribingDepartment?: string; // record 55: 診療科
  dispensingDate?: string; // record 5: 調剤日 YYYY-MM-DD
  prescriptionIssueDate?: string; // JAHIS院外処方箋 record 51: 交付年月日
  prescriptionExpirationDate?: string; // JAHIS院外処方箋 record 52: 使用期限
  prescriptionInsurance?: JahisPrescriptionInsurance;
  rawRecords?: JahisRawRecord[];
  remarks: string[]; // record 401, 501
  patientNotes: string[]; // record 2
  supplementalRecords?: JahisSupplementalRecord[];
  splitInfo?: JahisSplitInfo; // record 911
  rawText: string;

  /**
   * @deprecated 後方互換のために残す。prescribingInstitution を使うこと。
   * pharmacy.institutionName = prescribingInstitution.name
   * pharmacy.institutionCode = prescribingInstitution.institutionCode
   * pharmacy.doctorName = prescribingDoctor
   */
  pharmacy: {
    institutionName?: string;
    institutionCode?: string;
    doctorName?: string;
  };
  /** @deprecated dispensingDate を使うこと */
  prescriptionDate?: string;
}

// ── Export types (buildJahisQRText 向け) ──

export interface JahisQrExportMedication {
  drugCodeType: 1 | 2 | 3 | 4 | 6;
  drugCode?: string | null;
  drugName: string;
  dose: string;
  unit: string;
  usageName: string;
  dispensingQuantity: string;
  dispensingUnit: string;
  formCode: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  usageCodeType: 1 | 2;
  usageCode?: string | null;
  genericName?: string | null;
  genericCodeType?: 1 | 2 | null;
  genericCode?: string | null;
}

export interface JahisQrExportInstitution {
  name: string;
  prefCode: string;
  scoreTableCode: '1' | '3' | '4';
  institutionCode: string;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface JahisQrExportInput {
  patient: JahisPatient;
  medications: readonly JahisQrExportMedication[];
  dispensingInstitution: JahisQrExportInstitution & { scoreTableCode: '4' };
  prescribingInstitution: JahisQrExportInstitution & { scoreTableCode: '1' | '3' };
  prescribingDoctor?: string;
  prescribingDepartment?: string;
  dispensingDate: string;
}

export type JahisQrExportPayload = {
  text: string;
  bytes: Uint8Array;
};

export type JahisQrExportPage = JahisQrExportPayload & {
  splitInfo?: JahisSplitInfo;
};

export type JahisQrPatientIdentity = {
  name: string;
  nameKana?: string;
  birthDate: string;
  gender: 'male' | 'female';
};

export type JahisQrPatientIdentityValidation =
  | { success: true; data: JahisQrPatientIdentity }
  | { success: false; reason: 'name' | 'birth_date' | 'gender' };

export interface JahisParseError {
  recordType: string;
  lineNumber: number;
  field: string;
  message: string;
}

export interface JahisParseWarning {
  recordType: string;
  field: string;
  message: string;
}

export type JahisParseResult =
  | { success: true; data: JahisQRData; warnings: JahisParseWarning[] }
  | {
      success: false;
      data: Partial<JahisQRData>;
      errors: JahisParseError[];
      warnings: JahisParseWarning[];
    };

export interface JahisDaysOrTimes {
  days?: number;
  times?: number;
  raw: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────────────────────

/**
 * JAHIS ヘッダ確認。先頭が "JAHISTC" で始まるか判定する。
 */
export function isJahisQR(text: string): boolean {
  const header = text.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? '';
  return header.startsWith('JAHISTC') || /^JAHIS\d{1,2}$/.test(header);
}

/**
 * JAHIS の日付表現を YYYY-MM-DD に変換する。
 *
 * 対応フォーマット:
 *   - YYYYMMDD (8桁, 西暦)
 *   - GYYMMDD (7桁, 日本元号: M=明治, T=大正, S=昭和, H=平成, R=令和)
 */
export function parseJahisDate(raw: string): string | undefined {
  const parsed = parseSourceDate(raw, 'jahis');
  return parsed.status === 'valid' ? parsed.dateKey : undefined;
}

const JAHIS_DATE_INVALID_MESSAGE = 'JAHIS_DATE_INVALID';

function parseJahisDateField(args: {
  raw: string;
  recordType: string;
  lineNumber: number;
  field: string;
  errors: JahisParseError[];
}) {
  const parsed = parseSourceDate(args.raw, 'jahis');
  if (parsed.status === 'valid') return parsed.dateKey;
  args.errors.push({
    recordType: args.recordType,
    lineNumber: args.lineNumber,
    field: args.field,
    message: JAHIS_DATE_INVALID_MESSAGE,
  });
  return undefined;
}

/**
 * JAHIS お薬手帳 QR テキストをパースする。
 * @param text UTF-8 デコード済みの QR テキスト
 */
export function parseJahisQR(text: string): JahisQRData {
  const result = parseJahisQRSafe(text);
  return result.success ? result.data : (result.data as JahisQRData);
}

const SUPPLEMENTAL_RECORD_LABELS: Record<JahisSupplementalRecordType, string> = {
  '3': '要指導医薬品・一般用医薬品服用',
  '31': '要指導医薬品・一般用医薬品成分',
  '4': '手帳メモ',
  '411': '医療機関等提供情報',
  '421': '残薬確認',
  '601': '患者等記入',
  '701': 'かかりつけ薬剤師',
};

const SUPPLEMENTAL_RECORD_FIELD_LABELS: Record<JahisSupplementalRecordType, string[]> = {
  '3': ['薬品名称', '服用開始年月日', '服用終了年月日', 'レコード作成者', '通番', 'JANコード'],
  '31': ['要指導・一般用薬通番', '成分名', 'コード種別', '成分コード', 'レコード作成者'],
  '4': ['手帳メモ情報', 'メモ入力年月日', 'レコード作成者'],
  '411': ['内容', '提供情報種別', 'レコード作成者'],
  '421': ['残薬内容', 'レコード作成者'],
  '601': ['患者等記入情報', '入力年月日'],
  '701': [
    'かかりつけ薬剤師氏名',
    '勤務先薬局名称',
    '連絡先',
    '担当開始日',
    '担当終了日',
    'レコード作成者',
  ],
};

export function isSupplementalRecordType(value: string): value is JahisSupplementalRecordType {
  return value in SUPPLEMENTAL_RECORD_LABELS;
}

function buildSupplementalRecordDetails(
  recordType: JahisSupplementalRecordType,
  fields: string[],
): JahisSupplementalRecordDetail[] {
  const labels = SUPPLEMENTAL_RECORD_FIELD_LABELS[recordType];
  return fields.flatMap((field, index): JahisSupplementalRecordDetail[] => {
    const value = field.trim();
    if (!value) return [];
    return [{ label: labels[index] ?? `項目${index + 1}`, value }];
  });
}

function summarizeSupplementalRecord(
  recordType: JahisSupplementalRecordType,
  fields: string[],
  details: JahisSupplementalRecordDetail[],
) {
  const detailValue = (label: string) => details.find((detail) => detail.label === label)?.value;

  switch (recordType) {
    case '3': {
      const drugName = detailValue('薬品名称');
      const startDate = detailValue('服用開始年月日');
      const endDate = detailValue('服用終了年月日');
      if (!drugName) break;
      if (startDate && endDate) return `${drugName}（${startDate} - ${endDate}）`;
      if (startDate) return `${drugName}（${startDate} から）`;
      if (endDate) return `${drugName}（${endDate} まで）`;
      return drugName;
    }
    case '31': {
      const ingredient = detailValue('成分名');
      const code = detailValue('成分コード');
      if (ingredient && code) return `${ingredient} / ${code}`;
      if (ingredient) return ingredient;
      break;
    }
    case '4':
      return detailValue('手帳メモ情報') ?? SUPPLEMENTAL_RECORD_LABELS[recordType];
    case '411':
      return detailValue('内容') ?? SUPPLEMENTAL_RECORD_LABELS[recordType];
    case '421':
      return detailValue('残薬内容') ?? SUPPLEMENTAL_RECORD_LABELS[recordType];
    case '601':
      return detailValue('患者等記入情報') ?? SUPPLEMENTAL_RECORD_LABELS[recordType];
    case '701': {
      const pharmacist = detailValue('かかりつけ薬剤師氏名');
      const pharmacy = detailValue('勤務先薬局名称');
      if (pharmacist && pharmacy) return `${pharmacist} / ${pharmacy}`;
      if (pharmacist) return pharmacist;
      break;
    }
  }

  const nonEmpty = fields.map((field) => field.trim()).filter(Boolean);
  const base = nonEmpty.slice(0, 4).join(' / ');
  return base || SUPPLEMENTAL_RECORD_LABELS[recordType];
}

function buildSupplementalRecord(args: {
  recordType: JahisSupplementalRecordType;
  fields: string[];
  lineNumber: number;
  rawLine: string;
}): JahisSupplementalRecord {
  const details = buildSupplementalRecordDetails(args.recordType, args.fields);

  return {
    recordType: args.recordType,
    recordLabel: SUPPLEMENTAL_RECORD_LABELS[args.recordType],
    lineNumber: args.lineNumber,
    fields: args.fields,
    details,
    summary: summarizeSupplementalRecord(args.recordType, args.fields, details),
    rawLine: args.rawLine,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Build (Export)
// ────────────────────────────────────────────────────────────────────────────

const JAHIS_PATIENT_NAME_PLACEHOLDERS = new Set(['患者', '氏名不明', '不明']);
const JAHIS_FORBIDDEN_FIELD_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

function hasForbiddenJahisFieldControl(value: unknown): boolean {
  return typeof value === 'string' && JAHIS_FORBIDDEN_FIELD_CONTROL_PATTERN.test(value);
}

export function validateJahisQrPatientIdentity(
  patient: Partial<JahisPatient> | null | undefined,
): JahisQrPatientIdentityValidation {
  if (
    hasForbiddenJahisFieldControl(patient?.name) ||
    hasForbiddenJahisFieldControl(patient?.nameKana)
  ) {
    return { success: false, reason: 'name' };
  }

  const name = typeof patient?.name === 'string' ? patient.name.trim() : '';
  if (!name || JAHIS_PATIENT_NAME_PLACEHOLDERS.has(name)) {
    return { success: false, reason: 'name' };
  }

  if (hasForbiddenJahisFieldControl(patient?.birthDate)) {
    return { success: false, reason: 'birth_date' };
  }

  const birthDate = normalizeJahisExportDateKey(patient?.birthDate);
  if (!birthDate) {
    return { success: false, reason: 'birth_date' };
  }

  if (patient?.gender !== 'male' && patient?.gender !== 'female') {
    return { success: false, reason: 'gender' };
  }

  const nameKana = typeof patient?.nameKana === 'string' ? patient.nameKana.trim() : '';
  return {
    success: true,
    data: {
      name,
      ...(nameKana ? { nameKana } : {}),
      birthDate,
      gender: patient.gender,
    },
  };
}

export function buildJahisQrExport(input: JahisQrExportInput): JahisQrExportPayload {
  const patientIdentity = validateJahisQrPatientIdentity(input.patient);
  if (!patientIdentity.success) {
    throw new RangeError(`JAHIS_PATIENT_IDENTITY_INVALID:${patientIdentity.reason}`);
  }

  const patient = patientIdentity.data;
  const contract = JAHIS_EXPORT_CONTRACT_V2_6;
  const lines = [`${contract.header},${contract.outputType}`];

  lines.push(
    serializeJahisExportRecord(contract.records['1'], [
      sanitizeJahisField(patient.name),
      toJahisGenderCode(patient.gender),
      formatJahisExportDate(patient.birthDate),
      '',
      '',
      '',
      '',
      '',
      '',
      sanitizeJahisField(patient.nameKana),
    ]),
  );

  lines.push(
    serializeJahisExportRecord(contract.records['5'], [
      formatJahisExportDate(input.dispensingDate),
      '1',
    ]),
  );

  const dispensingInstitution = input.dispensingInstitution;
  lines.push(
    serializeJahisExportRecord(contract.records['11'], [
      sanitizeJahisField(dispensingInstitution.name),
      sanitizeJahisField(dispensingInstitution.prefCode),
      dispensingInstitution.scoreTableCode,
      sanitizeJahisField(dispensingInstitution.institutionCode),
      sanitizeJahisField(dispensingInstitution.postalCode),
      sanitizeJahisField(dispensingInstitution.address),
      sanitizeJahisField(dispensingInstitution.phone),
      '1',
    ]),
  );

  const prescribingInstitution = input.prescribingInstitution;
  lines.push(
    serializeJahisExportRecord(contract.records['51'], [
      sanitizeJahisField(prescribingInstitution.name),
      sanitizeJahisField(prescribingInstitution.prefCode),
      prescribingInstitution.scoreTableCode,
      sanitizeJahisField(prescribingInstitution.institutionCode),
      '1',
    ]),
  );

  if (input.prescribingDoctor) {
    lines.push(
      serializeJahisExportRecord(contract.records['55'], [
        sanitizeJahisField(input.prescribingDoctor),
        sanitizeJahisField(input.prescribingDepartment),
        '1',
      ]),
    );
  }

  for (const [index, medication] of input.medications.entries()) {
    const rpNumber = String(index + 1);
    const drugCode = sanitizeJahisField(medication.drugCode);
    if ((medication.drugCodeType === 1) !== (drugCode.length === 0)) {
      throw new RangeError('JAHIS_DRUG_CODE_CONTRACT_INVALID');
    }

    const genericCodeType = medication.genericCodeType ? String(medication.genericCodeType) : '';
    const genericCode = sanitizeJahisField(medication.genericCode);
    if ((genericCodeType === '2') !== genericCode.length > 0) {
      throw new RangeError('JAHIS_GENERIC_CODE_CONTRACT_INVALID');
    }

    lines.push(
      serializeJahisExportRecord(contract.records['201'], [
        rpNumber,
        sanitizeJahisField(medication.drugName),
        sanitizeJahisField(medication.dose),
        sanitizeJahisField(medication.unit),
        String(medication.drugCodeType),
        drugCode,
        '1',
        sanitizeJahisField(medication.genericName),
        genericCodeType,
        genericCode,
      ]),
    );

    const usageCode = sanitizeJahisField(medication.usageCode);
    if ((medication.usageCodeType === 2) !== usageCode.length > 0) {
      throw new RangeError('JAHIS_USAGE_CODE_CONTRACT_INVALID');
    }
    lines.push(
      serializeJahisExportRecord(contract.records['301'], [
        rpNumber,
        sanitizeJahisField(medication.usageName),
        sanitizeJahisField(medication.dispensingQuantity),
        sanitizeJahisField(medication.dispensingUnit),
        String(medication.formCode),
        String(medication.usageCodeType),
        usageCode,
        '1',
      ]),
    );
  }

  assertJahisExportRecordOrder(lines.slice(1).map((line) => line.split(',', 1)[0]));
  const payload = `${lines.join('\r\n')}\r\n`;
  return { text: payload, bytes: encodeJahisShiftJis(payload) };
}

export function buildJahisQRText(input: JahisQrExportInput): string {
  return buildJahisQrExport(input).text;
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-QR Utilities
// ────────────────────────────────────────────────────────────────────────────

function hasEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function readCanonicalExportLines(payload: JahisQrExportPayload): string[] {
  const canonicalBytes = encodeJahisShiftJis(payload.text);
  if (!hasEqualBytes(canonicalBytes, payload.bytes)) {
    throw new RangeError('JAHIS_PAYLOAD_BYTES_MISMATCH');
  }
  if (!payload.text.endsWith('\r\n') || /(?<!\r)\n|\r(?!\n)/u.test(payload.text)) {
    throw new RangeError('JAHIS_PAYLOAD_RECORD_BOUNDARY_INVALID');
  }

  const lines = payload.text.slice(0, -2).split('\r\n');
  if (
    lines[0] !== `${JAHIS_EXPORT_CONTRACT_V2_6.header},${JAHIS_EXPORT_CONTRACT_V2_6.outputType}`
  ) {
    throw new RangeError('JAHIS_PAYLOAD_HEADER_INVALID');
  }
  if (lines.length < 2 || lines.slice(1).some((line) => !line || line.startsWith('911,'))) {
    throw new RangeError('JAHIS_PAYLOAD_RECORD_INVALID');
  }
  return lines;
}

function buildSplitExportPage(args: {
  records: readonly string[];
  dataId: string;
  splitCount: number;
  sequenceNumber: number;
}): JahisQrExportPage {
  const splitInfo: JahisSplitInfo = {
    dataId: args.dataId,
    splitCount: args.splitCount,
    sequenceNumber: args.sequenceNumber,
  };
  const splitRecord = serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['911'], [
    splitInfo.dataId,
    String(splitInfo.splitCount),
    String(splitInfo.sequenceNumber),
  ]);
  const text = [
    `${JAHIS_EXPORT_CONTRACT_V2_6.header},${JAHIS_EXPORT_CONTRACT_V2_6.outputType}`,
    ...args.records,
    splitRecord,
    '',
  ].join('\r\n');
  return { text, bytes: encodeJahisShiftJis(text), splitInfo };
}

export function splitJahisQrExport(
  payload: JahisQrExportPayload,
  options: { maxBytes: number; dataId: string; maxPages?: number },
): JahisQrExportPage[] {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new RangeError('JAHIS_QR_CAPACITY_INVALID');
  }
  if (!/^\d{14}$/u.test(options.dataId)) {
    throw new RangeError('JAHIS_SPLIT_DATA_ID_INVALID');
  }
  const maxPages = options.maxPages ?? 999;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 999) {
    throw new RangeError('JAHIS_QR_PAGE_LIMIT_INVALID');
  }

  const [, ...records] = readCanonicalExportLines(payload);
  if (payload.bytes.length <= options.maxBytes) {
    return [{ text: payload.text, bytes: payload.bytes }];
  }

  let splitCountEstimate = 2;
  let groups: string[][] = [];
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    groups = [];
    let current: string[] = [];

    for (const record of records) {
      if (groups.length >= maxPages) throw new RangeError('JAHIS_QR_SPLIT_COUNT_EXCEEDED');
      const candidate = [...current, record];
      const candidatePage = buildSplitExportPage({
        records: candidate,
        dataId: options.dataId,
        splitCount: splitCountEstimate,
        sequenceNumber: groups.length + 1,
      });
      if (candidatePage.bytes.length <= options.maxBytes) {
        current = candidate;
        continue;
      }
      if (current.length === 0) {
        throw new RangeError('JAHIS_QR_RECORD_CAPACITY_EXCEEDED');
      }
      groups.push(current);
      current = [record];
      const singleRecordPage = buildSplitExportPage({
        records: current,
        dataId: options.dataId,
        splitCount: splitCountEstimate,
        sequenceNumber: groups.length + 1,
      });
      if (singleRecordPage.bytes.length > options.maxBytes) {
        throw new RangeError('JAHIS_QR_RECORD_CAPACITY_EXCEEDED');
      }
    }
    if (current.length > 0) groups.push(current);
    if (groups.length > maxPages) throw new RangeError('JAHIS_QR_SPLIT_COUNT_EXCEEDED');
    if (groups.length === splitCountEstimate) break;
    splitCountEstimate = groups.length;
  }

  if (groups.length !== splitCountEstimate) {
    throw new RangeError('JAHIS_QR_SPLIT_COUNT_UNSTABLE');
  }

  return groups.map((group, index) =>
    buildSplitExportPage({
      records: group,
      dataId: options.dataId,
      splitCount: groups.length,
      sequenceNumber: index + 1,
    }),
  );
}

/**
 * 処方日数/回数文字列を構造化データに変換する。
 */
export function parseDaysOrTimes(raw: string): JahisDaysOrTimes {
  if (!raw || !raw.trim()) return { raw: raw || '' };
  const trimmed = raw.trim();

  // "14日分" or "14日" → days: 14
  const daysMatch = trimmed.match(/(\d+)\s*日分?/);
  if (daysMatch) return { days: parseInt(daysMatch[1], 10), raw: trimmed };

  // "5回分" or "5回" → times: 5
  const timesMatch = trimmed.match(/(\d+)\s*回分?/);
  if (timesMatch) return { times: parseInt(timesMatch[1], 10), raw: trimmed };

  // Pure number → assume days
  const numMatch = trimmed.match(/^(\d+)$/);
  if (numMatch) return { days: parseInt(numMatch[1], 10), raw: trimmed };

  // "頓服", "適量", etc. → raw only
  return { raw: trimmed };
}

/**
 * QR テキスト内のレコード 911 から分割情報を検出する。
 * 旧APIとの互換性のため、引数は text（QR全体）を受け取る。
 */
export function detectMultiQR(text: string): JahisSplitInfo | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const parts = line.split(',');
    if (parts[0] === '911') {
      return parseSplitInfoRecord(parts);
    }
  }
  return null;
}

export function hasJahisQrSplitRecord(text: string): boolean {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line.startsWith('911,'));
}

export function assessJahisQrPageAddition(
  existingPageTexts: readonly string[],
  nextPageText: string,
):
  | { success: true; splitInfo: JahisSplitInfo | null }
  | { success: false; reason: 'mixed_page_set' | 'duplicate_sequence'; sequenceNumber?: number } {
  const splitInfo = detectMultiQR(nextPageText);
  const existingSplitInfos = existingPageTexts.flatMap((pageText) => {
    const existing = detectMultiQR(pageText);
    return existing ? [existing] : [];
  });
  const isMixedPageSet = splitInfo
    ? existingSplitInfos.length !== existingPageTexts.length ||
      existingSplitInfos.some(
        (existing) =>
          existing.dataId !== splitInfo.dataId || existing.splitCount !== splitInfo.splitCount,
      )
    : existingSplitInfos.length > 0;
  if (isMixedPageSet) return { success: false, reason: 'mixed_page_set' };
  if (
    splitInfo &&
    existingSplitInfos.some((existing) => existing.sequenceNumber === splitInfo.sequenceNumber)
  ) {
    return {
      success: false,
      reason: 'duplicate_sequence',
      sequenceNumber: splitInfo.sequenceNumber,
    };
  }
  return { success: true, splitInfo };
}

function parseSplitInfoRecord(parts: string[]): JahisSplitInfo | null {
  const dataId = parts[1] ?? '';
  const splitCountText = parts[2] ?? '';
  const sequenceNumberText = parts[3] ?? '';
  const splitCount = Number(splitCountText);
  const sequenceNumber = Number(sequenceNumberText);
  if (
    parts.length !== 4 ||
    !/^\d{14}$/u.test(dataId) ||
    !/^\d{1,3}$/u.test(splitCountText) ||
    !/^\d{1,3}$/u.test(sequenceNumberText) ||
    !Number.isInteger(splitCount) ||
    splitCount <= 0 ||
    splitCount > 999 ||
    !Number.isInteger(sequenceNumber) ||
    sequenceNumber <= 0 ||
    sequenceNumber > 999 ||
    sequenceNumber > splitCount
  ) {
    return null;
  }

  return {
    dataId,
    splitCount,
    sequenceNumber,
  };
}

type JahisQrTextPage = {
  header: string;
  records: string[];
  splitInfo: JahisSplitInfo | null;
};

function readJahisQrTextPage(text: string): JahisQrTextPage {
  if (/\r(?!\n)/u.test(text)) throw new RangeError('JAHIS_PAGE_RECORD_BOUNDARY_INVALID');
  const lines = text.split(/\r?\n/u);
  while (lines.at(-1) === '') lines.pop();
  const header = lines.shift()?.trim() ?? '';
  if (!header.startsWith('JAHIS')) throw new RangeError('JAHIS_PAGE_HEADER_INVALID');

  const splitRecordIndexes = lines.flatMap((line, index) =>
    line.startsWith('911,') ? [index] : [],
  );
  if (splitRecordIndexes.length > 1) throw new RangeError('JAHIS_SPLIT_RECORD_DUPLICATE');
  const splitRecordIndex = splitRecordIndexes[0];
  if (splitRecordIndex !== undefined && splitRecordIndex !== lines.length - 1) {
    throw new RangeError('JAHIS_SPLIT_RECORD_ORDER_INVALID');
  }

  const splitInfo =
    splitRecordIndex === undefined
      ? null
      : parseSplitInfoRecord(lines[splitRecordIndex].split(','));
  if (splitRecordIndex !== undefined && !splitInfo) {
    throw new RangeError('JAHIS_SPLIT_RECORD_INVALID');
  }
  return {
    header,
    records: splitRecordIndex === undefined ? lines : lines.slice(0, splitRecordIndex),
    splitInfo,
  };
}

export function mergeJahisQrPageTexts(pageTexts: readonly string[]): string {
  if (pageTexts.length === 0) throw new RangeError('JAHIS_QR_PAGE_SET_EMPTY');
  const pages = pageTexts.map(readJahisQrTextPage);
  if (new Set(pages.map((page) => page.header)).size !== 1) {
    throw new RangeError('JAHIS_QR_PAGE_HEADER_MISMATCH');
  }

  const splitPages = pages.filter((page) => page.splitInfo !== null);
  if (splitPages.length > 0 && splitPages.length !== pages.length) {
    throw new RangeError('JAHIS_QR_PAGE_SPLIT_MIXED');
  }

  let orderedPages = pages;
  if (splitPages.length > 0) {
    const expected = splitPages[0].splitInfo;
    if (!expected || expected.splitCount !== pages.length) {
      throw new RangeError('JAHIS_QR_PAGE_COUNT_MISMATCH');
    }
    const sequences = new Set<number>();
    for (const page of splitPages) {
      const splitInfo = page.splitInfo;
      if (
        !splitInfo ||
        splitInfo.dataId !== expected.dataId ||
        splitInfo.splitCount !== expected.splitCount
      ) {
        throw new RangeError('JAHIS_QR_PAGE_ID_MISMATCH');
      }
      if (sequences.has(splitInfo.sequenceNumber)) {
        throw new RangeError('JAHIS_QR_PAGE_SEQUENCE_DUPLICATE');
      }
      sequences.add(splitInfo.sequenceNumber);
    }
    orderedPages = [...pages].sort(
      (left, right) =>
        (left.splitInfo?.sequenceNumber ?? 0) - (right.splitInfo?.sequenceNumber ?? 0),
    );
  }

  return [orderedPages[0].header, ...orderedPages.flatMap((page) => page.records), ''].join('\r\n');
}

/**
 * 複数 QR のページデータをマージして1つの JahisQRData に統合する。
 * splitInfo.sequenceNumber でソートしてからマージする。
 */
export function mergeJahisQRPages(pages: JahisQRData[]): JahisQRData {
  if (pages.length === 0) throw new Error('No QR pages to merge');
  if (pages.length === 1) return pages[0];

  if (pages.some((page) => page.splitInfo)) {
    return parseJahisQR(mergeJahisQrPageTexts(pages.map((page) => page.rawText)));
  }

  // sequenceNumber でソート（splitInfo がない場合は入力順を維持）
  const sorted = [...pages].sort((a, b) => {
    const aSeq = a.splitInfo?.sequenceNumber ?? 0;
    const bSeq = b.splitInfo?.sequenceNumber ?? 0;
    return aSeq - bSeq;
  });

  const first = sorted[0];
  const allMedications = sorted.flatMap((p) => p.medications);
  const allRemarks = sorted.flatMap((p) => p.remarks);
  const allPatientNotes = sorted.flatMap((p) => p.patientNotes);
  const allSupplementalRecords = sorted.flatMap((p) => p.supplementalRecords ?? []);
  const rawText = sorted.map((p) => p.rawText).join('\n---QR_PAGE_BREAK---\n');

  const prescribingInstitution: JahisInstitution = {
    name: sorted.find((p) => p.prescribingInstitution.name)?.prescribingInstitution.name,
    prefCode: sorted.find((p) => p.prescribingInstitution.prefCode)?.prescribingInstitution
      .prefCode,
    scoreTableCode: sorted.find((p) => p.prescribingInstitution.scoreTableCode)
      ?.prescribingInstitution.scoreTableCode,
    institutionCode: sorted.find((p) => p.prescribingInstitution.institutionCode)
      ?.prescribingInstitution.institutionCode,
    address: sorted.find((p) => p.prescribingInstitution.address)?.prescribingInstitution.address,
    phone: sorted.find((p) => p.prescribingInstitution.phone)?.prescribingInstitution.phone,
  };

  const dispensingInstitution: JahisInstitution = {
    name: sorted.find((p) => p.dispensingInstitution.name)?.dispensingInstitution.name,
    prefCode: sorted.find((p) => p.dispensingInstitution.prefCode)?.dispensingInstitution.prefCode,
    scoreTableCode: sorted.find((p) => p.dispensingInstitution.scoreTableCode)
      ?.dispensingInstitution.scoreTableCode,
    institutionCode: sorted.find((p) => p.dispensingInstitution.institutionCode)
      ?.dispensingInstitution.institutionCode,
    address: sorted.find((p) => p.dispensingInstitution.address)?.dispensingInstitution.address,
    phone: sorted.find((p) => p.dispensingInstitution.phone)?.dispensingInstitution.phone,
  };

  const prescribingDoctor = sorted.find((p) => p.prescribingDoctor)?.prescribingDoctor;
  const prescribingDepartment = sorted.find((p) => p.prescribingDepartment)?.prescribingDepartment;
  const dispensingPharmacist = sorted.find((p) => p.dispensingPharmacist)?.dispensingPharmacist;
  const dispensingDate = sorted.find((p) => p.dispensingDate)?.dispensingDate;

  return {
    patient: first.patient,
    medications: allMedications,
    prescribingInstitution,
    dispensingInstitution,
    dispensingPharmacist,
    prescribingDoctor,
    prescribingDepartment,
    dispensingDate,
    remarks: allRemarks,
    patientNotes: allPatientNotes,
    supplementalRecords: allSupplementalRecords,
    rawText,
    // 後方互換
    pharmacy: {
      institutionName: prescribingInstitution.name,
      institutionCode: prescribingInstitution.institutionCode,
      doctorName: prescribingDoctor,
    },
    prescriptionDate: undefined,
  };
}

/**
 * JAHIS QR テキストをパースし、構造化されたエラー/警告付きの結果を返す。
 */
export function parseJahisQRSafe(text: string): JahisParseResult {
  const warnings: JahisParseWarning[] = [];
  const errors: JahisParseError[] = [];

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const header = lines[0] ?? '';
  if (/^JAHIS\d{1,2}$/.test(header) && !header.startsWith('JAHISTC')) {
    return parseJahisPrescriptionQRSafe(text, lines, warnings, errors);
  }

  const patient: JahisPatient = { name: '' };
  const medications: JahisMedication[] = [];
  const prescribingInstitution: JahisInstitution = {};
  const dispensingInstitution: JahisInstitution = {};
  let dispensingPharmacist: string | undefined;
  let prescribingDoctor: string | undefined;
  let prescribingDepartment: string | undefined;
  let dispensingDate: string | undefined;
  const remarks: string[] = [];
  const patientNotes: string[] = [];
  const supplementalRecords: JahisSupplementalRecord[] = [];
  let splitInfo: JahisSplitInfo | undefined;
  let currentMed: JahisMedication | null = null;
  const rawRecords: JahisRawRecord[] = [];

  const flushMed = () => {
    if (currentMed) {
      medications.push(currentMed);
      currentMed = null;
    }
  };

  const readRpNumber = (value: string | undefined) => {
    if (!value) return undefined;
    const rpNumber = parseInt(value, 10);
    return Number.isFinite(rpNumber) ? rpNumber : undefined;
  };

  const getEokusuriMedicationTargets = (rpNumber: number | undefined) => {
    const targets = medications.filter(
      (medication) => rpNumber !== undefined && medication.rpNumber === rpNumber,
    );
    if (
      currentMed &&
      (rpNumber === undefined ||
        currentMed.rpNumber === undefined ||
        currentMed.rpNumber === rpNumber)
    ) {
      targets.push(currentMed);
    }
    return targets;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('JAHISTC')) continue;

    const parts = line.split(',');
    const recordType = parts[0];
    rawRecords.push({
      recordType,
      lineNumber: i + 1,
      fields: parts.slice(1),
      rawLine: line,
    });

    try {
      switch (recordType) {
        case '1': {
          if (parts[1]) patient.name = parts[1];
          if (parts[2]) {
            const g = parts[2].trim();
            patient.gender = g === '1' ? 'male' : g === '2' ? 'female' : 'other';
          }
          if (parts[3]) {
            patient.birthDate = parseJahisDateField({
              raw: parts[3],
              recordType,
              lineNumber: i + 1,
              field: 'birth_date',
              errors,
            });
          }
          if (parts[10]) patient.nameKana = parts[10];
          break;
        }
        case '2': {
          if (parts[2]) patientNotes.push(parts[2]);
          break;
        }
        case '5': {
          if (parts[1]) {
            dispensingDate = parseJahisDateField({
              raw: parts[1],
              recordType,
              lineNumber: i + 1,
              field: 'dispensing_date',
              errors,
            });
          }
          break;
        }
        case '11': {
          if (parts[1]) dispensingInstitution.name = parts[1];
          if (parts[2]) dispensingInstitution.prefCode = parts[2];
          if (parts[3]) dispensingInstitution.scoreTableCode = parts[3];
          if (parts[4]) dispensingInstitution.institutionCode = parts[4];
          if (parts[6]) dispensingInstitution.address = parts[6];
          if (parts[7]) dispensingInstitution.phone = parts[7];
          break;
        }
        case '15': {
          if (parts[1]) dispensingPharmacist = parts[1];
          break;
        }
        case '51': {
          if (parts[1]) prescribingInstitution.name = parts[1];
          if (parts[2]) prescribingInstitution.prefCode = parts[2];
          if (parts[3]) prescribingInstitution.scoreTableCode = parts[3];
          if (parts[4]) prescribingInstitution.institutionCode = parts[4];
          break;
        }
        case '55': {
          if (parts[1]) prescribingDoctor = parts[1];
          if (parts[2]) prescribingDepartment = parts[2];
          break;
        }
        case '201': {
          flushMed();
          const rpNumber = readRpNumber(parts[1]);
          currentMed = {
            rpNumber,
            drugCode: parts[6] || undefined,
            drugCodeType: parts[5] ? parseInt(parts[5], 10) : undefined,
            drugName: parts[2] || '不明',
            genericName: parts[8] || undefined,
            genericCodeType: parts[9] ? parseInt(parts[9], 10) : undefined,
            genericCode: parts[10] || undefined,
            dose: parts[3] || undefined,
            unit: parts[4] || undefined,
            supplements: [],
            usageNotes: [],
          };
          break;
        }
        case '281': {
          if (currentMed && parts[2]) {
            currentMed.supplements.push(parts[2]);
          }
          break;
        }
        case '291': {
          if (currentMed && parts[2]) {
            currentMed.usageNotes.push(parts[2]);
          }
          break;
        }
        case '301': {
          const targets = getEokusuriMedicationTargets(readRpNumber(parts[1]));
          for (const medication of targets) {
            if (parts[2]) medication.usage = parts[2];
            if (parts[3]) medication.usageQuantity = parts[3];
            if (parts[4]) medication.usageUnit = parts[4];
            if (parts[5]) medication.formCode = parseInt(parts[5], 10) || undefined;
            if (parts[3] && parts[4]) {
              medication.daysOrTimes = `${parts[3]}${parts[4]}`;
            } else if (parts[3]) {
              medication.daysOrTimes = parts[3];
            }
          }
          break;
        }
        case '311': {
          if (parts[2]) {
            for (const medication of getEokusuriMedicationTargets(readRpNumber(parts[1]))) {
              medication.supplements.push(parts[2]);
            }
          }
          break;
        }
        case '391': {
          if (parts[2]) {
            for (const medication of getEokusuriMedicationTargets(readRpNumber(parts[1]))) {
              medication.usageNotes.push(parts[2]);
            }
          }
          break;
        }
        case '401': {
          if (parts[1]) {
            remarks.push(parts[1]);
            warnings.push({ recordType: '401', field: 'remarks', message: parts[1] });
          }
          break;
        }
        case '501': {
          if (parts[1]) remarks.push(parts[1]);
          break;
        }
        case '3':
        case '31':
        case '4':
        case '411':
        case '421':
        case '601':
        case '701': {
          if (isSupplementalRecordType(recordType)) {
            supplementalRecords.push(
              buildSupplementalRecord({
                recordType,
                fields: parts.slice(1),
                lineNumber: i + 1,
                rawLine: line,
              }),
            );
          }
          break;
        }
        case '911': {
          splitInfo = parseSplitInfoRecord(parts) ?? splitInfo;
          break;
        }
        default:
          warnings.push({
            recordType,
            field: 'unknown',
            message: `Unknown record type ${recordType} at line ${i + 1}`,
          });
          break;
      }
    } catch (err) {
      errors.push({
        recordType,
        lineNumber: i + 1,
        field: 'parse',
        message: err instanceof Error ? err.message : `Failed to parse record type ${recordType}`,
      });
    }
  }

  flushMed();

  const data: JahisQRData = {
    patient,
    medications,
    prescribingInstitution,
    dispensingInstitution,
    dispensingPharmacist,
    prescribingDoctor,
    prescribingDepartment,
    dispensingDate,
    remarks,
    patientNotes,
    supplementalRecords,
    splitInfo,
    rawRecords,
    rawText: text,
    pharmacy: {
      institutionName: prescribingInstitution.name,
      institutionCode: prescribingInstitution.institutionCode,
      doctorName: prescribingDoctor,
    },
    prescriptionDate: undefined,
  };

  if (errors.length > 0) {
    return { success: false, data, errors, warnings };
  }

  return { success: true, data, warnings };
}

type PrescriptionRpContext = {
  usage?: string;
  usageQuantity?: string;
  usageUnit?: string;
  formCode?: number;
  supplements: string[];
};

function getPrescriptionRpContext(
  rpContexts: Map<number, PrescriptionRpContext>,
  rpNumber: number,
) {
  let context = rpContexts.get(rpNumber);
  if (!context) {
    context = { supplements: [] };
    rpContexts.set(rpNumber, context);
  }
  return context;
}

function parseJahisPrescriptionQRSafe(
  text: string,
  lines: string[],
  warnings: JahisParseWarning[],
  errors: JahisParseError[],
): JahisParseResult {
  const patient: JahisPatient = { name: '' };
  const medications: JahisMedication[] = [];
  const prescribingInstitution: JahisInstitution = {};
  const dispensingInstitution: JahisInstitution = {};
  let prescribingDoctor: string | undefined;
  let prescribingDepartment: string | undefined;
  let prescriptionIssueDate: string | undefined;
  let prescriptionExpirationDate: string | undefined;
  const remarks: string[] = [];
  const patientNotes: string[] = [];
  const rpContexts = new Map<number, PrescriptionRpContext>();
  const medicationByRpAndSequence = new Map<string, JahisMedication>();
  const prescriptionInsurance: JahisPrescriptionInsurance = { publicSubsidies: [] };
  const rawRecords: JahisRawRecord[] = [];
  let splitInfo: JahisSplitInfo | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^JAHIS\d{1,2}$/.test(line)) continue;

    const parts = line.split(',');
    const recordType = parts[0];
    rawRecords.push({
      recordType,
      lineNumber: i + 1,
      fields: parts.slice(1),
      rawLine: line,
    });

    try {
      switch (recordType) {
        case '1': {
          prescribingInstitution.scoreTableCode = parts[1] || undefined;
          prescribingInstitution.institutionCode = parts[2] || undefined;
          prescribingInstitution.prefCode = parts[3] || undefined;
          prescribingInstitution.name = parts[4] || undefined;
          break;
        }
        case '2': {
          prescribingInstitution.address = parts[2] || undefined;
          break;
        }
        case '3': {
          prescribingInstitution.phone = parts[1] || undefined;
          break;
        }
        case '4': {
          prescribingDepartment = parts[3] || parts[2] || undefined;
          break;
        }
        case '5': {
          prescribingDoctor = parts[3] || parts[2] || undefined;
          break;
        }
        case '11': {
          patient.name = parts[2] || parts[3] || '';
          patient.nameKana = parts[3] || undefined;
          break;
        }
        case '12': {
          if (parts[1]) {
            patient.gender = parts[1] === '1' ? 'male' : parts[1] === '2' ? 'female' : 'other';
          }
          break;
        }
        case '13': {
          if (parts[1]) {
            patient.birthDate = parseJahisDateField({
              raw: parts[1],
              recordType,
              lineNumber: i + 1,
              field: 'birth_date',
              errors,
            });
          }
          break;
        }
        case '21': {
          prescriptionInsurance.insuranceType = parts[1] || undefined;
          break;
        }
        case '22': {
          prescriptionInsurance.insurerNumber = parts[1] || undefined;
          break;
        }
        case '23': {
          prescriptionInsurance.symbol = parts[1] || undefined;
          prescriptionInsurance.number = parts[2] || undefined;
          prescriptionInsurance.insuredPersonType = parts[3] || undefined;
          prescriptionInsurance.branchNumber = parts[4] || undefined;
          break;
        }
        case '24': {
          const copay = parts[1] ? parseInt(parts[1], 10) : NaN;
          const benefit = parts[2] ? parseInt(parts[2], 10) : NaN;
          prescriptionInsurance.patientCopayRatio = Number.isFinite(copay) ? copay : undefined;
          prescriptionInsurance.benefitRatio = Number.isFinite(benefit) ? benefit : undefined;
          break;
        }
        case '27':
        case '28':
        case '29': {
          const rank = recordType === '27' ? 1 : recordType === '28' ? 2 : 3;
          if (parts[1]) {
            prescriptionInsurance.publicSubsidies.push({
              rank,
              payerNumber: parts[1],
              recipientNumber: parts[2] || undefined,
            });
          }
          break;
        }
        case '30': {
          if (parts[1]) {
            remarks.push(`特殊公費: ${[parts[1], parts[2]].filter(Boolean).join(' / ')}`);
          }
          break;
        }
        case '51': {
          if (parts[1]) {
            prescriptionIssueDate = parseJahisDateField({
              raw: parts[1],
              recordType,
              lineNumber: i + 1,
              field: 'prescription_issue_date',
              errors,
            });
          }
          break;
        }
        case '52': {
          if (parts[1]) {
            prescriptionExpirationDate = parseJahisDateField({
              raw: parts[1],
              recordType,
              lineNumber: i + 1,
              field: 'prescription_expiration_date',
              errors,
            });
          }
          break;
        }
        case '81': {
          if (parts[1]) remarks.push(parts[1]);
          break;
        }
        case '101': {
          const rpNumber = parts[1] ? parseInt(parts[1], 10) : NaN;
          if (Number.isFinite(rpNumber)) {
            const context = getPrescriptionRpContext(rpContexts, rpNumber);
            context.formCode = parts[2] ? parseInt(parts[2], 10) || undefined : undefined;
            context.usageQuantity = parts[4] || undefined;
            context.usageUnit = context.usageQuantity
              ? inferPrescriptionUsageUnit(context.formCode)
              : undefined;
          }
          break;
        }
        case '111': {
          const rpNumber = parts[1] ? parseInt(parts[1], 10) : NaN;
          if (Number.isFinite(rpNumber)) {
            const context = getPrescriptionRpContext(rpContexts, rpNumber);
            context.usage = parts[4] || undefined;
          }
          break;
        }
        case '181': {
          const rpNumber = parts[1] ? parseInt(parts[1], 10) : NaN;
          if (Number.isFinite(rpNumber) && parts[4]) {
            getPrescriptionRpContext(rpContexts, rpNumber).supplements.push(parts[4]);
          }
          break;
        }
        case '201': {
          const rpNumber = parts[1] ? parseInt(parts[1], 10) : NaN;
          const sequence = parts[2] ? parseInt(parts[2], 10) : NaN;
          const safeRpNumber = Number.isFinite(rpNumber) ? rpNumber : undefined;
          const context = safeRpNumber ? rpContexts.get(safeRpNumber) : undefined;
          const medication: JahisMedication = {
            rpNumber: safeRpNumber,
            drugCodeType: parts[4] ? parseInt(parts[4], 10) || undefined : undefined,
            drugCode: parts[5] || undefined,
            drugName: parts[6] || '不明',
            dose: parts[7] || undefined,
            unit: parts[9] || undefined,
            usage: context?.usage,
            usageQuantity: context?.usageQuantity,
            usageUnit: context?.usageUnit,
            daysOrTimes:
              context?.usageQuantity && context?.usageUnit
                ? `${context.usageQuantity}${context.usageUnit}`
                : undefined,
            formCode: context?.formCode,
            supplements: [...(context?.supplements ?? [])],
            usageNotes: [],
          };
          medications.push(medication);
          if (safeRpNumber && Number.isFinite(sequence)) {
            medicationByRpAndSequence.set(`${safeRpNumber}:${sequence}`, medication);
          }
          break;
        }
        case '211': {
          appendPrescriptionMedicationSupplement(medicationByRpAndSequence, parts, '単位変換係数');
          break;
        }
        case '221': {
          appendPrescriptionMedicationSupplement(medicationByRpAndSequence, parts, '不均等服用');
          break;
        }
        case '231': {
          appendPrescriptionMedicationSupplement(medicationByRpAndSequence, parts, '一日量');
          break;
        }
        case '241': {
          appendPrescriptionMedicationSupplement(medicationByRpAndSequence, parts, '薬品補足');
          break;
        }
        case '281': {
          appendPrescriptionMedicationSupplement(medicationByRpAndSequence, parts, '薬品補足');
          break;
        }
        case '911': {
          splitInfo = parseSplitInfoRecord(parts) ?? splitInfo;
          break;
        }
        default:
          warnings.push({
            recordType,
            field: 'unknown',
            message: `Unknown JAHIS prescription record type ${recordType} at line ${i + 1}`,
          });
          break;
      }
    } catch (err) {
      errors.push({
        recordType,
        lineNumber: i + 1,
        field: 'parse',
        message: err instanceof Error ? err.message : `Failed to parse record type ${recordType}`,
      });
    }
  }

  const data: JahisQRData = {
    patient,
    medications,
    prescribingInstitution,
    dispensingInstitution,
    prescribingDoctor,
    prescribingDepartment,
    dispensingDate: prescriptionIssueDate,
    prescriptionIssueDate,
    prescriptionExpirationDate,
    prescriptionInsurance,
    rawRecords,
    remarks,
    patientNotes,
    supplementalRecords: [],
    splitInfo,
    rawText: text,
    pharmacy: {
      institutionName: prescribingInstitution.name,
      institutionCode: prescribingInstitution.institutionCode,
      doctorName: prescribingDoctor,
    },
    prescriptionDate: prescriptionIssueDate,
  };

  if (errors.length > 0) {
    return { success: false, data, errors, warnings };
  }
  return { success: true, data, warnings };
}

function inferPrescriptionUsageUnit(formCode: number | undefined) {
  if (formCode === 3) return '回分';
  return '日分';
}

function appendPrescriptionMedicationSupplement(
  medicationByRpAndSequence: Map<string, JahisMedication>,
  parts: string[],
  label: string,
) {
  const rpNumber = parts[1] ? parseInt(parts[1], 10) : NaN;
  const sequence = parts[2] ? parseInt(parts[2], 10) : NaN;
  if (!Number.isFinite(rpNumber) || !Number.isFinite(sequence)) return;
  const medication = medicationByRpAndSequence.get(`${rpNumber}:${sequence}`);
  if (!medication) return;
  const values = parts.slice(3).filter((value) => value.trim().length > 0);
  if (values.length === 0) return;
  medication.supplements.push(`${label}: ${values.join(' / ')}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function sanitizeJahisField(value: string | null | undefined): string {
  const rawValue = value ?? '';
  if (JAHIS_FORBIDDEN_FIELD_CONTROL_PATTERN.test(rawValue)) {
    throw new RangeError('JAHIS_FIELD_CONTROL_CHARACTER_INVALID');
  }

  return rawValue.replace(/,/g, '，').trim();
}

function toJahisGenderCode(gender: JahisPatient['gender']): string {
  if (gender === 'male') return '1';
  if (gender === 'female') return '2';
  return '0';
}

function normalizeJahisExportDateKey(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z)?$/.exec(normalized);
  const dateKey = match?.[1];
  if (!dateKey || !isValidDateKey(dateKey)) return null;

  const [, , hours, minutes, seconds] = match;
  if (hours !== undefined && (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59)) {
    return null;
  }

  return dateKey;
}

function formatJahisExportDate(value: string | undefined): string {
  if (!value) return '';
  const dateKey = normalizeJahisExportDateKey(value);
  if (!dateKey) throw new RangeError('JAHIS_EXPORT_DATE_INVALID');
  return dateKey.replace(/-/g, '');
}
