import { createHash } from 'node:crypto';
import { normalizeMedicationCode } from '@/lib/pharmacy/drug-identity-resolution';
import type {
  DrugMasterIdentityRow,
  DrugMasterIndexes,
  PrescriptionSupplyLineRow,
} from './apply-prescription-supply-contract';

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

export function normalizeText(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  return normalized ? normalized : null;
}

export function normalizeSourceCodeType(value: string | null | undefined) {
  const normalized = normalizeText(value)?.replace(/[\s_-]+/g, '');
  if (!normalized) return null;
  if (['yj', 'yjcode', 'drugcode'].includes(normalized)) return 'yj';
  if (['receipt', 'receiptcode', 'receiptdrugcode', 'レセ電', 'レセプト'].includes(normalized)) {
    return 'receipt';
  }
  if (['hot', 'hotcode'].includes(normalized)) return 'hot';
  if (['jan', 'jancode', 'gs1', 'gtin', 'gsi'].includes(normalized)) return 'package';
  return normalized;
}

export function appendIndex(
  index: Map<string, DrugMasterIdentityRow[]>,
  code: string | null,
  row: DrugMasterIdentityRow,
) {
  const normalized = normalizeMedicationCode(code);
  if (!normalized) return;
  const rows = index.get(normalized) ?? [];
  rows.push(row);
  index.set(normalized, rows);
}

export function buildDrugMasterIndexes(rows: DrugMasterIdentityRow[]): DrugMasterIndexes {
  const indexes: DrugMasterIndexes = {
    byId: new Map(),
    byYj: new Map(),
    byReceipt: new Map(),
    byHot: new Map(),
  };
  for (const row of rows) {
    indexes.byId.set(row.id, row);
    appendIndex(indexes.byYj, row.yj_code, row);
    appendIndex(indexes.byReceipt, row.receipt_code, row);
    appendIndex(indexes.byHot, row.hot_code, row);
  }
  return indexes;
}

export function uniqueCandidate(rows: DrugMasterIdentityRow[] | undefined) {
  if (!rows || rows.length !== 1) return null;
  return rows[0];
}

export function resolveLineDrugMaster(line: PrescriptionSupplyLineRow, indexes: DrugMasterIndexes) {
  if (line.drug_master_id) {
    return indexes.byId.get(line.drug_master_id) ?? null;
  }

  const yjCode = normalizeMedicationCode(line.drug_code);
  if (yjCode) {
    const yjCandidate = uniqueCandidate(indexes.byYj.get(yjCode));
    if (yjCandidate) return yjCandidate;
  }

  const sourceType = normalizeSourceCodeType(line.source_drug_code_type);
  const sourceCode = normalizeMedicationCode(line.source_drug_code);
  if (!sourceCode) return null;
  if (sourceType === 'yj') return uniqueCandidate(indexes.byYj.get(sourceCode));
  if (sourceType === 'receipt') return uniqueCandidate(indexes.byReceipt.get(sourceCode));
  if (sourceType === 'hot') return uniqueCandidate(indexes.byHot.get(sourceCode));
  return null;
}

export function isPackageOnlyIdentity(line: PrescriptionSupplyLineRow) {
  return normalizeSourceCodeType(line.source_drug_code_type) === 'package';
}

export function isLikelyPrnLine(line: PrescriptionSupplyLineRow) {
  const text = normalizeText(
    [line.frequency, line.dose, line.dosage_form].filter(Boolean).join(' '),
  );
  if (!text) return false;
  return /頓服|必要時|疼痛時|発熱時|不眠時|prn|asneeded/.test(text.replace(/\s+/g, ''));
}

export function isLikelyExternalLine(line: PrescriptionSupplyLineRow) {
  if (line.route === 'external') return true;
  const text = normalizeText(
    [line.dosage_form, line.drug_name, line.unit].filter(Boolean).join(' '),
  );
  if (!text) return false;
  return /外用|貼付|湿布|軟膏|クリーム|ゲル|ローション|点眼|点鼻|吸入|坐剤|坐薬|塗布|パッチ/.test(
    text,
  );
}

export function isStockRelevantLine(line: PrescriptionSupplyLineRow) {
  return isLikelyExternalLine(line) || isLikelyPrnLine(line);
}

export function normalizeMedicationStockUnit(
  value: string | null | undefined,
  line: Pick<PrescriptionSupplyLineRow, 'dosage_form' | 'drug_name'>,
) {
  const raw = normalizeText(value)?.replace(/\s+/g, '');
  if (!raw) return null;
  if (['錠', 'tablet', 'tablets', 'tab'].includes(raw)) return 'tablet';
  if (['カプセル', 'capsule', 'capsules', 'cap'].includes(raw)) return 'capsule';
  if (['包', '袋', 'packet', 'packets', '包分'].includes(raw)) return 'packet';
  if (['枚', 'シート', 'sheet', 'sheets'].includes(raw)) return 'sheet';
  if (['貼', 'パッチ', 'patch', 'patches'].includes(raw)) return 'patch';
  if (['ml', 'ｍｌ', 'ミリリットル'].includes(raw)) return 'ml';
  if (['g', 'ｇ', 'グラム'].includes(raw)) return 'g';
  if (['回', '回分', 'dose', 'doses'].includes(raw)) return 'dose';
  if (['瓶', 'ボトル', 'bottle', 'bottles'].includes(raw)) return 'bottle';
  if (['本', 'tube', 'tubes'].includes(raw)) {
    const text = normalizeText([line.dosage_form, line.drug_name].filter(Boolean).join(' '));
    return text && /軟膏|クリーム|ゲル|ローション|塗布/.test(text) ? 'tube' : 'bottle';
  }
  if (['個', '個分', 'other'].includes(raw)) return 'other';
  return null;
}

export function normalizePrescriptionSupplyUnit(line: PrescriptionSupplyLineRow) {
  return normalizeMedicationStockUnit(line.unit, line);
}

export function isSalesPackageCountUnit(value: string | null | undefined) {
  const raw = normalizeText(value)?.replace(/\s+/g, '');
  return (
    raw != null && ['箱', '販売包装', 'box', 'boxes', 'package', 'packages', 'pkg'].includes(raw)
  );
}

export function buildSupplyEventIdempotencyKeyHash(args: {
  orgId: string;
  prescriptionLineId: string;
}) {
  return `medication-stock-prescription-supply:v1:${sha256Hex(
    stableStringify({
      org_id: args.orgId,
      prescription_line_id: args.prescriptionLineId,
    }),
  )}`;
}

export function buildSupplyRequestFingerprint(args: {
  prescriptionLineId: string;
  stockItemId: string;
  drugMasterId: string | null;
  drugCode: string | null;
  quantity: number;
  unit: string;
  drugPackageId?: string;
}) {
  return `medication-stock-prescription-supply-request:v1:${sha256Hex(
    stableStringify({
      prescription_line_id: args.prescriptionLineId,
      stock_item_id: args.stockItemId,
      drug_master_id: args.drugMasterId,
      drug_code: args.drugCode,
      quantity: args.quantity,
      unit: args.unit,
      event_type: 'prescription_supply',
      ...(args.drugPackageId ? { drug_package_id: args.drugPackageId } : {}),
    }),
  )}`;
}

export function reviewTaskDedupeKey(lineId: string) {
  return `medication-stock-prescription-supply:${lineId}:review`;
}
