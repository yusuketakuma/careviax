import { describe, expect, it } from 'vitest';
import { getMhlwTestSupport } from './mhlw.test-support';

const {
  parseMhlwPriceWorkbook,
  resolveLatestGenericNameWorkbookUrl,
  resolveLatestMhlwPriceListPageMetadata,
  resolveLatestMhlwPriceListPageUrl,
  resolveLatestMhlwPriceWorkbookUrl,
  resolveLatestMhlwPriceWorkbookUrls,
  toWorkbookResponse,
  workbookBlob,
} = getMhlwTestSupport();

describe('resolveLatestMhlwPriceWorkbookUrl', () => {
  it('extracts the latest price list detail page url from the MHLW index page', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目リストについて（令和8年5月20日適用）</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceListPageUrl(html)).toBe(
      'https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html',
    );
  });

  it('extracts the latest price list applicable date from the MHLW index page text', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目リストについて（令和8年5月20日適用）</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceListPageMetadata(html)).toEqual({
      priceListPageUrl: 'https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html',
      applicableDate: new Date(Date.UTC(2026, 4, 20)),
    });
  });

  it('fails a matched invalid applicable date with a fixed source-date code', () => {
    const html = `
      <a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目（令和8年2月30日適用）</a>
    `;

    expect(() => resolveLatestMhlwPriceListPageMetadata(html)).toThrow(
      'DRUG_MASTER_SOURCE_DATE_INVALID',
    );
  });

  it('does not treat an era-only fiscal-year mention as an applicable date candidate', () => {
    const html = `
      <h1>令和8年度の薬価改定資料</h1>
      <a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目リスト</a>
    `;

    expect(resolveLatestMhlwPriceListPageMetadata(html)).toEqual({
      priceListPageUrl: 'https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html',
      applicableDate: null,
    });
  });

  it('extracts the latest price workbook url from the index page', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/xls/tp20260401-01_01.xlsx">Excel</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceWorkbookUrl(html)).toBe(
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260401-01_01.xlsx',
    );
  });

  it('extracts all listed price workbook urls from the current index page', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/xls/tp20260520-01_01.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260520-01_02.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260520-01_03.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260401-01_04.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260520-01_05.xlsx">Excel</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceWorkbookUrls(html)).toEqual([
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_02.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_03.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260401-01_04.xlsx',
    ]);
  });
});

describe('resolveLatestGenericNameWorkbookUrl', () => {
  it('extracts the latest generic-name workbook url from the index page', () => {
    const html = `
      <ul>
        <li><a href="/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx">一般名</a></li>
      </ul>
    `;

    expect(resolveLatestGenericNameWorkbookUrl(html)).toBe(
      'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx',
    );
  });
});

describe('parseMhlwPriceWorkbook', () => {
  it('parses official-like price rows and generic indicators', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        [
          '区分',
          '薬価基準収載医薬品コード',
          '成分名',
          '規格',
          '品名',
          'メーカー名',
          '診療報酬において加算等の算定対象となる後発医薬品',
          '先発医薬品',
          '薬価',
          '経過措置による使用期限',
        ],
        [
          '内用薬',
          '1124001F1022',
          'エスタゾラム',
          '１ｍｇ１錠',
          'ユーロジン１ｍｇ錠',
          'Ｔ’ｓ製薬',
          null,
          '先発品',
          '6.30',
          null,
        ],
        [
          '内用薬',
          '1124001F1030',
          'エスタゾラム',
          '１ｍｇ１錠',
          'エスタゾラム錠１ｍｇ「アメル」',
          '共和薬品工業',
          '後発品',
          null,
          '6.30',
          '2027/03/31',
        ],
      ],
    });

    const parsed = await parseMhlwPriceWorkbook({
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(parsed.records).toHaveLength(2);
    expect(parsed.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '1124001F1022',
      drug_name: 'ユーロジン１ｍｇ錠',
      generic_name: 'エスタゾラム',
      manufacturer: 'Ｔ’ｓ製薬',
      unit: '１ｍｇ１錠',
      dosage_form: '内用薬',
      therapeutic_category: '1124',
      is_generic: false,
    });
    expect(parsed.records[1]).toMatchObject({
      yj_code: '1124001F1030',
      is_generic: true,
    });
    expect(parsed.records[1]?.transitional_expiry_date?.toISOString()).toBe(
      '2027-03-31T00:00:00.000Z',
    );
  });

  it('finds the price sheet even when it is not the first worksheet', async () => {
    const workbook = await workbookBlob({
      概要: [['このシートは無関係です']],
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', 'メーカー名', '薬価'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', 'Ｔ’ｓ製薬', '6.30'],
      ],
    });

    const parsed = await parseMhlwPriceWorkbook({
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '1124001F1022',
      drug_name: 'ユーロジン１ｍｇ錠',
      manufacturer: 'Ｔ’ｓ製薬',
    });
  });
});
