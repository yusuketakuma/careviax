import { Prisma } from '@prisma/client';
import { allocateGlobalDisplayId } from '@/lib/db/display-id';
import {
  FetchLike,
  MHLW_IMPORT_URL_POLICY,
  assertDateQuarantineAllowsImport,
  combineImportSourceFingerprints,
  createDateQuarantineSummary,
  dateQuarantineSummaryFields,
  extractStrictImportSourceDateFromUrl,
  extractStrictJapaneseEraApplicableDateText,
  fetchBytes,
  fetchText,
  mergeDateQuarantineSummary,
  normalizeCell,
  normalizePreviewRowLimit,
  normalizeImportSourceUrl,
  parseDrugMasterDate,
  parseDecimal,
  recordDateQuarantine,
  resolveDateQuarantineImportMode,
  resolveImportSourceUrl,
  sha256ImportPayload,
  withImportLog,
} from './shared';
import { loadWorkbook, readWorkbookRowsFromWorkbook } from './excel';

import {
  MHLW_MASTER_INDEX_PAGE_URL,
  type ExistingMhlwGenericFlagDrug,
  type ExistingMhlwOpenPriceVersion,
  type ExistingMhlwPriceDrug,
  type ExistingMhlwPriceVersion,
  type ImportMhlwPriceListOptions,
  type MhlwGenericFlagsPreviewDbClient,
  type MhlwGenericFlagImportPreview,
  type MhlwGenericFlagPreviewRow,
  type MhlwPriceDrugLookupDbClient,
  type MhlwPriceImportDbClient,
  type MhlwPriceImportPreview,
  type MhlwPricePreviewDbClient,
  type MhlwPricePreviewRow,
  type MhlwPriceWorkbookSources,
  type ParseMhlwPriceWorkbookOptions,
  type ParsedMhlwPriceRecord,
  type ParsedMhlwPriceWorkbook,
  type PreviewMhlwGenericOptions,
  type PreviewMhlwPriceListOptions,
} from './mhlw-contract';
export * from './mhlw-contract';

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

function previousUtcDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
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

function normalizeMhlwYjCode(value: string | null) {
  const normalized = normalizeCell(value)?.toUpperCase() ?? null;
  if (!normalized) return null;
  return /^[0-9]{7}[A-Z][0-9]{4}$/.test(normalized) ? normalized : null;
}

export function resolveLatestMhlwPriceListPageUrl(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  return resolveLatestMhlwPriceListPageMetadata(html, pageUrl).priceListPageUrl;
}

export function resolveLatestMhlwPriceListPageMetadata(
  html: string,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const match = html.match(
    /<a\b[^>]*href="([^"]*\/topics\/\d{4}\/\d{2}\/tp\d{8}-01\.html)"[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!match) {
    throw new Error('最新の薬価基準収載品目ページを解決できませんでした');
  }
  return {
    priceListPageUrl: resolveImportSourceUrl(match[1], pageUrl, MHLW_IMPORT_URL_POLICY),
    applicableDate: extractStrictJapaneseEraApplicableDateText(match[2]),
  };
}

async function fetchLatestMhlwPriceListPage(
  fetchImpl: FetchLike,
  pageUrl = MHLW_MASTER_INDEX_PAGE_URL,
) {
  const indexHtml = await fetchText(pageUrl, {
    fetchImpl,
    policy: MHLW_IMPORT_URL_POLICY,
  });
  const metadata = resolveLatestMhlwPriceListPageMetadata(indexHtml, pageUrl);
  const priceListHtml = await fetchText(metadata.priceListPageUrl, {
    fetchImpl,
    policy: MHLW_IMPORT_URL_POLICY,
  });

  return {
    priceListPageUrl: metadata.priceListPageUrl,
    applicableDate:
      metadata.applicableDate ?? extractStrictJapaneseEraApplicableDateText(priceListHtml),
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

export {
  importGenericNameMappings,
  parseGenericNameWorkbook,
  previewGenericNameMappings,
  resolveLatestGenericNameWorkbookUrl,
} from './mhlw-generic';

export async function parseMhlwPriceWorkbook(
  options: ParseMhlwPriceWorkbookOptions = {},
): Promise<ParsedMhlwPriceWorkbook> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let resolvedWorkbookUrl = options.workbookUrl;
  if (!resolvedWorkbookUrl) {
    const page = await fetchLatestMhlwPriceListPage(fetchImpl);
    resolvedWorkbookUrl = resolveLatestMhlwPriceWorkbookUrl(page.html, page.priceListPageUrl);
  }
  const workbookUrl = normalizeImportSourceUrl(resolvedWorkbookUrl, MHLW_IMPORT_URL_POLICY);

  const workbookBuffer = await fetchBytes(workbookUrl, {
    fetchImpl,
    policy: MHLW_IMPORT_URL_POLICY,
  });
  const rows = await loadPriceWorkbookRows(workbookBuffer);
  const headerIndex = findHeaderIndex(rows, '薬価基準収載医薬品コード');
  const headerMap = indexHeaderMap(rows[headerIndex]);
  const records: ParsedMhlwPriceRecord[] = [];
  let skippedInvalidYjCount = 0;
  let candidateRecordCount = 0;
  const dateQuarantine = createDateQuarantineSummary();

  for (const row of rows.slice(headerIndex + 1)) {
    const rawYjCode = readCell(row, headerMap, '薬価基準収載医薬品コード');
    const yjCode = normalizeMhlwYjCode(rawYjCode);
    const drugName = readCell(row, headerMap, '品名');
    if (!yjCode || !drugName) {
      if (rawYjCode && !yjCode) skippedInvalidYjCount += 1;
      continue;
    }
    candidateRecordCount += 1;

    const transitionalExpiry = parseDrugMasterDate(
      readCell(row, headerMap, '経過措置による使用期限'),
    );
    if (transitionalExpiry.status === 'invalid') {
      recordDateQuarantine(dateQuarantine, transitionalExpiry.reason);
      continue;
    }

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
      transitional_expiry_date:
        transitionalExpiry.status === 'valid' ? transitionalExpiry.date : null,
    });
  }

  return {
    workbookUrl,
    sourceFileHash: sha256ImportPayload(workbookBuffer),
    records,
    skippedInvalidYjCount,
    candidateRecordCount,
    dateQuarantine,
  };
}

async function resolveMhlwPriceWorkbookSources(
  options: ImportMhlwPriceListOptions,
): Promise<MhlwPriceWorkbookSources> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.workbookUrls) {
    return {
      workbookUrls: options.workbookUrls.map((url) =>
        normalizeImportSourceUrl(url, MHLW_IMPORT_URL_POLICY),
      ),
      applicableDate: null,
    };
  }
  if (options.workbookUrl) {
    return {
      workbookUrls: [normalizeImportSourceUrl(options.workbookUrl, MHLW_IMPORT_URL_POLICY)],
      applicableDate: null,
    };
  }
  const page = await fetchLatestMhlwPriceListPage(fetchImpl);
  return {
    workbookUrls: resolveLatestMhlwPriceWorkbookUrls(page.html, page.priceListPageUrl),
    applicableDate: page.applicableDate,
  };
}

function resolveMhlwPriceEffectiveDate(workbookUrl: string, fallbackApplicableDate: Date | null) {
  return (
    extractStrictImportSourceDateFromUrl(workbookUrl, [/tp(\d{8})-/i]) ?? fallbackApplicableDate
  );
}

function collectMhlwPriceChanges(
  record: ParsedMhlwPriceRecord,
  existing: ExistingMhlwPriceDrug | undefined,
) {
  if (!existing) return [];

  const previousPrice = existing.drug_price?.toString() ?? null;
  const currentPrice = record.drug_price?.toString() ?? null;
  const previousExpiry = existing.transitional_expiry_date?.toISOString() ?? null;
  const currentExpiry = record.transitional_expiry_date?.toISOString() ?? null;
  const changes: Array<{
    change_type: 'price_changed' | 'transitional_expiry_changed';
    previous_value: Prisma.InputJsonValue;
    current_value: Prisma.InputJsonValue;
    previous_drug_price: string | null;
    next_drug_price: string | null;
    previous_transitional_expiry_date: string | null;
    next_transitional_expiry_date: string | null;
  }> = [];

  if (previousPrice !== currentPrice) {
    changes.push({
      change_type: 'price_changed',
      previous_value: { drug_price: previousPrice },
      current_value: { drug_price: currentPrice },
      previous_drug_price: previousPrice,
      next_drug_price: currentPrice,
      previous_transitional_expiry_date: previousExpiry,
      next_transitional_expiry_date: currentExpiry,
    });
  }
  if (previousExpiry !== currentExpiry) {
    changes.push({
      change_type: 'transitional_expiry_changed',
      previous_value: { transitional_expiry_date: previousExpiry },
      current_value: { transitional_expiry_date: currentExpiry },
      previous_drug_price: previousPrice,
      next_drug_price: currentPrice,
      previous_transitional_expiry_date: previousExpiry,
      next_transitional_expiry_date: currentExpiry,
    });
  }

  return changes;
}

async function fetchExistingMhlwPriceDrugsByYjCode(
  db: MhlwPriceDrugLookupDbClient,
  records: ParsedMhlwPriceRecord[],
) {
  if (records.length === 0) return new Map<string, ExistingMhlwPriceDrug>();
  const rows = await db.drugMaster.findMany({
    where: { yj_code: { in: records.map((record) => record.yj_code) } },
    select: {
      id: true,
      yj_code: true,
      drug_price: true,
      transitional_expiry_date: true,
    },
  });
  return new Map(rows.map((drug) => [drug.yj_code, drug]));
}

async function fetchExistingMhlwPriceVersionsByDrugId(
  db: MhlwPricePreviewDbClient,
  drugIds: string[],
  effectiveFrom: Date | null,
) {
  if (!db.drugPriceVersion || !effectiveFrom || drugIds.length === 0) {
    return new Map<string, ExistingMhlwPriceVersion>();
  }

  const rows = await db.drugPriceVersion.findMany({
    where: {
      drug_master_id: { in: drugIds },
      effective_from: effectiveFrom,
    },
    select: {
      drug_master_id: true,
      effective_from: true,
      drug_price: true,
      transitional_expiry_date: true,
    },
  });
  return new Map(rows.map((version) => [version.drug_master_id, version]));
}

async function fetchPriorOpenMhlwPriceVersionsByDrugId(
  db: MhlwPricePreviewDbClient,
  drugIds: string[],
  effectiveFrom: Date | null,
) {
  if (!db.drugPriceVersion || !effectiveFrom || drugIds.length === 0) {
    return new Map<string, ExistingMhlwOpenPriceVersion[]>();
  }

  const rows = await db.drugPriceVersion.findMany({
    where: {
      drug_master_id: { in: drugIds },
      effective_from: { lt: effectiveFrom },
      effective_to: null,
    },
    select: {
      drug_master_id: true,
      effective_from: true,
    },
  });
  return rows.reduce((map, version) => {
    const versions = map.get(version.drug_master_id) ?? [];
    versions.push(version);
    map.set(version.drug_master_id, versions);
    return map;
  }, new Map<string, ExistingMhlwOpenPriceVersion[]>());
}

function resolveMhlwPriceVersionAction(args: {
  record: ParsedMhlwPriceRecord;
  existing: ExistingMhlwPriceDrug | undefined;
  existingVersion: ExistingMhlwPriceVersion | undefined;
  effectiveFrom: Date | null;
}): MhlwPricePreviewRow['price_version_action'] {
  if (!args.effectiveFrom) return 'skipped_missing_effective_from';
  if (!args.existing || !args.existingVersion) return 'create';

  const previousPrice = args.existingVersion.drug_price?.toString() ?? null;
  const currentPrice = args.record.drug_price?.toString() ?? null;
  const previousExpiry = args.existingVersion.transitional_expiry_date?.toISOString() ?? null;
  const currentExpiry = args.record.transitional_expiry_date?.toISOString() ?? null;
  return previousPrice === currentPrice && previousExpiry === currentExpiry ? 'noop' : 'update';
}

function requirePriceVersionTransaction(
  db: MhlwPriceImportDbClient,
): NonNullable<MhlwPriceImportDbClient['$transaction']> {
  if (!db.$transaction) {
    throw new Error('MHLW price version import requires transaction support');
  }
  return db.$transaction;
}

async function upsertMhlwPriceVersion(
  db: MhlwPriceImportDbClient,
  args: {
    drugMasterId: string;
    importLogId?: string;
    record: ParsedMhlwPriceRecord;
    metadata: {
      sourceUrl: string;
      sourceFileHash: string;
      sourcePublishedAt: Date;
    };
  },
): Promise<{
  versionAction: MhlwPricePreviewRow['price_version_action'];
  closeCount: number;
}> {
  return requirePriceVersionTransaction(db)(async (tx) => {
    const existingVersion = await tx.drugPriceVersion.findUnique({
      where: {
        drug_master_id_effective_from: {
          drug_master_id: args.drugMasterId,
          effective_from: args.metadata.sourcePublishedAt,
        },
      },
      select: {
        id: true,
      },
    });
    const versionData = {
      import_log_id: args.importLogId ?? null,
      source: 'mhlw_price' as const,
      source_url: args.metadata.sourceUrl,
      source_file_hash: args.metadata.sourceFileHash,
      source_published_at: args.metadata.sourcePublishedAt,
      drug_price: args.record.drug_price,
      transitional_expiry_date: args.record.transitional_expiry_date,
    };
    if (existingVersion) {
      await tx.drugPriceVersion.update({
        where: { id: existingVersion.id },
        data: versionData,
      });
      return { versionAction: 'update', closeCount: 0 };
    }

    const displayId = await allocateGlobalDisplayId(tx, 'DrugPriceVersion');
    await tx.drugPriceVersion.create({
      data: {
        display_id: displayId,
        drug_master_id: args.drugMasterId,
        effective_from: args.metadata.sourcePublishedAt,
        ...versionData,
      },
    });
    const closeResult = await tx.drugPriceVersion.updateMany({
      where: {
        drug_master_id: args.drugMasterId,
        effective_from: { lt: args.metadata.sourcePublishedAt },
        effective_to: null,
      },
      data: {
        effective_to: previousUtcDate(args.metadata.sourcePublishedAt),
      },
    });
    return { versionAction: 'create', closeCount: closeResult.count };
  });
}

async function fetchExistingMhlwGenericFlagsByYjCode(
  db: MhlwGenericFlagsPreviewDbClient,
  records: ParsedMhlwPriceRecord[],
) {
  if (records.length === 0) return new Map<string, ExistingMhlwGenericFlagDrug>();
  const rows = await db.drugMaster.findMany({
    where: { yj_code: { in: records.map((record) => record.yj_code) } },
    select: {
      yj_code: true,
      is_generic: true,
    },
  });
  return new Map(rows.map((drug) => [drug.yj_code, drug]));
}

async function upsertPriceChunk(
  db: MhlwPriceImportDbClient,
  records: ParsedMhlwPriceRecord[],
  mode: 'price' | 'generic',
  importLogId?: string,
  priceVersionMetadata?: {
    sourceUrl: string;
    sourceFileHash: string;
    sourcePublishedAt: Date | null;
  },
) {
  const existingByYjCode =
    mode === 'price' ? await fetchExistingMhlwPriceDrugsByYjCode(db, records) : new Map();

  const results = await Promise.all(
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

      let versionAction: MhlwPricePreviewRow['price_version_action'] | null = null;
      let closeCount = 0;
      if (mode === 'price' && priceVersionMetadata) {
        if (priceVersionMetadata.sourcePublishedAt) {
          const versionResult = await upsertMhlwPriceVersion(db, {
            drugMasterId: saved.id,
            importLogId,
            record,
            metadata: {
              sourceUrl: priceVersionMetadata.sourceUrl,
              sourceFileHash: priceVersionMetadata.sourceFileHash,
              sourcePublishedAt: priceVersionMetadata.sourcePublishedAt,
            },
          });
          versionAction = versionResult.versionAction;
          closeCount = versionResult.closeCount;
        } else {
          versionAction = 'skipped_missing_effective_from';
        }
      }

      if (mode !== 'price' || !existing || !importLogId) {
        return { changeCount: 0, versionAction, closeCount };
      }

      const changes = collectMhlwPriceChanges(record, existing);
      if (changes.length === 0) return { changeCount: 0, versionAction, closeCount };
      await Promise.all(
        changes.map((change) =>
          db.drugMasterChangeEvent.create({
            data: {
              import_log_id: importLogId,
              source: 'mhlw_price',
              yj_code: record.yj_code,
              drug_master_id: saved.id,
              change_type: change.change_type,
              previous_value: change.previous_value,
              current_value: change.current_value,
            },
          }),
        ),
      );
      return { changeCount: changes.length, versionAction, closeCount };
    }),
  );

  return {
    changeCount: results.reduce((sum, result) => sum + result.changeCount, 0),
    priceVersionCreateCount: results.filter((result) => result.versionAction === 'create').length,
    priceVersionUpdateCount: results.filter((result) => result.versionAction === 'update').length,
    priceVersionCloseCount: results.reduce((sum, result) => sum + result.closeCount, 0),
    priceVersionSkippedMissingEffectiveFrom: results.filter(
      (result) => result.versionAction === 'skipped_missing_effective_from',
    ).length,
  };
}

export async function previewMhlwPriceList(
  db: MhlwPricePreviewDbClient,
  options: PreviewMhlwPriceListOptions = {},
): Promise<MhlwPriceImportPreview> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workbookSources = await resolveMhlwPriceWorkbookSources(options);
  const { workbookUrls } = workbookSources;
  const previewLimit = normalizePreviewRowLimit(options.previewLimit);
  const sourceFingerprints: Array<{ sourceUrl: string; sourceFileHash: string }> = [];
  const rows: MhlwPricePreviewRow[] = [];
  let recordCount = 0;
  let skippedInvalidYjCount = 0;
  let recordsWithChangeEvent = 0;
  let changeEventCount = 0;
  let priceVersionCreateCount = 0;
  let priceVersionUpdateCount = 0;
  let priceVersionCloseCount = 0;
  let priceVersionSkippedMissingEffectiveFrom = 0;
  const dateQuarantine = createDateQuarantineSummary();

  for (const workbookUrl of workbookUrls) {
    const parsed = await parseMhlwPriceWorkbook({ workbookUrl, fetchImpl });
    recordCount += parsed.records.length;
    skippedInvalidYjCount += parsed.skippedInvalidYjCount;
    mergeDateQuarantineSummary(dateQuarantine, parsed.dateQuarantine);
    sourceFingerprints.push({
      sourceUrl: parsed.workbookUrl,
      sourceFileHash: parsed.sourceFileHash,
    });
    const sourcePublishedAt = resolveMhlwPriceEffectiveDate(
      parsed.workbookUrl,
      workbookSources.applicableDate,
    );

    for (let index = 0; index < parsed.records.length; index += 200) {
      const chunk = parsed.records.slice(index, index + 200);
      const existingByYjCode = await fetchExistingMhlwPriceDrugsByYjCode(db, chunk);
      const existingVersionsByDrugId = await fetchExistingMhlwPriceVersionsByDrugId(
        db,
        [...existingByYjCode.values()].map((drug) => drug.id),
        sourcePublishedAt,
      );
      const priorOpenVersionsByDrugId = await fetchPriorOpenMhlwPriceVersionsByDrugId(
        db,
        [...existingByYjCode.values()].map((drug) => drug.id),
        sourcePublishedAt,
      );
      for (const record of chunk) {
        const existing = existingByYjCode.get(record.yj_code);
        const changes = collectMhlwPriceChanges(record, existing);
        const versionAction = resolveMhlwPriceVersionAction({
          record,
          existing,
          existingVersion: existing ? existingVersionsByDrugId.get(existing.id) : undefined,
          effectiveFrom: sourcePublishedAt,
        });
        if (versionAction === 'create') priceVersionCreateCount += 1;
        if (versionAction === 'update') priceVersionUpdateCount += 1;
        const closeCount =
          versionAction === 'create' && existing
            ? (priorOpenVersionsByDrugId.get(existing.id)?.length ?? 0)
            : 0;
        priceVersionCloseCount += closeCount;
        if (versionAction === 'skipped_missing_effective_from') {
          priceVersionSkippedMissingEffectiveFrom += 1;
        }
        if (changes.length > 0) {
          recordsWithChangeEvent += 1;
          changeEventCount += changes.length;
        }

        if (rows.length < previewLimit) {
          const firstChange = changes[0];
          const previousPrice = existing?.drug_price?.toString() ?? null;
          const currentPrice = record.drug_price?.toString() ?? null;
          const previousExpiry = existing?.transitional_expiry_date?.toISOString() ?? null;
          const currentExpiry = record.transitional_expiry_date?.toISOString() ?? null;
          rows.push({
            yj_code: record.yj_code,
            drug_name: record.drug_name,
            action: 'upsert',
            price_version_action: versionAction,
            price_version_effective_from: sourcePublishedAt?.toISOString() ?? null,
            price_version_close_count: closeCount,
            price_version_close_effective_to:
              closeCount > 0 && sourcePublishedAt
                ? previousUtcDate(sourcePublishedAt).toISOString()
                : null,
            change_event_types: changes.map((change) => change.change_type),
            previous_drug_price: firstChange?.previous_drug_price ?? previousPrice,
            next_drug_price: firstChange?.next_drug_price ?? currentPrice,
            previous_transitional_expiry_date:
              firstChange?.previous_transitional_expiry_date ?? previousExpiry,
            next_transitional_expiry_date:
              firstChange?.next_transitional_expiry_date ?? currentExpiry,
          });
        }
      }
    }
  }

  return {
    dryRun: true,
    workbookUrl: workbookUrls[0] ?? null,
    workbookUrls,
    sourceFileHash: combineImportSourceFingerprints(sourceFingerprints),
    sourcePublishedAt:
      workbookUrls[0] != null
        ? (resolveMhlwPriceEffectiveDate(
            workbookUrls[0],
            workbookSources.applicableDate,
          )?.toISOString() ?? null)
        : null,
    preview: {
      summary: {
        workbook_count: workbookUrls.length,
        parsed_records: recordCount,
        drug_master_upsert_count: recordCount,
        skipped_invalid_yj: skippedInvalidYjCount,
        records_with_change_event: recordsWithChangeEvent,
        change_event_count: changeEventCount,
        price_version_create_count: priceVersionCreateCount,
        price_version_update_count: priceVersionUpdateCount,
        price_version_close_count: priceVersionCloseCount,
        price_version_skipped_missing_effective_from: priceVersionSkippedMissingEffectiveFrom,
        sampled_rows: rows.length,
        ...dateQuarantineSummaryFields(dateQuarantine),
      },
      rows,
    },
  };
}

export async function importMhlwPriceList(
  db: MhlwPriceImportDbClient,
  options: ImportMhlwPriceListOptions = {},
) {
  return withImportLog(db, 'mhlw_price', async (log) => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const workbookSources = await resolveMhlwPriceWorkbookSources(options);
    const { workbookUrls } = workbookSources;
    const sourcePublishedAtByUrl = new Map(
      workbookUrls.map((workbookUrl) => [
        workbookUrl,
        resolveMhlwPriceEffectiveDate(workbookUrl, workbookSources.applicableDate),
      ]),
    );
    const parsedWorkbooks: ParsedMhlwPriceWorkbook[] = [];
    for (const workbookUrl of workbookUrls) {
      parsedWorkbooks.push(await parseMhlwPriceWorkbook({ workbookUrl, fetchImpl }));
    }

    const dateQuarantine = createDateQuarantineSummary();
    const recordCount = parsedWorkbooks.reduce((sum, parsed) => {
      mergeDateQuarantineSummary(dateQuarantine, parsed.dateQuarantine);
      return sum + parsed.records.length;
    }, 0);
    assertDateQuarantineAllowsImport(recordCount, dateQuarantine);
    const importMode = resolveDateQuarantineImportMode('full', dateQuarantine);
    let skippedInvalidYjCount = 0;
    let changeEventCount = 0;
    let priceVersionCreateCount = 0;
    let priceVersionUpdateCount = 0;
    let priceVersionCloseCount = 0;
    let priceVersionSkippedMissingEffectiveFrom = 0;
    const sourceFingerprints: Array<{ sourceUrl: string; sourceFileHash: string }> = [];
    for (const parsed of parsedWorkbooks) {
      const sourcePublishedAt = sourcePublishedAtByUrl.get(parsed.workbookUrl) ?? null;
      skippedInvalidYjCount += parsed.skippedInvalidYjCount;
      sourceFingerprints.push({
        sourceUrl: parsed.workbookUrl,
        sourceFileHash: parsed.sourceFileHash,
      });

      for (let index = 0; index < parsed.records.length; index += 200) {
        const chunkResult = await upsertPriceChunk(
          db,
          parsed.records.slice(index, index + 200),
          'price',
          log.id,
          {
            sourceUrl: parsed.workbookUrl,
            sourceFileHash: parsed.sourceFileHash,
            sourcePublishedAt,
          },
        );
        changeEventCount += chunkResult.changeCount;
        priceVersionCreateCount += chunkResult.priceVersionCreateCount;
        priceVersionUpdateCount += chunkResult.priceVersionUpdateCount;
        priceVersionCloseCount += chunkResult.priceVersionCloseCount;
        priceVersionSkippedMissingEffectiveFrom +=
          chunkResult.priceVersionSkippedMissingEffectiveFrom;
      }
    }

    return {
      recordCount,
      sourceUrl: workbookUrls[0] ?? null,
      sourceFileHash: combineImportSourceFingerprints(sourceFingerprints),
      sourcePublishedAt:
        workbookUrls[0] != null
          ? resolveMhlwPriceEffectiveDate(workbookUrls[0], workbookSources.applicableDate)
          : null,
      importMode,
      changeSummary: {
        mode: importMode,
        workbook_count: workbookUrls.length,
        parsed_records: recordCount,
        imported_records: recordCount,
        skipped_invalid_yj: skippedInvalidYjCount,
        change_event_count: changeEventCount,
        price_version_effective_from_source: 'source_published_at',
        price_version_create_count: priceVersionCreateCount,
        price_version_update_count: priceVersionUpdateCount,
        price_version_close_count: priceVersionCloseCount,
        price_version_skipped_missing_effective_from: priceVersionSkippedMissingEffectiveFrom,
        ...dateQuarantineSummaryFields(dateQuarantine),
      },
      payload: {
        workbookUrl: workbookUrls[0] ?? null,
        workbookUrls,
      },
    };
  });
}

export async function previewMhlwGenericFlags(
  db: MhlwGenericFlagsPreviewDbClient,
  options: PreviewMhlwGenericOptions = {},
): Promise<MhlwGenericFlagImportPreview> {
  const parsed = await parseMhlwPriceWorkbook(options);
  const sourcePublishedAt = extractStrictImportSourceDateFromUrl(parsed.workbookUrl, [
    /tp(\d{8})-/i,
  ]);
  const previewLimit = normalizePreviewRowLimit(options.previewLimit);
  const rows: MhlwGenericFlagPreviewRow[] = [];
  let changedFlagCount = 0;

  for (let index = 0; index < parsed.records.length; index += 200) {
    const chunk = parsed.records.slice(index, index + 200);
    const existingByYjCode = await fetchExistingMhlwGenericFlagsByYjCode(db, chunk);

    for (const record of chunk) {
      const existing = existingByYjCode.get(record.yj_code);
      if (!existing || existing.is_generic !== record.is_generic) {
        changedFlagCount += 1;
      }

      if (rows.length < previewLimit) {
        rows.push({
          yj_code: record.yj_code,
          drug_name: record.drug_name,
          action: 'upsert_generic_flag',
          previous_is_generic: existing?.is_generic ?? null,
          next_is_generic: record.is_generic,
        });
      }
    }
  }

  return {
    dryRun: true,
    operation: 'generic_flags',
    workbookUrl: parsed.workbookUrl,
    sourceFileHash: parsed.sourceFileHash,
    sourcePublishedAt: sourcePublishedAt?.toISOString() ?? null,
    preview: {
      summary: {
        parsed_records: parsed.records.length,
        drug_master_upsert_count: parsed.records.length,
        skipped_invalid_yj: parsed.skippedInvalidYjCount,
        changed_flag_count: changedFlagCount,
        sampled_rows: rows.length,
        ...dateQuarantineSummaryFields(parsed.dateQuarantine),
      },
      rows,
    },
  };
}

export async function importMhlwGenericFlags(
  db: MhlwPriceImportDbClient,
  options: { workbookUrl?: string; fetchImpl?: FetchLike } = {},
) {
  return withImportLog(db, 'mhlw_generic', async () => {
    const parsed = await parseMhlwPriceWorkbook(options);
    const sourcePublishedAt = extractStrictImportSourceDateFromUrl(parsed.workbookUrl, [
      /tp(\d{8})-/i,
    ]);
    assertDateQuarantineAllowsImport(parsed.records.length, parsed.dateQuarantine);
    const importMode = resolveDateQuarantineImportMode('full', parsed.dateQuarantine);

    for (let index = 0; index < parsed.records.length; index += 200) {
      await upsertPriceChunk(db, parsed.records.slice(index, index + 200), 'generic');
    }

    return {
      recordCount: parsed.records.length,
      sourceUrl: parsed.workbookUrl,
      sourceFileHash: parsed.sourceFileHash,
      sourcePublishedAt,
      importMode,
      changeSummary: {
        mode: importMode,
        operation: 'generic_flags',
        parsed_records: parsed.records.length,
        imported_records: parsed.records.length,
        skipped_invalid_yj: parsed.skippedInvalidYjCount,
        ...dateQuarantineSummaryFields(parsed.dateQuarantine),
      },
      payload: {
        workbookUrl: parsed.workbookUrl,
      },
    };
  });
}
