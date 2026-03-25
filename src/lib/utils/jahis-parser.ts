export type JahisData = {
  patientName?: string;
  birthDate?: string;
  gender?: string;
  medications: Array<{
    drugName: string;
    dose?: string;
    frequency?: string;
    days?: number;
  }>;
};

/**
 * JAHIS Ver.2.5 QR処方箋データの簡易パーサー。
 * MVPでは JSON または改行区切りテキストとして解析する。
 * 本番では JAHIS 仕様書の固定位置フォーマットに準拠した実装に置き換える。
 */
export function parseJahisQR(rawData: string): JahisData {
  try {
    const parsed = JSON.parse(rawData);
    return parsed as JahisData;
  } catch {
    // フォールバック: 行ごとにパース（薬剤名のみ）
    const lines = rawData.split('\n');
    return {
      medications: lines
        .map((line) => ({ drugName: line.trim() }))
        .filter((m) => m.drugName),
    };
  }
}
