import { Prisma } from '@prisma/client';
import {
  FetchLike,
  MHLW_IMPORT_URL_POLICY,
  type DrugMasterImportLogDbClient,
  fetchBytes,
  fetchText,
  normalizeCell,
  normalizeImportSourceUrl,
  parseDate,
  parseDecimal,
  resolveImportSourceUrl,
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
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  drug_price: Prisma.Decimal | null;
  is_generic: boolean;
  transitional_expiry_date: Date | null;
};

type ParseMhlwPriceWorkbookOptions = {
  workbookUrl?: string;
  fetchImpl?: FetchLike;
};

type ImportMhlwPriceListOptions = ParseMhlwPriceWorkbookOptions & {
  workbookUrls?: string[];
};
type MhlwPriceImportDbClient = DrugMasterImportLogDbClient & {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany' | 'upsert'>;
  drugMasterChangeEvent: Pick<Prisma.TransactionClient['drugMasterChangeEvent'], 'create'>;
};
type MhlwGenericMappingImportDbClient = DrugMasterImportLogDbClient & {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  genericDrugMapping: Pick<Prisma.TransactionClient['genericDrugMapping'], 'create' | 'deleteMany'>;
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

  throw new Error(
    "Excel ワークシート内に '薬価基準収載医薬品コード' ヘッダーが見つかりませんでした",
  );
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

export function resolveLatestMhlwPriceListPageUrl(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const match = html.match(/href="([^"]*\/topics\/\d{4}\/\d{2}\/tp\d{8}-01\.html)"/i);
  if (!match) {
    throw new Error('最新の薬価基準収載品目ページを解決できませんでした');
  }
  return resolveImportSourceUrl(match[1], pageUrl, MHLW_IMPORT_URL_POLICY);
}

async function fetchLatestMhlwPriceListPage(
  fetchImpl: FetchLike,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const indexHtml = await fetchText(pageUrl, {
    fetchImpl,
    policy: MHLW_IMPORT_URL_POLICY,
  });
  const priceListPageUrl = resolveLatestMhlwPriceListPageUrl(indexHtml, pageUrl);
  const priceListHtml = await fetchText(priceListPageUrl, {
    fetchImpl,
    policy: MHLW_IMPORT_URL_POLICY,
  });

  return {
    priceListPageUrl,
    html: priceListHtml,
  };
}

export function resolveLatestMhlwPriceWorkbookUrl(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const workbookUrls = resolveLatestMhlwPriceWorkbookUrls(html, pageUrl);
  const workbookUrl = workbookUrls[0];
  if (!workbookUrl) {
    throw new Error('最新の薬価基準収載品目 Excel を解決できませんでした');
  }
  return workbookUrl;
}

export function resolveLatestMhlwPriceWorkbookUrls(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const matches = html.matchAll(/href="([^"]+tp\d{8}-01_0[1-4]\.xlsx)"/gi);
  const urls = [...matches].map((match) =>
    resolveImportSourceUrl(match[1], pageUrl, MHLW_IMPORT_URL_POLICY),
  );
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length === 0) {
    throw new Error('最新の薬価基準収載品目 Excel を解決できませんでした');
  }
  return uniqueUrls;
}

export function resolveLatestGenericNameWorkbookUrl(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const match = html.match(/href="([^"]+ippanmeishohoumaster_\d+\.xlsx)"/i);
  if (!match) {
    throw new Error('最新の一般名処方マスタ Excel を解決できませんでした');
  }
  return resolveImportSourceUrl(match[1], pageUrl, MHLW_IMPORT_URL_POLICY);
}

export async function parseMhlwPriceWorkbook(options: ParseMhlwPriceWorkbookOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let resolvedWorkbookUrl = options.workbookUrl;
  if (!resolvedWorkbookUrl) {
    const page = await fetchLatestMhlwPriceListPage(fetchImpl);
    resolvedWorkbookUrl = resolveLatestMhlwPriceWorkbookUrl(page.html, page.priceListPageUrl);
  }
  const workbookUrl = normalizeImportSourceUrl(resolvedWorkbookUrl, MHLW_IMPORT_URL_POLICY);

  const rows = await loadPriceWorkbookRows(
    await fetchBytes(workbookUrl, {
      fetchImpl,
      policy: MHLW_IMPORT_URL_POLICY,
    }),
  );
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
      unit: readCell(row, headerMap, '規格'),
      dosage_form: readCell(row, headerMap, '区分'),
      therapeutic_category: yjCode.slice(0, 4) || null,
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
  db: MhlwPriceImportDbClient,
  records: ParsedMhlwPriceRecord[],
  mode: 'price' | 'generic',
  importLogId?: string,
) {
  const existingByYjCode =
    mode === 'price'
      ? new Map(
          (
            await db.drugMaster.findMany({
              where: { yj_code: { in: records.map((record) => record.yj_code) } },
              select: {
                id: true,
                yj_code: true,
                drug_price: true,
                transitional_expiry_date: true,
              },
            })
          ).map((drug) => [drug.yj_code, drug]),
        )
      : new Map();

  await Promise.all(
    records.map(async (record) => {
      const existing = existingByYjCode.get(record.yj_code);
      const saved = await db.drugMaster.upsert({
        where: { yj_code: record.yj_code },
        create: {
          yj_code: record.yj_code,
          drug_name: record.drug_name,
          generic_name: record.generic_name,
          manufacturer: record.manufacturer,
          unit: record.unit,
          dosage_form: record.dosage_form,
          therapeutic_category: record.therapeutic_category,
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
                unit: record.unit,
                dosage_form: record.dosage_form,
                therapeutic_category: record.therapeutic_category,
                drug_price: record.drug_price,
                transitional_expiry_date: record.transitional_expiry_date,
              }
            : {
                is_generic: record.is_generic,
              },
      });

      if (mode !== 'price' || !existing || !importLogId) return;

      const previousPrice = existing.drug_price?.toString() ?? null;
      const currentPrice = record.drug_price?.toString() ?? null;
      const previousExpiry = existing.transitional_expiry_date?.toISOString() ?? null;
      const currentExpiry = record.transitional_expiry_date?.toISOString() ?? null;
      const changes: Array<{
        change_type: string;
        previous_value: Prisma.InputJsonValue;
        current_value: Prisma.InputJsonValue;
      }> = [];

      if (previousPrice !== currentPrice) {
        changes.push({
          change_type: 'price_changed',
          previous_value: { drug_price: previousPrice },
          current_value: { drug_price: currentPrice },
        });
      }
      if (previousExpiry !== currentExpiry) {
        changes.push({
          change_type: 'transitional_expiry_changed',
          previous_value: { transitional_expiry_date: previousExpiry },
          current_value: { transitional_expiry_date: currentExpiry },
        });
      }

      if (changes.length === 0) return;
      await Promise.all(
        changes.map((change) =>
          db.drugMasterChangeEvent.create({
            data: {
              import_log_id: importLogId,
              source: 'mhlw_price',
              yj_code: record.yj_code,
              drug_master_id: saved.id,
              ...change,
            },
          }),
        ),
      );
    }),
  );
}

export async function importMhlwPriceList(
  db: MhlwPriceImportDbClient,
  options: ImportMhlwPriceListOptions = {},
) {
  return withImportLog(db, 'mhlw_price', async (log) => {
    const fetchImpl = options.fetchImpl ?? fetch;
    let workbookUrls: string[];
    if (options.workbookUrls) {
      workbookUrls = options.workbookUrls.map((url) =>
        normalizeImportSourceUrl(url, MHLW_IMPORT_URL_POLICY),
      );
    } else if (options.workbookUrl) {
      workbookUrls = [normalizeImportSourceUrl(options.workbookUrl, MHLW_IMPORT_URL_POLICY)];
    } else {
      const page = await fetchLatestMhlwPriceListPage(fetchImpl);
      workbookUrls = resolveLatestMhlwPriceWorkbookUrls(page.html, page.priceListPageUrl);
    }

    let recordCount = 0;
    for (const workbookUrl of workbookUrls) {
      const parsed = await parseMhlwPriceWorkbook({ workbookUrl, fetchImpl });
      recordCount += parsed.records.length;

      for (let index = 0; index < parsed.records.length; index += 200) {
        await upsertPriceChunk(db, parsed.records.slice(index, index + 200), 'price', log.id);
      }
    }

    return {
      recordCount,
      payload: {
        workbookUrl: workbookUrls[0] ?? null,
        workbookUrls,
      },
    };
  });
}

export async function importMhlwGenericFlags(
  db: MhlwPriceImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {},
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
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workbookUrl = normalizeImportSourceUrl(
    options.workbookUrl ??
      resolveLatestGenericNameWorkbookUrl(
        await fetchText(MHLW_MASTER_INDEX_PAGE_URL, {
          fetchImpl,
          policy: MHLW_IMPORT_URL_POLICY,
        }),
      ),
    MHLW_IMPORT_URL_POLICY,
  );
  const buffer = await fetchBytes(workbookUrl, {
    fetchImpl,
    policy: MHLW_IMPORT_URL_POLICY,
  });
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
  db: MhlwGenericMappingImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {},
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

        return false;
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
      current.exception_codes = [
        ...new Set([...current.exception_codes, ...entry.exception_codes]),
      ];
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
  candidates: ParsedGenericNameEntry['brand_candidates'],
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
