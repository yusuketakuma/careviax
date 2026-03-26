export type GS1ParseResult = {
  gtin?: string; // AI01: GTIN (14桁)
  expiryDate?: string; // AI17: 有効期限 (YYMMDD → YYYY-MM-DD)
  lotNumber?: string; // AI10: ロット番号
  serialNumber?: string; // AI21: シリアル番号
  raw: string;
};

/**
 * GS1-128 / GS1 DataBar の Application Identifier (AI) をパースする。
 *
 * 対応 AI:
 *  - 01: GTIN (14桁固定)
 *  - 17: 有効期限 (YYMMDD 6桁固定)
 *  - 10: ロット番号 (可変長、GS区切り)
 *  - 21: シリアル番号 (可変長、GS区切り)
 */
export function parseGS1Barcode(barcode: string): GS1ParseResult {
  const result: GS1ParseResult = { raw: barcode };
  const gs = '\x1D'; // Group Separator (GS1 可変長フィールド区切り)

  let pos = 0;

  while (pos < barcode.length) {
    const ai = barcode.substring(pos, pos + 2);

    if (ai === '01' && pos + 16 <= barcode.length) {
      result.gtin = barcode.substring(pos + 2, pos + 16);
      pos += 16;
    } else if (ai === '17' && pos + 8 <= barcode.length) {
      const dateStr = barcode.substring(pos + 2, pos + 8);
      const yy = parseInt(dateStr.substring(0, 2), 10);
      const mm = dateStr.substring(2, 4);
      const dd = dateStr.substring(4, 6);
      // GS1 規格: YY >= 50 → 1900年代、YY < 50 → 2000年代
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      // dd === '00' はその月の末日を意味するが、安全側で28日に設定
      result.expiryDate = `${year}-${mm}-${dd === '00' ? '28' : dd}`;
      pos += 8;
    } else if (ai === '10') {
      pos += 2;
      const gsIdx = barcode.indexOf(gs, pos);
      const end = gsIdx >= 0 ? gsIdx : barcode.length;
      result.lotNumber = barcode.substring(pos, end);
      pos = gsIdx >= 0 ? gsIdx + 1 : end;
    } else if (ai === '21') {
      pos += 2;
      const gsIdx = barcode.indexOf(gs, pos);
      const end = gsIdx >= 0 ? gsIdx : barcode.length;
      result.serialNumber = barcode.substring(pos, end);
      pos = gsIdx >= 0 ? gsIdx + 1 : end;
    } else {
      // 未知の AI — 1バイト進めて次の AI 探索を継続
      pos++;
    }
  }

  return result;
}

/**
 * 有効期限が現在日時より前かどうかを判定する。
 * @param expiryDate YYYY-MM-DD 形式の有効期限文字列
 */
export function isExpired(expiryDate: string): boolean {
  return new Date(expiryDate) < new Date();
}
