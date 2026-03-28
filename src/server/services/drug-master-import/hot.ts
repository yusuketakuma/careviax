import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import {
  decodeTextBuffer,
  DrugMasterImportDbClient,
  FetchLike,
  fetchBytes,
  isZipBuffer,
  normalizeCell,
  resolveAbsoluteUrl,
  splitDelimitedLine,
  withImportLog,
} from './shared';

export const MEDIS_MASTER_INDEX_PAGE_URL =
  'https://www.medis.or.jp/4_hyojyun/medis-master/riyou/index.html';

type ParsedHotRecord = {
  hot_code: string;
  yj_code: string | null;
  drug_name: string | null;
  manufacturer: string | null;
};

type ImportHotMasterOptions = {
  fileUrl?: string;
  fetchImpl?: FetchLike;
};

function resolveConfiguredHotUrl(fileUrl?: string) {
  const configured = fileUrl ?? process.env.HOT_MASTER_URL;
  if (!configured) {
    throw new Error(
      'HOTコードマスタ URL が未設定です。HOT_MASTER_URL か fileUrl を指定してください'
    );
  }

  return resolveAbsoluteUrl(configured, MEDIS_MASTER_INDEX_PAGE_URL);
}

function normalizeHeader(value: string | null) {
  return value?.replace(/\s+/g, '').toLowerCase() ?? '';
}

function detectHeaderIndex(headerMap: Map<string, number>, patterns: RegExp[]) {
  for (const [header, index] of headerMap.entries()) {
    if (patterns.some((pattern) => pattern.test(header))) {
      return index;
    }
  }
  return null;
}

function parseWorkbookRows(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<(string | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
}

function parseTextRows(buffer: Buffer) {
  const text = decodeTextBuffer(buffer);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = lines[0]?.includes('\t') ? '\t' : ',';
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

function parseHotRows(rows: Array<Array<string | null>>) {
  const headerRow = rows.find((row) =>
    row.some((cell) => /hot|薬価基準収載|販売名|医薬品名/i.test(normalizeHeader(normalizeCell(cell))))
  );
  if (!headerRow) {
    throw new Error('HOTコードマスタのヘッダー行を解決できませんでした');
  }

  const headerIndex = rows.indexOf(headerRow);
  const headerMap = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(normalizeCell(cell));
    if (normalized) {
      headerMap.set(normalized, index);
    }
  });

  const hotCodeIndex = detectHeaderIndex(headerMap, [/hot.*code/, /hotコード/, /^hot13$/, /^hot$/]);
  const yjCodeIndex = detectHeaderIndex(headerMap, [/yj/, /薬価基準収載医薬品コード/, /個別医薬品コード/]);
  const drugNameIndex = detectHeaderIndex(headerMap, [/販売名/, /品名/, /医薬品名/]);
  const manufacturerIndex = detectHeaderIndex(headerMap, [/メーカー/, /製造販売業者/, /製造元/]);

  if (hotCodeIndex == null) {
    throw new Error('HOTコード列を解決できませんでした');
  }

  const records: ParsedHotRecord[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const hotCode = normalizeCell(row[hotCodeIndex]);
    if (!hotCode) continue;

    records.push({
      hot_code: hotCode,
      yj_code: yjCodeIndex != null ? normalizeCell(row[yjCodeIndex]) : null,
      drug_name: drugNameIndex != null ? normalizeCell(row[drugNameIndex]) : null,
      manufacturer: manufacturerIndex != null ? normalizeCell(row[manufacturerIndex]) : null,
    });
  }

  return records;
}

export async function parseHotMasterFile(options: ImportHotMasterOptions = {}) {
  const fileUrl = resolveConfiguredHotUrl(options.fileUrl);
  const buffer = await fetchBytes(fileUrl, options.fetchImpl ?? fetch);

  let rows: Array<Array<string | null>>;
  if (/\.(csv|txt|tsv)$/i.test(fileUrl)) {
    rows = parseTextRows(buffer);
  } else {
    try {
      rows = parseWorkbookRows(buffer);
    } catch {
      if (isZipBuffer(buffer) && !String(fileUrl).toLowerCase().endsWith('.xlsx')) {
        const entries = unzipSync(new Uint8Array(buffer));
        const entry = Object.entries(entries).find(([name]) =>
          /\.(csv|txt|tsv)$/i.test(name)
        );
        if (!entry) {
          throw new Error('HOTコードマスタ ZIP 内に CSV/TXT が見つかりませんでした');
        }
        rows = parseTextRows(Buffer.from(entry[1]));
      } else {
        rows = parseTextRows(buffer);
      }
    }
  }

  return {
    fileUrl,
    records: parseHotRows(rows),
  };
}

export async function importHotMaster(
  db: DrugMasterImportDbClient,
  options: ImportHotMasterOptions = {}
) {
  return withImportLog(db, 'hot', async () => {
    const parsed = await parseHotMasterFile(options);
    let updatedCount = 0;

    for (const record of parsed.records) {
      if (record.yj_code) {
        await db.drugMaster.upsert({
          where: { yj_code: record.yj_code },
          create: {
            yj_code: record.yj_code,
            drug_name: record.drug_name ?? record.yj_code,
            manufacturer: record.manufacturer,
            hot_code: record.hot_code,
          },
          update: {
            hot_code: record.hot_code,
            ...(record.drug_name ? { drug_name: record.drug_name } : {}),
            ...(record.manufacturer ? { manufacturer: record.manufacturer } : {}),
          },
        });
        updatedCount += 1;
        continue;
      }

      if (!record.drug_name) {
        continue;
      }

      const existing = await db.drugMaster.findFirst({
        where: {
          drug_name: record.drug_name,
          ...(record.manufacturer ? { manufacturer: record.manufacturer } : {}),
        },
        select: { id: true },
      });

      if (!existing) {
        continue;
      }

      await db.drugMaster.update({
        where: { id: existing.id },
        data: {
          hot_code: record.hot_code,
        },
      });
      updatedCount += 1;
    }

    return {
      recordCount: updatedCount,
      payload: {
        fileUrl: parsed.fileUrl,
      },
    };
  });
}
