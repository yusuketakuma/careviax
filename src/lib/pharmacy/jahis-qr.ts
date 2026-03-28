/**
 * JAHIS お薬手帳データフォーマット ver.2.5 簡易パーサー
 *
 * QR コードは Shift-JIS エンコードされており、複数枚に分割される場合がある。
 * 本パーサーは単一 QR（1枚目 or 連結済み）を対象とする。
 *
 * フォーマット概要:
 *   1行目: JAHISTC（ヘッダ識別子）
 *   2行目以降: セミコロン区切りのレコード
 *     レコード種別:
 *       1 — 患者情報
 *       5 — 処方箋発行医療機関
 *       51 — 処方医師名
 *       201 — 処方薬剤
 *       281 — 用法
 *       291 — 処方日数/回数
 *       301 — 調剤量
 *       311 — 調剤日
 *       401 — 備考
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface JahisPatient {
  name: string; // 患者氏名（漢字）
  nameKana?: string; // 患者氏名（カナ）
  birthDate?: string; // YYYY-MM-DD
  gender?: 'male' | 'female' | 'unknown';
}

export interface JahisMedication {
  drugCode?: string; // レセ電コード or YJ コード
  drugName: string; // 薬剤名称
  dose?: string; // 用量
  unit?: string; // 単位
  usage?: string; // 用法テキスト
  daysOrTimes?: string; // 日数 or 回数
  dispensedQuantity?: string; // 調剤量
}

export interface JahisPharmacy {
  institutionName?: string;
  institutionCode?: string;
  doctorName?: string;
}

export interface JahisQRData {
  patient: JahisPatient;
  medications: JahisMedication[];
  pharmacy: JahisPharmacy;
  prescriptionDate?: string; // YYYY-MM-DD
  dispensingDate?: string; // YYYY-MM-DD
  rawText: string;
}

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
  pharmacy?: JahisPharmacy;
  prescriptionDate?: string;
  dispensingDate?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Shift-JIS Decoder (via @zxing/text-encoding)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Shift-JIS バイト列を UTF-8 文字列にデコードする。
 * @zxing/text-encoding は dynamic import で利用。
 */
export async function decodeShiftJIS(bytes: Uint8Array): Promise<string> {
  // ブラウザ TextDecoder が shift-jis をサポートしていればそれを使う
  try {
    const decoder = new TextDecoder('shift-jis');
    return decoder.decode(bytes);
  } catch {
    // fallback: @zxing/text-encoding
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
 * JAHIS お薬手帳 QR テキストをパースする。
 * @param text UTF-8 デコード済みの QR テキスト
 */
export function parseJahisQR(text: string): JahisQRData {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const patient: JahisPatient = { name: '' };
  const medications: JahisMedication[] = [];
  const pharmacy: JahisPharmacy = {};
  let prescriptionDate: string | undefined;
  let dispensingDate: string | undefined;

  // 現在構築中の薬剤（201 で始まり、後続の 281/291/301 が付属）
  let currentMed: JahisMedication | null = null;

  const flushMed = () => {
    if (currentMed) {
      medications.push(currentMed);
      currentMed = null;
    }
  };

  for (const line of lines) {
    // ヘッダ行はスキップ
    if (line.startsWith('JAHISTC')) continue;

    const parts = line.split(',');
    const recordType = parts[0];

    switch (recordType) {
      // ── 患者情報 ──
      case '1': {
        // 1,患者氏名,患者カナ,性別,生年月日,郵便番号,住所,電話
        if (parts[1]) patient.name = parts[1];
        if (parts[2]) patient.nameKana = parts[2];
        if (parts[3]) {
          const g = parts[3].trim();
          patient.gender = g === '1' ? 'male' : g === '2' ? 'female' : 'unknown';
        }
        if (parts[4]) {
          patient.birthDate = parseJahisDate(parts[4]);
        }
        break;
      }

      // ── 処方箋発行医療機関 ──
      case '5': {
        // 5,医療機関コード,医療機関名称,都道府県,...
        if (parts[1]) pharmacy.institutionCode = parts[1];
        if (parts[2]) pharmacy.institutionName = parts[2];
        break;
      }

      // ── 処方医師名 ──
      case '51': {
        if (parts[1]) pharmacy.doctorName = parts[1];
        break;
      }

      // ── 処方薬剤 ──
      case '201': {
        flushMed();
        // 201,コード種別,薬剤コード,薬剤名称,用量,単位
        currentMed = {
          drugCode: parts[2] || undefined,
          drugName: parts[3] || '不明',
          dose: parts[4] || undefined,
          unit: parts[5] || undefined,
        };
        break;
      }

      // ── 用法 ──
      case '281': {
        if (currentMed && parts[1]) {
          currentMed.usage = parts[1];
        }
        break;
      }

      // ── 処方日数/回数 ──
      case '291': {
        if (currentMed && parts[1]) {
          currentMed.daysOrTimes = parts[1];
        }
        break;
      }

      // ── 調剤量 ──
      case '301': {
        if (currentMed && parts[1]) {
          currentMed.dispensedQuantity = parts[1];
        }
        break;
      }

      // ── 調剤日 ──
      case '311': {
        if (parts[1]) {
          dispensingDate = parseJahisDate(parts[1]);
        }
        break;
      }

      // ── 処方日 ──
      case '11': {
        if (parts[1]) {
          prescriptionDate = parseJahisDate(parts[1]);
        }
        break;
      }

      default:
        break;
    }
  }

  flushMed();

  return {
    patient,
    medications,
    pharmacy,
    prescriptionDate,
    dispensingDate,
    rawText: text,
  };
}

export function buildJahisQRText(input: JahisQrExportInput): string {
  const lines = ['JAHISTC'];

  lines.push(
    [
      '1',
      sanitizeJahisField(input.patient.name),
      sanitizeJahisField(input.patient.nameKana),
      toJahisGenderCode(input.patient.gender),
      formatJahisExportDate(input.patient.birthDate),
    ].join(',')
  );

  if (input.prescriptionDate) {
    lines.push(`11,${formatJahisExportDate(input.prescriptionDate)}`);
  }

  if (input.pharmacy?.institutionCode || input.pharmacy?.institutionName) {
    lines.push(
      [
        '5',
        sanitizeJahisField(input.pharmacy.institutionCode),
        sanitizeJahisField(input.pharmacy.institutionName),
      ].join(',')
    );
  }

  if (input.pharmacy?.doctorName) {
    lines.push(`51,${sanitizeJahisField(input.pharmacy.doctorName)}`);
  }

  for (const medication of input.medications) {
    lines.push(
      [
        '201',
        '1',
        sanitizeJahisField(medication.drugCode),
        sanitizeJahisField(medication.drugName),
        sanitizeJahisField(medication.dose),
        sanitizeJahisField(medication.unit),
      ].join(',')
    );

    if (medication.frequency) {
      lines.push(`281,${sanitizeJahisField(medication.frequency)}`);
    }
    if (medication.daysOrTimes) {
      lines.push(`291,${sanitizeJahisField(medication.daysOrTimes)}`);
    }
    if (medication.dispensedQuantity) {
      lines.push(`301,${sanitizeJahisField(medication.dispensedQuantity)}`);
    }
  }

  if (input.dispensingDate) {
    lines.push(`311,${formatJahisExportDate(input.dispensingDate)}`);
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * JAHIS の日付表現 (YYYYMMDD or YYYY/MM/DD) を YYYY-MM-DD に変換する。
 */
function parseJahisDate(raw: string): string | undefined {
  const cleaned = raw.replace(/\//g, '').trim();
  if (cleaned.length !== 8) return undefined;

  const y = cleaned.substring(0, 4);
  const m = cleaned.substring(4, 6);
  const d = cleaned.substring(6, 8);

  // 簡易バリデーション
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  return `${y}-${m}-${d}`;
}

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
