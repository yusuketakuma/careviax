import { Prisma } from '@prisma/client';
import {
  DrugMasterImportDbClient,
  FetchLike,
  fetchBytes,
  fetchText,
  normalizeCell,
  parseDate,
  parseDecimal,
  resolveAbsoluteUrl,
  withImportLog,
} from './shared';
import { loadWorkbook, readWorkbookRowsFromWorkbook } from './excel';

export const MHLW_MASTER_INDEX_PAGE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000078916.html';

type ParsedMhlwPriceRecord = {
  yj_code: string;
  drug_name: string;
  generic_name: string | null;
  manufacturer: string | null;
  dosage_form: string | null;
  drug_price: Prisma.Decimal | null;
  is_generic: boolean;
  transitional_expiry_date: Date | null;
};

type ParsedGenericNameEntry = {
  generic_code: string;
  generic_name: string;
  standard_name: string;
  dosage_form: string | null;
  specification: string | null;
  lowest_price: Prisma.Decimal | null;
  add_on_scope: string | null;
  exception_codes: string[];
  brand_candidates: Array<{
    yj_code: string;
    drug_name: string;
    manufacturer: string | null;
  }>;
};

function findHeaderIndex(rows: Array<Array<string | null>>, requiredHeader: string) {
  const index = rows.findIndex((row) => row.some((cell) => normalizeCell(cell) === requiredHeader));
  if (index < 0) {
    throw new Error(`Excel内に必要なヘッダー '${requiredHeader}' が見つかりませんでした`);
  }
  return index;
}

function hasHeader(rows: Array<Array<string | null>>, requiredHeader: string) {
  return rows.findIndex((row) => row.some((cell) => normalizeCell(cell) === requiredHeader)) >= 0;
}

async function loadPriceWorkbookRows(buffer: Buffer) {
  const workbook = await loadWorkbook(buffer);
  const preferredSheetNames = ['ＨＰ用', 'HP用'];

  for (const sheetName of preferredSheetNames) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    const rows = readWorkbookRowsFromWorkbook(workbook, sheetName);
    if (hasHeader(rows, '薬価基準収載医薬品コード')) {
      return rows;
    }
  }

  for (const worksheet of workbook.worksheets) {
    const rows = readWorkbookRowsFromWorkbook(workbook, worksheet.name);
    if (hasHeader(rows, '薬価基準収載医薬品コード')) {
      return rows;
    }
  }

  throw new Error("Excel ワークシート内に '薬価基準収載医薬品コード' ヘッダーが見つかりませんでした");
}

function indexHeaderMap(headerRow: Array<string | null>) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const key = normalizeCell(cell);
    if (key) {
      map.set(key, index);
    }
  });
  return map;
}

function readCell(row: Array<string | null>, headerMap: Map<string, number>, header: string) {
  const index = headerMap.get(header);
  if (index == null) return null;
  return normalizeCell(row[index]);
}

export function resolveLatestMhlwPriceWorkbookUrl(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL
) {
  const match = html.match(/href="([^"]+tp\d{8}-01_01\.xlsx)"/i);
  if (!match) {
    throw new Error('最新の薬価基準収載品目 Excel を解決できませんでした');
  }
  return resolveAbsoluteUrl(match[1], pageUrl);
}

export function resolveLatestGenericNameWorkbookUrl(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL
) {
  const match = html.match(/href="([^"]+ippanmeishohoumaster_\d+\.xlsx)"/i);
  if (!match) {
    throw new Error('最新の一般名処方マスタ Excel を解決できませんでした');
  }
  return resolveAbsoluteUrl(match[1], pageUrl);
}

export async function parseMhlwPriceWorkbook(
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workbookUrl =
    options.workbookUrl ??
    resolveLatestMhlwPriceWorkbookUrl(await fetchText(MHLW_MASTER_INDEX_PAGE_URL, fetchImpl));

  const rows = await loadPriceWorkbookRows(await fetchBytes(workbookUrl, fetchImpl));
  const headerIndex = findHeaderIndex(rows, '薬価基準収載医薬品コード');
  const headerMap = indexHeaderMap(rows[headerIndex]);
  const records: ParsedMhlwPriceRecord[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const yjCode = readCell(row, headerMap, '薬価基準収載医薬品コード');
    const drugName = readCell(row, headerMap, '品名');
    if (!yjCode || !drugName) continue;

    const genericIndicator =
      readCell(row, headerMap, '診療報酬において加算等の算定対象となる後発医薬品') ??
      readCell(row, headerMap, '同一剤形・規格の後発医薬品がある先発医薬品');

    records.push({
      yj_code: yjCode,
      drug_name: drugName,
      generic_name: readCell(row, headerMap, '成分名'),
      manufacturer: readCell(row, headerMap, 'メーカー名'),
      dosage_form: readCell(row, headerMap, '区分'),
      drug_price: parseDecimal(readCell(row, headerMap, '薬価')),
      is_generic:
        genericIndicator != null &&
        (genericIndicator.includes('後発') || genericIndicator.includes('★')),
      transitional_expiry_date: parseDate(readCell(row, headerMap, '経過措置による使用期限')),
    });
  }

  return {
    workbookUrl,
    records,
  };
}

async function upsertPriceChunk(
  db: DrugMasterImportDbClient,
  records: ParsedMhlwPriceRecord[],
  mode: 'price' | 'generic'
) {
  await Promise.all(
    records.map((record) =>
      db.drugMaster.upsert({
        where: { yj_code: record.yj_code },
        create: {
          yj_code: record.yj_code,
          drug_name: record.drug_name,
          generic_name: record.generic_name,
          manufacturer: record.manufacturer,
          dosage_form: record.dosage_form,
          drug_price: mode === 'price' ? record.drug_price : null,
          is_generic: record.is_generic,
          transitional_expiry_date: record.transitional_expiry_date,
        },
        update:
          mode === 'price'
            ? {
                drug_name: record.drug_name,
                generic_name: record.generic_name,
                manufacturer: record.manufacturer,
                dosage_form: record.dosage_form,
                drug_price: record.drug_price,
                transitional_expiry_date: record.transitional_expiry_date,
              }
            : {
                is_generic: record.is_generic,
              },
      })
    )
  );
}

export async function importMhlwPriceList(
  db: DrugMasterImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {}
) {
  return withImportLog(db, 'mhlw_price', async () => {
    const parsed = await parseMhlwPriceWorkbook(options);

    for (let index = 0; index < parsed.records.length; index += 200) {
      await upsertPriceChunk(db, parsed.records.slice(index, index + 200), 'price');
    }

    return {
      recordCount: parsed.records.length,
      payload: {
        workbookUrl: parsed.workbookUrl,
      },
    };
  });
}

export async function importMhlwGenericFlags(
  db: DrugMasterImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {}
) {
  return withImportLog(db, 'mhlw_generic', async () => {
    const parsed = await parseMhlwPriceWorkbook(options);

    for (let index = 0; index < parsed.records.length; index += 200) {
      await upsertPriceChunk(db, parsed.records.slice(index, index + 200), 'generic');
    }

    return {
      recordCount: parsed.records.length,
      payload: {
        workbookUrl: parsed.workbookUrl,
      },
    };
  });
}

export async function parseGenericNameWorkbook(
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workbookUrl =
    options.workbookUrl ??
    resolveLatestGenericNameWorkbookUrl(await fetchText(MHLW_MASTER_INDEX_PAGE_URL, fetchImpl));
  const buffer = await fetchBytes(workbookUrl, fetchImpl);
  const workbook = await loadWorkbook(buffer);
  const masterRows = readWorkbookRowsFromWorkbook(workbook, '一般名処方マスタ（R8.4.1版） 全体');
  const exceptionRows = readWorkbookRowsFromWorkbook(workbook, '例外コード品目対照表');

  const masterHeaderIndex = findHeaderIndex(masterRows, '一般名コード');
  const masterHeaderMap = indexHeaderMap(masterRows[masterHeaderIndex]);
  const exceptionHeaderIndex = findHeaderIndex(exceptionRows, '一般名コード');
  const exceptionHeaderMap = indexHeaderMap(exceptionRows[exceptionHeaderIndex]);

  const exceptionMap = new Map<string, string[]>();
  let lastGenericCode: string | null = null;

  for (const row of exceptionRows.slice(exceptionHeaderIndex + 1)) {
    const genericCode: string | null =
      readCell(row, exceptionHeaderMap, '一般名コード') ?? lastGenericCode;
    const yjCode = readCell(row, exceptionHeaderMap, '薬価基準収載医薬品コード');
    if (!genericCode) continue;
    lastGenericCode = genericCode;

    if (yjCode) {
      const current = exceptionMap.get(genericCode) ?? [];
      current.push(yjCode);
      exceptionMap.set(genericCode, current);
    }
  }

  const entries: Array<Omit<ParsedGenericNameEntry, 'brand_candidates'>> = [];
  for (const row of masterRows.slice(masterHeaderIndex + 1)) {
    const genericCode = readCell(row, masterHeaderMap, '一般名コード');
    const genericName = readCell(row, masterHeaderMap, '成分名');
    const standardName = readCell(row, masterHeaderMap, '一般名処方の標準的な記載');
    if (!genericCode || !genericName || !standardName) continue;

    entries.push({
      generic_code: genericCode,
      generic_name: genericName,
      standard_name: standardName,
      dosage_form: readCell(row, masterHeaderMap, '区分'),
      specification: readCell(row, masterHeaderMap, '規格'),
      lowest_price: parseDecimal(readCell(row, masterHeaderMap, '同一剤形・規格内の最低薬価')),
      add_on_scope: readCell(row, masterHeaderMap, '一般名処方加算対象'),
      exception_codes: exceptionMap.get(genericCode) ?? [],
    });
  }

  return {
    workbookUrl,
    entries,
  };
}

export async function importGenericNameMappings(
  db: DrugMasterImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {}
) {
  return withImportLog(db, 'mhlw_generic', async () => {
    const parsed = await parseGenericNameWorkbook(options);
    const masters = await db.drugMaster.findMany({
      select: {
        id: true,
        yj_code: true,
        drug_name: true,
        generic_name: true,
        manufacturer: true,
      },
    });

    const grouped = new Map<string, ParsedGenericNameEntry>();
    for (const entry of parsed.entries) {
      const masterMatches = masters.filter((master) => {
        if (master.yj_code && entry.exception_codes.includes(master.yj_code)) return true;

        const normalizedGeneric = master.generic_name?.trim();
        if (normalizedGeneric && normalizedGeneric === entry.generic_name) return true;

        return master.drug_name.includes(entry.generic_name);
      });

      const current = grouped.get(entry.generic_name);
      const nextCandidates = masterMatches.map((match) => ({
        yj_code: match.yj_code,
        drug_name: match.drug_name,
        manufacturer: match.manufacturer,
      }));
      if (!current) {
        grouped.set(entry.generic_name, {
          ...entry,
          brand_candidates: nextCandidates,
        });
        continue;
      }

      current.brand_candidates = dedupeBrandCandidates([
        ...current.brand_candidates,
        ...nextCandidates,
      ]);
      current.exception_codes = [...new Set([...current.exception_codes, ...entry.exception_codes])];
      current.lowest_price = current.lowest_price ?? entry.lowest_price;
    }

    await db.genericDrugMapping.deleteMany({});

    const records = [...grouped.values()];
    for (const record of records) {
      await db.genericDrugMapping.create({
        data: {
          generic_name: record.generic_name,
          brand_drug_ids: record.brand_candidates
            .map((candidate) => masters.find((master) => master.yj_code === candidate.yj_code)?.id)
            .filter((value): value is string => Boolean(value)),
          price_comparison: {
            general_name_code: record.generic_code,
            standard_name: record.standard_name,
            dosage_form: record.dosage_form,
            specification: record.specification,
            lowest_price: record.lowest_price?.toString() ?? null,
            add_on_scope: record.add_on_scope,
            exception_codes: record.exception_codes,
            brand_candidates: record.brand_candidates,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }

    return {
      recordCount: records.length,
      payload: {
        workbookUrl: parsed.workbookUrl,
      },
    };
  });
}

function dedupeBrandCandidates(
  candidates: ParsedGenericNameEntry['brand_candidates']
): ParsedGenericNameEntry['brand_candidates'] {
  const seen = new Set<string>();
  const deduped: ParsedGenericNameEntry['brand_candidates'] = [];

  for (const candidate of candidates) {
    const key = `${candidate.yj_code}:${candidate.drug_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}
