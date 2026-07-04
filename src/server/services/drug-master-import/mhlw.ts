import { Prisma } from '@prisma/client';
import { allocateGlobalDisplayId } from '@/lib/db/display-id';
import {
  FetchLike,
  MHLW_IMPORT_URL_POLICY,
  type DrugMasterImportLogDbClient,
  combineImportSourceFingerprints,
  fetchBytes,
  fetchText,
  normalizeCell,
  normalizeImportSourceUrl,
  extractImportSourceDateFromUrl,
  parseJapaneseEraApplicableDateText,
  parseDate,
  parseDecimal,
  resolveImportSourceUrl,
  sha256ImportPayload,
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

type ParsedMhlwPriceWorkbook = {
  workbookUrl: string;
  sourceFileHash: string;
  records: ParsedMhlwPriceRecord[];
  skippedInvalidYjCount: number;
};

type MhlwPriceWorkbookSources = {
  workbookUrls: string[];
  applicableDate: Date | null;
};

type ParseMhlwPriceWorkbookOptions = {
  workbookUrl?: string;
  fetchImpl?: FetchLike;
};

type ImportMhlwPriceListOptions = ParseMhlwPriceWorkbookOptions & {
  workbookUrls?: string[];
};
type PreviewMhlwPriceListOptions = ImportMhlwPriceListOptions & {
  previewLimit?: number;
};
type MhlwPriceImportDbClient = DrugMasterImportLogDbClient & {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  $transaction?: <T>(fn: (tx: MhlwPriceVersionTransactionClient) => Promise<T>) => Promise<T>;
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany' | 'upsert'>;
  drugMasterChangeEvent: Pick<Prisma.TransactionClient['drugMasterChangeEvent'], 'create'>;
  drugPriceVersion: Pick<
    Prisma.TransactionClient['drugPriceVersion'],
    'findUnique' | 'create' | 'update' | 'updateMany'
  >;
};
type MhlwPriceVersionTransactionClient = Pick<Prisma.TransactionClient, '$queryRaw'> & {
  drugPriceVersion: Pick<
    Prisma.TransactionClient['drugPriceVersion'],
    'findUnique' | 'create' | 'update' | 'updateMany'
  >;
};
type MhlwPricePreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  drugPriceVersion?: Pick<Prisma.TransactionClient['drugPriceVersion'], 'findMany'>;
};
type MhlwPriceDrugLookupDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};
type MhlwGenericMappingImportDbClient = DrugMasterImportLogDbClient & {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  genericDrugMapping: Pick<Prisma.TransactionClient['genericDrugMapping'], 'create' | 'deleteMany'>;
};
type MhlwGenericFlagsPreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};
type MhlwGenericMappingPreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};
type PreviewMhlwGenericOptions = {
  workbookUrl?: string;
  fetchImpl?: FetchLike;
  previewLimit?: number;
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
type ParsedGenericNameWorkbook = {
  workbookUrl: string;
  sourceFileHash: string;
  entries: Array<Omit<ParsedGenericNameEntry, 'brand_candidates'>>;
  skippedInvalidYjCount: number;
};

type ExistingMhlwPriceDrug = {
  id: string;
  yj_code: string;
  drug_price: { toString: () => string } | null;
  transitional_expiry_date: Date | null;
};
type ExistingMhlwPriceVersion = {
  drug_master_id: string;
  effective_from: Date;
  drug_price: { toString: () => string } | null;
  transitional_expiry_date: Date | null;
};
type ExistingMhlwOpenPriceVersion = {
  drug_master_id: string;
  effective_from: Date;
};
type ExistingMhlwGenericFlagDrug = {
  yj_code: string;
  is_generic: boolean;
};
type GenericNameMappingDrugMaster = {
  id: string;
  yj_code: string;
  drug_name: string;
  generic_name: string | null;
  manufacturer: string | null;
};

export type MhlwPricePreviewRow = {
  yj_code: string;
  drug_name: string;
  action: 'upsert';
  price_version_action: 'create' | 'update' | 'noop' | 'skipped_missing_effective_from';
  price_version_effective_from: string | null;
  price_version_close_count: number;
  price_version_close_effective_to: string | null;
  change_event_types: Array<'price_changed' | 'transitional_expiry_changed'>;
  previous_drug_price: string | null;
  next_drug_price: string | null;
  previous_transitional_expiry_date: string | null;
  next_transitional_expiry_date: string | null;
};

export type MhlwPriceImportPreview = {
  dryRun: true;
  workbookUrl: string | null;
  workbookUrls: string[];
  sourceFileHash: string | null;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      workbook_count: number;
      parsed_records: number;
      drug_master_upsert_count: number;
      skipped_invalid_yj: number;
      records_with_change_event: number;
      change_event_count: number;
      price_version_create_count: number;
      price_version_update_count: number;
      price_version_close_count: number;
      price_version_skipped_missing_effective_from: number;
      sampled_rows: number;
    };
    rows: MhlwPricePreviewRow[];
  };
};

export type MhlwGenericFlagPreviewRow = {
  yj_code: string;
  drug_name: string;
  action: 'upsert_generic_flag';
  previous_is_generic: boolean | null;
  next_is_generic: boolean;
};

export type MhlwGenericFlagImportPreview = {
  dryRun: true;
  operation: 'generic_flags';
  workbookUrl: string;
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      drug_master_upsert_count: number;
      skipped_invalid_yj: number;
      changed_flag_count: number;
      sampled_rows: number;
    };
    rows: MhlwGenericFlagPreviewRow[];
  };
};

export type MhlwGenericMappingPreviewRow = {
  generic_name: string;
  standard_name: string;
  action: 'replace_mapping';
  brand_candidate_count: number;
  exception_code_count: number;
  lowest_price: string | null;
  add_on_scope: string | null;
  brand_candidates: Array<{
    yj_code: string;
    drug_name: string;
    manufacturer: string | null;
  }>;
};

export type MhlwGenericMappingImportPreview = {
  dryRun: true;
  operation: 'generic_mapping';
  workbookUrl: string;
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      generic_mapping_replace_count: number;
      brand_candidate_count: number;
      skipped_invalid_yj: number;
      sampled_rows: number;
    };
    rows: MhlwGenericMappingPreviewRow[];
  };
};

const DEFAULT_PREVIEW_ROW_LIMIT = 20;
const MAX_PREVIEW_ROW_LIMIT = 100;

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
    applicableDate: parseJapaneseEraApplicableDateText(match[2]),
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
    applicableDate: metadata.applicableDate ?? parseJapaneseEraApplicableDateText(priceListHtml),
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

  for (const row of rows.slice(headerIndex + 1)) {
    const rawYjCode = readCell(row, headerMap, '薬価基準収載医薬品コード');
    const yjCode = normalizeMhlwYjCode(rawYjCode);
    const drugName = readCell(row, headerMap, '品名');
    if (!yjCode || !drugName) {
      if (rawYjCode && !yjCode) skippedInvalidYjCount += 1;
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
      transitional_expiry_date: parseDate(readCell(row, headerMap, '経過措置による使用期限')),
    });
  }

  return {
    workbookUrl,
    sourceFileHash: sha256ImportPayload(workbookBuffer),
    records,
    skippedInvalidYjCount,
  };
}

function normalizePreviewLimit(value: number | undefined) {
  if (value == null) return DEFAULT_PREVIEW_ROW_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_ROW_LIMIT;
  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) return DEFAULT_PREVIEW_ROW_LIMIT;
  return Math.min(normalized, MAX_PREVIEW_ROW_LIMIT);
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
  return extractImportSourceDateFromUrl(workbookUrl, [/tp(\d{8})-/i]) ?? fallbackApplicableDate;
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
  const previewLimit = normalizePreviewLimit(options.previewLimit);
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

  for (const workbookUrl of workbookUrls) {
    const parsed = await parseMhlwPriceWorkbook({ workbookUrl, fetchImpl });
    recordCount += parsed.records.length;
    skippedInvalidYjCount += parsed.skippedInvalidYjCount;
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

    let recordCount = 0;
    let skippedInvalidYjCount = 0;
    let changeEventCount = 0;
    let priceVersionCreateCount = 0;
    let priceVersionUpdateCount = 0;
    let priceVersionCloseCount = 0;
    let priceVersionSkippedMissingEffectiveFrom = 0;
    const sourceFingerprints: Array<{ sourceUrl: string; sourceFileHash: string }> = [];
    for (const workbookUrl of workbookUrls) {
      const parsed = await parseMhlwPriceWorkbook({ workbookUrl, fetchImpl });
      const sourcePublishedAt = resolveMhlwPriceEffectiveDate(
        parsed.workbookUrl,
        workbookSources.applicableDate,
      );
      recordCount += parsed.records.length;
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
      importMode: 'full',
      changeSummary: {
        mode: 'full',
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
  const previewLimit = normalizePreviewLimit(options.previewLimit);
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
    sourcePublishedAt:
      extractImportSourceDateFromUrl(parsed.workbookUrl, [/tp(\d{8})-/i])?.toISOString() ?? null,
    preview: {
      summary: {
        parsed_records: parsed.records.length,
        drug_master_upsert_count: parsed.records.length,
        skipped_invalid_yj: parsed.skippedInvalidYjCount,
        changed_flag_count: changedFlagCount,
        sampled_rows: rows.length,
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

    for (let index = 0; index < parsed.records.length; index += 200) {
      await upsertPriceChunk(db, parsed.records.slice(index, index + 200), 'generic');
    }

    return {
      recordCount: parsed.records.length,
      sourceUrl: parsed.workbookUrl,
      sourceFileHash: parsed.sourceFileHash,
      sourcePublishedAt: extractImportSourceDateFromUrl(parsed.workbookUrl, [/tp(\d{8})-/i]),
      importMode: 'full',
      changeSummary: {
        mode: 'full',
        operation: 'generic_flags',
        parsed_records: parsed.records.length,
        imported_records: parsed.records.length,
        skipped_invalid_yj: parsed.skippedInvalidYjCount,
      },
      payload: {
        workbookUrl: parsed.workbookUrl,
      },
    };
  });
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
  const previewLimit = normalizePreviewLimit(options.previewLimit);
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
    sourcePublishedAt:
      extractImportSourceDateFromUrl(parsed.workbookUrl, [/_(\d{6})\.xlsx$/i])?.toISOString() ??
      null,
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
      sourcePublishedAt: extractImportSourceDateFromUrl(parsed.workbookUrl, [/_(\d{6})\.xlsx$/i]),
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
