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
 *       501 — 備考
 *       601 — 患者等記入
 *       701 — かかりつけ薬剤師
 *       911 — 分割制御（マルチQR）
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface JahisPatient {
  name: string;       // 患者氏名（漢字）
  nameKana?: string;  // 患者氏名（カナ）
  birthDate?: string; // YYYY-MM-DD
  gender?: 'male' | 'female' | 'other';
}

export interface JahisMedication {
  rpNumber?: number;       // 処方グループ番号
  drugCode?: string;       // 薬剤コード
  drugCodeType?: number;   // コード種別: 1=なし, 2=レセ電, 3=厚労省, 4=YJ, 6=HOT
  drugName: string;        // 薬剤名称
  genericName?: string;    // 一般名（ver.2.5以降）
  genericCodeType?: number;
  genericCode?: string;
  dose?: string;           // 1回用量
  unit?: string;           // 単位
  usage?: string;          // 用法テキスト（record 301 usage_name）
  usageQuantity?: string;  // 用法数量（record 301 quantity, e.g. "14"）
  usageUnit?: string;      // 用法単位（record 301 unit, e.g. "日分"）
  formCode?: number;       // 剤形コード（record 301）
  /** @deprecated use usageQuantity + usageUnit */
  daysOrTimes?: string;    // 後方互換: record 301 の quantity+unit を結合した文字列
  /** @deprecated dispensed quantity is not a separate JAHIS record */
  dispensedQuantity?: string;
  supplements: string[];   // 補足情報（record 281, 311）
  usageNotes: string[];    // 服用注意（record 291, 391）
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
  dataId: string;          // 14桁ユニークID
  splitCount: number;      // 分割総数
  sequenceNumber: number;  // このQRの順番
}

export interface JahisQRData {
  patient: JahisPatient;
  medications: JahisMedication[];
  prescribingInstitution: JahisInstitution; // record 51: 処方-医療機関
  dispensingInstitution: JahisInstitution;  // record 11: 調剤-医療機関
  dispensingPharmacist?: string;            // record 15: 調剤-薬剤師名
  prescribingDoctor?: string;               // record 55: 処方-医師名
  prescribingDepartment?: string;           // record 55: 診療科
  dispensingDate?: string;                  // record 5: 調剤日 YYYY-MM-DD
  remarks: string[];                        // record 401, 501
  patientNotes: string[];                   // record 2
  splitInfo?: JahisSplitInfo;              // record 911
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
  | { success: false; data: Partial<JahisQRData>; errors: JahisParseError[]; warnings: JahisParseWarning[] };

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
  return text.trimStart().startsWith('JAHISTC');
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
      'M': 1867, 'T': 1911, 'S': 1925, 'H': 1988, 'R': 2018,
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

function getInstitutionName(
  institution?: JahisInstitution | JahisQrExportInput['pharmacy']
) {
  if (!institution) return undefined;
  const legacyInstitution = institution as JahisQrExportInput['pharmacy'];
  if (legacyInstitution?.institutionName !== undefined) {
    return legacyInstitution.institutionName;
  }
  return (institution as JahisInstitution).name;
}

function getInstitutionCode(
  institution?: JahisInstitution | JahisQrExportInput['pharmacy']
) {
  if (!institution) return undefined;
  return institution.institutionCode;
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
    ].join(',')
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
      ].join(',')
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
      ].join(',')
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
      ].join(',')
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
        ].join(',')
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
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(',');
    if (parts[0] === '911') {
      const splitCount = parseInt(parts[2], 10);
      const sequenceNumber = parseInt(parts[3], 10);
      if (!isNaN(splitCount) && splitCount > 0 && !isNaN(sequenceNumber) && sequenceNumber > 0) {
        return {
          dataId: parts[1] || '',
          splitCount,
          sequenceNumber,
        };
      }
    }
  }
  return null;
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
  const rawText = sorted.map((p) => p.rawText).join('\n---QR_PAGE_BREAK---\n');

  const prescribingInstitution: JahisInstitution = {
    name: sorted.find((p) => p.prescribingInstitution.name)?.prescribingInstitution.name,
    prefCode: sorted.find((p) => p.prescribingInstitution.prefCode)?.prescribingInstitution.prefCode,
    scoreTableCode: sorted.find((p) => p.prescribingInstitution.scoreTableCode)?.prescribingInstitution.scoreTableCode,
    institutionCode: sorted.find((p) => p.prescribingInstitution.institutionCode)?.prescribingInstitution.institutionCode,
    address: sorted.find((p) => p.prescribingInstitution.address)?.prescribingInstitution.address,
    phone: sorted.find((p) => p.prescribingInstitution.phone)?.prescribingInstitution.phone,
  };

  const dispensingInstitution: JahisInstitution = {
    name: sorted.find((p) => p.dispensingInstitution.name)?.dispensingInstitution.name,
    prefCode: sorted.find((p) => p.dispensingInstitution.prefCode)?.dispensingInstitution.prefCode,
    scoreTableCode: sorted.find((p) => p.dispensingInstitution.scoreTableCode)?.dispensingInstitution.scoreTableCode,
    institutionCode: sorted.find((p) => p.dispensingInstitution.institutionCode)?.dispensingInstitution.institutionCode,
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
  let splitInfo: JahisSplitInfo | undefined;
  let currentMed: JahisMedication | null = null;

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
            rpNumber: (rpNumber !== undefined && !isNaN(rpNumber)) ? rpNumber : undefined,
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
        case '411':
        case '421':
        case '601':
        case '701': {
          warnings.push({ recordType, field: 'info', message: `Record type ${recordType} noted but not mapped` });
          break;
        }
        case '911': {
          const splitCount = parseInt(parts[2], 10);
          const sequenceNumber = parseInt(parts[3], 10);
          if (!isNaN(splitCount) && !isNaN(sequenceNumber)) {
            splitInfo = { dataId: parts[1] || '', splitCount, sequenceNumber };
          }
          break;
        }
        default:
          warnings.push({ recordType, field: 'unknown', message: `Unknown record type ${recordType} at line ${i + 1}` });
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
    splitInfo,
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
