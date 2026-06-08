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
  drugCode?: string | null;
  drugName: string;
  dose?: string | null;
  unit?: string | null;
  frequency?: string | null;
  daysOrTimes?: string | null;
  dispensedQuantity?: string | null;
}

export interface JahisQrExportInput {
  patient: JahisPatient;
  medications: JahisQrExportMedication[];
  /** @deprecated prescribingInstitution を使うこと */
  pharmacy?: {
    institutionCode?: string;
    institutionName?: string;
    doctorName?: string;
  };
  prescribingInstitution?: JahisInstitution;
  prescribingDoctor?: string;
  prescribingDepartment?: string;
  /** @deprecated dispensingDate を使うこと */
  prescriptionDate?: string;
  dispensingDate?: string;
}

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
// Shift-JIS Decoder (via @zxing/text-encoding)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Shift-JIS バイト列を UTF-8 文字列にデコードする。
 */
export async function decodeShiftJIS(bytes: Uint8Array): Promise<string> {
  try {
    const decoder = new TextDecoder('shift-jis');
    return decoder.decode(bytes);
  } catch {
    const { TextDecoder: ZxingDecoder } = await import('@zxing/text-encoding');
    const decoder = new ZxingDecoder('shift-jis');
    return decoder.decode(bytes);
  }
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
 *   - YYYY/MM/DD (スラッシュ区切り)
 *   - GYYMMDD (7桁, 日本元号: M=明治, T=大正, S=昭和, H=平成, R=令和)
 */
export function parseJahisDate(raw: string): string | undefined {
  const cleaned = raw.replace(/\//g, '').trim();

  // 日本元号フォーマット: GYYMMDD (7文字)
  if (cleaned.length === 7) {
    const era = cleaned[0].toUpperCase();
    const eraYear = parseInt(cleaned.substring(1, 3), 10);
    const m = cleaned.substring(3, 5);
    const d = cleaned.substring(5, 7);

    const eraOffsets: Record<string, number> = {
      M: 1867,
      T: 1911,
      S: 1925,
      H: 1988,
      R: 2018,
    };
    const offset = eraOffsets[era];
    if (offset !== undefined && !isNaN(eraYear)) {
      const year = offset + eraYear;
      const month = parseInt(m, 10);
      const day = parseInt(d, 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${m}-${d}`;
      }
    }
    return undefined;
  }

  // 西暦フォーマット: YYYYMMDD (8文字)
  if (cleaned.length === 8) {
    const y = cleaned.substring(0, 4);
    const m = cleaned.substring(4, 6);
    const d = cleaned.substring(6, 8);

    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return undefined;
    }
    return `${y}-${m}-${d}`;
  }

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

// ────────────────────────────────────────────────────────────────────────────
// Build (Export)
// ────────────────────────────────────────────────────────────────────────────

export function buildJahisQRText_placeholder_removed(): never {
  throw new Error('unreachable');
}

function getInstitutionName(institution?: JahisInstitution | JahisQrExportInput['pharmacy']) {
  if (!institution) return undefined;
  const legacyInstitution = institution as JahisQrExportInput['pharmacy'];
  if (legacyInstitution?.institutionName !== undefined) {
    return legacyInstitution.institutionName;
  }
  return (institution as JahisInstitution).name;
}

function getInstitutionCode(institution?: JahisInstitution | JahisQrExportInput['pharmacy']) {
  if (!institution) return undefined;
  return institution.institutionCode;
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

export function buildJahisQRText(input: JahisQrExportInput): string {
  const lines = ['JAHISTC08,1'];

  // Record 1: 患者情報
  // 1,<name>,<gender>,<birthdate>,<zip>,<address>,<phone>,<emergency>,<blood_type>,<weight>,<name_kana>
  lines.push(
    [
      '1',
      sanitizeJahisField(input.patient.name),
      toJahisGenderCode(input.patient.gender),
      formatJahisExportDate(input.patient.birthDate),
      '', // zip
      '', // address
      '', // phone
      '', // emergency
      '', // blood_type
      '', // weight
      sanitizeJahisField(input.patient.nameKana),
    ].join(','),
  );

  // 調剤日 (Record 5)
  const dispensingDate = input.dispensingDate;
  if (dispensingDate) {
    lines.push(`5,${formatJahisExportDate(dispensingDate)},1`);
  }

  // 調剤薬局（Record 11）— 後方互換: pharmacy から prescribingInstitution を流用しない
  // (exportは処方元のみ出力する)

  // 処方-医療機関 (Record 51)
  const presInst = input.prescribingInstitution ?? input.pharmacy;
  const presInstName = getInstitutionName(presInst) ?? input.pharmacy?.institutionName ?? '';
  const presInstCode = getInstitutionCode(presInst) ?? input.pharmacy?.institutionCode ?? '';
  if (presInstName || presInstCode) {
    lines.push(
      [
        '51',
        sanitizeJahisField(presInstName),
        '', // pref_code
        '', // score_table_code
        sanitizeJahisField(presInstCode),
        '1', // creator
      ].join(','),
    );
  }

  // 処方-医師 (Record 55)
  const doctorName = input.prescribingDoctor ?? input.pharmacy?.doctorName;
  if (doctorName) {
    lines.push(
      [
        '55',
        sanitizeJahisField(doctorName),
        sanitizeJahisField(input.prescribingDepartment),
        '1',
      ].join(','),
    );
  }

  // 薬品 (Record 201, 301)
  for (let i = 0; i < input.medications.length; i++) {
    const medication = input.medications[i];
    const rp = i + 1;
    lines.push(
      [
        '201',
        String(rp),
        sanitizeJahisField(medication.drugName),
        sanitizeJahisField(medication.dose),
        sanitizeJahisField(medication.unit),
        '1', // code_type: none (簡易エクスポート)
        sanitizeJahisField(medication.drugCode),
        '1', // creator
      ].join(','),
    );

    // 用法 (Record 301)
    if (medication.frequency || medication.daysOrTimes) {
      lines.push(
        [
          '301',
          String(rp),
          sanitizeJahisField(medication.frequency),
          sanitizeJahisField(medication.daysOrTimes),
          '', // unit
          '1', // form_code: 内服
          '', // usage_code_type
          '', // usage_code
          '1', // creator
        ].join(','),
      );
    }
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-QR Utilities
// ────────────────────────────────────────────────────────────────────────────

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

function parseSplitInfoRecord(parts: string[]): JahisSplitInfo | null {
  const splitCount = parseInt(parts[2] ?? '', 10);
  const sequenceNumber = parseInt(parts[3] ?? '', 10);
  if (
    !parts[1] ||
    !Number.isInteger(splitCount) ||
    splitCount <= 0 ||
    !Number.isInteger(sequenceNumber) ||
    sequenceNumber <= 0 ||
    sequenceNumber > splitCount
  ) {
    return null;
  }

  return {
    dataId: parts[1],
    splitCount,
    sequenceNumber,
  };
}

/**
 * 複数 QR のページデータをマージして1つの JahisQRData に統合する。
 * splitInfo.sequenceNumber でソートしてからマージする。
 */
export function mergeJahisQRPages(pages: JahisQRData[]): JahisQRData {
  if (pages.length === 0) throw new Error('No QR pages to merge');
  if (pages.length === 1) return pages[0];

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
          if (parts[3]) patient.birthDate = parseJahisDate(parts[3]);
          if (parts[10]) patient.nameKana = parts[10];
          break;
        }
        case '2': {
          if (parts[2]) patientNotes.push(parts[2]);
          break;
        }
        case '5': {
          if (parts[1]) dispensingDate = parseJahisDate(parts[1]);
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
          const rpNumber = parts[1] ? parseInt(parts[1], 10) : undefined;
          currentMed = {
            rpNumber: rpNumber !== undefined && !isNaN(rpNumber) ? rpNumber : undefined,
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
          if (currentMed) {
            if (parts[2]) currentMed.usage = parts[2];
            if (parts[3]) currentMed.usageQuantity = parts[3];
            if (parts[4]) currentMed.usageUnit = parts[4];
            if (parts[5]) currentMed.formCode = parseInt(parts[5], 10) || undefined;
            if (parts[3] && parts[4]) {
              currentMed.daysOrTimes = `${parts[3]}${parts[4]}`;
            } else if (parts[3]) {
              currentMed.daysOrTimes = parts[3];
            }
          }
          break;
        }
        case '311': {
          if (currentMed && parts[2]) {
            currentMed.supplements.push(parts[2]);
          }
          break;
        }
        case '391': {
          if (currentMed && parts[2]) {
            currentMed.usageNotes.push(parts[2]);
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
          if (parts[1]) patient.birthDate = parseJahisDate(parts[1]);
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
          if (parts[1]) prescriptionIssueDate = parseJahisDate(parts[1]);
          break;
        }
        case '52': {
          if (parts[1]) prescriptionExpirationDate = parseJahisDate(parts[1]);
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
  return (value ?? '').replace(/,/g, '，').replace(/\r?\n/g, ' ').trim();
}

function toJahisGenderCode(gender: JahisPatient['gender']): string {
  if (gender === 'male') return '1';
  if (gender === 'female') return '2';
  return '0';
}

function formatJahisExportDate(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\//g, '').replace(/-/g, '').trim();
}
