import { format } from 'date-fns';

/**
 * 調剤/監査ワークベンチ(/api/dispense-tasks/[id]/workbench)のサーバー側
 * ラベル合成ヘルパー。患者詳細サービス(patient-detail.ts)とは独立した
 * ワークベンチ専用の表示文字列を作る(07_dispense セーフティボード等)。
 */

type AllergyEntryLike = {
  drug_name?: unknown;
  reaction?: unknown;
  noted_year?: unknown;
  confirmed_at?: unknown;
};

/**
 * allergy_info(Json)→ 表示ラベル。
 * - 記載なし(null / 空配列)→ null
 * - 「なし」エントリ(drug_name='なし')→ なし(確認済 M/d)
 * - 通常エントリ → セフェム系(発疹 2019)
 */
export function buildWorkbenchAllergyLabel(allergyInfo: unknown): string | null {
  if (!Array.isArray(allergyInfo) || allergyInfo.length === 0) return null;
  const entries = allergyInfo.filter(
    (entry): entry is AllergyEntryLike & { drug_name: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as AllergyEntryLike).drug_name === 'string' &&
      ((entry as AllergyEntryLike).drug_name as string).trim().length > 0,
  );
  if (entries.length === 0) return null;

  const noneEntry = entries.find((entry) => entry.drug_name.trim() === 'なし');
  if (noneEntry) {
    const confirmedAt =
      typeof noneEntry.confirmed_at === 'string' && noneEntry.confirmed_at.length >= 10
        ? new Date(noneEntry.confirmed_at)
        : null;
    const confirmedLabel =
      confirmedAt && !Number.isNaN(confirmedAt.getTime())
        ? `(確認済 ${format(confirmedAt, 'M/d')})`
        : '';
    return `なし${confirmedLabel}`;
  }

  return entries
    .map((entry) => {
      const reaction = typeof entry.reaction === 'string' ? entry.reaction : null;
      const year = typeof entry.noted_year === 'number' ? String(entry.noted_year) : null;
      const detail = [reaction, year].filter(Boolean).join(' ');
      return detail ? `${entry.drug_name}(${detail})` : entry.drug_name;
    })
    .join(' / ');
}

/** eGFR < 45(G3b 相当)で「用量に注意」を付す。それ以外は測定日表記。 */
export function buildWorkbenchRenalLabel(
  observation: {
    value_numeric: number | null;
    value_text: string | null;
    measured_at: Date;
  } | null,
): string | null {
  if (!observation) return null;
  const value = observation.value_numeric ?? observation.value_text;
  if (value == null) return null;
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (Number.isFinite(numeric) && numeric < 45) {
    return `eGFR ${value} — 用量に注意`;
  }
  return `eGFR ${value}(${format(observation.measured_at, 'M/d')})`;
}

/** dose 文字列の先頭数値を取り出す(例 '20mg 朝夕' → 20)。 */
function extractLeadingNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 用量変更の方向(減量 / 増量)。数値が取れない場合は null。 */
export function detectDoseDirection(
  previous: string | null,
  current: string | null,
): 'decrease' | 'increase' | null {
  const prev = extractLeadingNumber(previous);
  const next = extractLeadingNumber(current);
  if (prev == null || next == null || prev === next) return null;
  return next < prev ? 'decrease' : 'increase';
}
