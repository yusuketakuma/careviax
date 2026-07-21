import { Prisma } from '@prisma/client';
import {
  MHLW_IMPORT_URL_POLICY,
  extractStrictImportSourceDateFromUrl,
  fetchBytes,
  fetchText,
  normalizeCell,
  normalizeImportSourceUrl,
  normalizePreviewRowLimit,
  parseDecimal,
  resolveImportSourceUrl,
  sha256ImportPayload,
  withImportLog,
  type FetchLike,
} from './shared';
import { loadWorkbook, readWorkbookRowsFromWorkbook } from './excel';
import {
  MHLW_MASTER_INDEX_PAGE_URL,
  type GenericNameMappingDrugMaster,
  type MhlwGenericMappingImportDbClient,
  type MhlwGenericMappingImportPreview,
  type MhlwGenericMappingPreviewDbClient,
  type ParsedGenericNameEntry,
  type ParsedGenericNameWorkbook,
  type PreviewMhlwGenericOptions,
} from './mhlw-contract';

function findHeaderIndex(rows: Array<Array<string | null>>, requiredHeader: string) {
  const index = rows.findIndex((row) => row.some((cell) => normalizeCell(cell) === requiredHeader));
  if (index < 0) {
    throw new Error(`Excel内に必要なヘッダー '${requiredHeader}' が見つかりませんでした`);
  }
  return index;
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

function normalizeMhlwYjCode(value: string | null) {
  const normalized = normalizeCell(value)?.toUpperCase() ?? null;
  if (!normalized) return null;
  return /^[0-9]{7}[A-Z][0-9]{4}$/.test(normalized) ? normalized : null;
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

export async function parseGenericNameWorkbook(
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<ParsedGenericNameWorkbook> {
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
  let skippedInvalidYjCount = 0;

  for (const row of exceptionRows.slice(exceptionHeaderIndex + 1)) {
    const genericCode: string | null =
      readCell(row, exceptionHeaderMap, '一般名コード') ?? lastGenericCode;
    const rawYjCode = readCell(row, exceptionHeaderMap, '薬価基準収載医薬品コード');
    if (!genericCode) continue;
    lastGenericCode = genericCode;

    if (rawYjCode) {
      const yjCode = normalizeMhlwYjCode(rawYjCode);
      if (!yjCode) {
        skippedInvalidYjCount += 1;
        continue;
      }
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
    sourceFileHash: sha256ImportPayload(buffer),
    entries,
    skippedInvalidYjCount,
  };
}

function buildGenericNameMappingRecords(
  entries: Array<Omit<ParsedGenericNameEntry, 'brand_candidates'>>,
  masters: GenericNameMappingDrugMaster[],
) {
  const grouped = new Map<string, ParsedGenericNameEntry>();

  for (const entry of entries) {
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
    current.exception_codes = [...new Set([...current.exception_codes, ...entry.exception_codes])];
    current.lowest_price = current.lowest_price ?? entry.lowest_price;
  }

  return [...grouped.values()];
}

function countGenericMappingBrandCandidates(records: ParsedGenericNameEntry[]) {
  return records.reduce((sum, record) => sum + record.brand_candidates.length, 0);
}

function buildDrugMasterIdByYjCode(masters: GenericNameMappingDrugMaster[]) {
  return new Map(masters.map((master) => [master.yj_code, master.id]));
}

function buildGenericMappingBrandDrugIds(
  record: ParsedGenericNameEntry,
  masterIdByYjCode: Map<string, string>,
) {
  return record.brand_candidates
    .map((candidate) => masterIdByYjCode.get(candidate.yj_code))
    .filter((value): value is string => Boolean(value));
}

export async function previewGenericNameMappings(
  db: MhlwGenericMappingPreviewDbClient,
  options: PreviewMhlwGenericOptions = {},
): Promise<MhlwGenericMappingImportPreview> {
  const parsed = await parseGenericNameWorkbook(options);
  const sourcePublishedAt = extractStrictImportSourceDateFromUrl(parsed.workbookUrl, [
    /_(\d{6})\.xlsx$/i,
  ]);
  const previewLimit = normalizePreviewRowLimit(options.previewLimit);
  const masters = await db.drugMaster.findMany({
    select: {
      id: true,
      yj_code: true,
      drug_name: true,
      generic_name: true,
      manufacturer: true,
    },
  });
  const records = buildGenericNameMappingRecords(parsed.entries, masters);
  const rows = records.slice(0, previewLimit).map((record) => ({
    generic_name: record.generic_name,
    standard_name: record.standard_name,
    action: 'replace_mapping' as const,
    brand_candidate_count: record.brand_candidates.length,
    exception_code_count: record.exception_codes.length,
    lowest_price: record.lowest_price?.toString() ?? null,
    add_on_scope: record.add_on_scope,
    brand_candidates: record.brand_candidates,
  }));

  return {
    dryRun: true,
    operation: 'generic_mapping',
    workbookUrl: parsed.workbookUrl,
    sourceFileHash: parsed.sourceFileHash,
    sourcePublishedAt: sourcePublishedAt?.toISOString() ?? null,
    preview: {
      summary: {
        parsed_records: parsed.entries.length,
        generic_mapping_replace_count: records.length,
        brand_candidate_count: countGenericMappingBrandCandidates(records),
        skipped_invalid_yj: parsed.skippedInvalidYjCount,
        sampled_rows: rows.length,
      },
      rows,
    },
  };
}

export async function importGenericNameMappings(
  db: MhlwGenericMappingImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {},
) {
  return withImportLog(db, 'mhlw_generic', async () => {
    const parsed = await parseGenericNameWorkbook(options);
    const sourcePublishedAt = extractStrictImportSourceDateFromUrl(parsed.workbookUrl, [
      /_(\d{6})\.xlsx$/i,
    ]);
    const masters = await db.drugMaster.findMany({
      select: {
        id: true,
        yj_code: true,
        drug_name: true,
        generic_name: true,
        manufacturer: true,
      },
    });
    const records = buildGenericNameMappingRecords(parsed.entries, masters);
    const masterIdByYjCode = buildDrugMasterIdByYjCode(masters);

    await db.genericDrugMapping.deleteMany({});

    for (const record of records) {
      await db.genericDrugMapping.create({
        data: {
          generic_name: record.generic_name,
          brand_drug_ids: buildGenericMappingBrandDrugIds(record, masterIdByYjCode),
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
      sourceUrl: parsed.workbookUrl,
      sourceFileHash: parsed.sourceFileHash,
      sourcePublishedAt,
      importMode: 'full',
      changeSummary: {
        mode: 'full',
        operation: 'generic_mapping',
        parsed_records: parsed.entries.length,
        imported_records: records.length,
        brand_candidate_count: countGenericMappingBrandCandidates(records),
        skipped_invalid_yj: parsed.skippedInvalidYjCount,
      },
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
