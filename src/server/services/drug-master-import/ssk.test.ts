import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
  parseSskDrugMasterZip,
  resolveLatestSskDrugMasterZipUrl,
} from './ssk';

function toZipBlob(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function buildRow(overrides: Record<number, string>) {
  const row = Array.from({ length: 42 }, () => '');
  row[0] = '0';
  row[1] = 'Y';

  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }

  return row.map((value) => `"${value}"`).join(',');
}

describe('resolveLatestSskDrugMasterZipUrl', () => {
  it('extracts the latest full ZIP url from the SSK page html', () => {
    const html = `
      <table>
        <tr>
          <td><a href="/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260319.zip">全件ファイル(ZIP:795KB)</a></td>
        </tr>
      </table>
    `;

    expect(resolveLatestSskDrugMasterZipUrl(html)).toBe(
      'https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260319.zip'
    );
  });
});

describe('parseSskDrugMasterZip', () => {
  it('parses a zipped CSV payload and prefers richer duplicates by yj_code', async () => {
    const csv = [
      buildRow({
        2: '123456789',
        4: 'DRUG-A',
        6: 'DRUG-A-KANA',
        9: 'TAB',
        11: '9.50',
        13: '1',
        16: '0',
        27: '1',
        31: '123456789012',
        34: 'DRUG-A',
      }),
      buildRow({
        2: '123456789',
        4: 'DRUG-A',
        6: 'DRUG-A-KANA',
        9: 'TAB',
        11: '9.50',
        13: '1',
        16: '1',
        27: '1',
        31: '123456789012',
        34: 'DRUG-A',
        37: 'GENERIC-A',
      }),
      buildRow({
        2: '998877665',
        4: 'DRUG-B',
        6: 'DRUG-B-KANA',
        9: 'CAP',
        11: '12.00',
        13: '5',
        16: '0',
        27: '4',
        31: '998877665544',
        34: 'DRUG-B',
      }),
    ].join('\r\n');

    const zipped = zipSync({
      'y_ALL_test.csv': Buffer.from(csv, 'utf8'),
    });

    const fetchImpl: typeof fetch = async () =>
      new Response(toZipBlob(zipped), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://example.com/y_ALL_test.zip',
      fetchImpl,
    });

    expect(parsed.entryName).toBe('y_ALL_test.csv');
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '123456789012',
      receipt_code: '123456789',
      drug_name: 'DRUG-A',
      generic_name: 'GENERIC-A',
      is_generic: true,
      is_narcotic: true,
      is_psychotropic: false,
      therapeutic_category: '1234',
      unit: 'TAB',
      dosage_form: '内用薬',
      transitional_expiry_date: null,
    });
    expect(parsed.records[1]).toMatchObject({
      yj_code: '998877665544',
      is_narcotic: false,
      is_psychotropic: true,
      therapeutic_category: '9988',
      dosage_form: '注射薬',
    });
  });

  it('parses transitional expiry dates when the SSK row carries one', async () => {
    const csv = buildRow({
      2: '610412196',
      4: 'SOSEGON',
      6: 'ｿｾｺﾞﾝ',
      9: '錠',
      11: '10.00',
      13: '0',
      16: '0',
      27: '1',
      31: '1149034F1026',
      33: '20270331',
      34: 'ソセゴン錠２５ｍｇ',
    });

    const zipped = zipSync({
      'y_ALL_test.csv': Buffer.from(csv, 'utf8'),
    });

    const fetchImpl: typeof fetch = async () =>
      new Response(toZipBlob(zipped), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://example.com/y_ALL_test.zip',
      fetchImpl,
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.transitional_expiry_date?.toISOString()).toBe(
      '2027-03-31T00:00:00.000Z'
    );
  });

  it('derives 14-day max administration windows for newly listed drugs', async () => {
    const recentListingDate = new Date();
    recentListingDate.setUTCDate(recentListingDate.getUTCDate() - 30);

    const oldListingDate = new Date();
    oldListingDate.setUTCDate(oldListingDate.getUTCDate() - 400);

    const csv = [
      buildRow({
        2: '111111111',
        4: 'NEW-DRUG',
        6: 'NEW-DRUG',
        27: '1',
        31: '111111111111',
        34: 'NEW-DRUG',
        35: formatDate(recentListingDate),
      }),
      buildRow({
        2: '222222222',
        4: 'OLD-DRUG',
        6: 'OLD-DRUG',
        27: '1',
        31: '222222222222',
        34: 'OLD-DRUG',
        35: formatDate(oldListingDate),
      }),
    ].join('\r\n');

    const zipped = zipSync({
      'y_ALL_test.csv': Buffer.from(csv, 'utf8'),
    });

    const fetchImpl: typeof fetch = async () =>
      new Response(toZipBlob(zipped), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://example.com/y_ALL_test.zip',
      fetchImpl,
    });

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]?.max_administration_days).toBe(14);
    expect(parsed.records[1]?.max_administration_days).toBeNull();
  });
});
