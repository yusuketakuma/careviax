import {
  decodeTextBuffer,
  FetchLike,
  HOT_IMPORT_URL_POLICY,
  type DrugMasterImportLogDbClient,
  ZipExpansionLimits,
  fetchBytes,
  extractImportSourceDateFromUrl,
  isZipBuffer,
  normalizeCell,
  resolveImportSourceUrl,
  sha256ImportPayload,
  splitDelimitedLine,
  unzipWithLimits,
  withImportLog,
} from './shared';
import { readWorkbookRows } from './excel';
import { Prisma } from '@prisma/client';
import { normalizePackageCodeIdentity } from '@/lib/pharmacy/package-code';

export const MEDIS_MASTER_INDEX_PAGE_URL =
  'https://www.medis.or.jp/4_hyojyun/medis-master/riyou/index.html';
const HOT_ZIP_EXPANSION_LIMITS: ZipExpansionLimits = {
  maxEntries: 20,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};

type ParsedHotRecord = {
  hot_code: string;
  yj_code: string | null;
  package_code: string | null;
  drug_name: string | null;
  manufacturer: string | null;
  package_quantity: string | null;
  package_quantity_unit: string | null;
};

type ImportHotMasterOptions = {
  fileUrl?: string;
  fetchImpl?: FetchLike;
  zipLimits?: Partial<ZipExpansionLimits>;
};
type PreviewHotMasterOptions = ImportHotMasterOptions & {
  previewLimit?: number;
};
type HotMasterImportDbClient = DrugMasterImportLogDbClient & {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'upsert'>;
  drugPackage: Pick<Prisma.TransactionClient['drugPackage'], 'findMany' | 'upsert'>;
};
type HotMasterPreviewDbClient = {
  drugPackage: Pick<Prisma.TransactionClient['drugPackage'], 'findMany'>;
};

type HotMasterPreviewPackageAction =
  | 'upsert'
  | 'skip_invalid_code'
  | 'conflict_existing_gtin'
  | 'none';
type HotMasterPreviewDrugMasterAction = 'upsert' | 'skip_missing_yj' | 'skip_invalid_yj';

export type HotMasterPreviewRow = {
  hot_code: string;
  yj_code: string | null;
  drug_name: string | null;
  drug_master_action: HotMasterPreviewDrugMasterAction;
  package_action: HotMasterPreviewPackageAction;
  gtin: string | null;
  jan_code: string | null;
  package_quantity: string | null;
  package_quantity_unit: string | null;
  manufacturer: string | null;
};

export type HotMasterImportPreview = {
  dryRun: true;
  fileUrl: string;
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      drug_master_upsert_count: number;
      package_upsert_count: number;
      skipped_missing_yj: number;
      skipped_invalid_yj: number;
      skipped_invalid_package_code: number;
      skipped_package_conflict_count: number;
      sampled_rows: number;
    };
    rows: HotMasterPreviewRow[];
  };
};

const DEFAULT_PREVIEW_ROW_LIMIT = 20;
const MAX_PREVIEW_ROW_LIMIT = 100;

function resolveConfiguredHotUrl(fileUrl?: string) {
  const configured = fileUrl ?? process.env.HOT_MASTER_URL;
  if (!configured) {
    throw new Error(
      'HOTコードマスタ URL が未設定です。HOT_MASTER_URL か fileUrl を指定してください',
    );
  }

  return resolveImportSourceUrl(configured, MEDIS_MASTER_INDEX_PAGE_URL, HOT_IMPORT_URL_POLICY);
}

function normalizeHeader(value: string | null) {
  return value?.replace(/\s+/g, '').toLowerCase() ?? '';
}

function detectHeaderIndex(
  headerMap: Map<string, number>,
  patterns: RegExp[],
  options: {
    excludePatterns?: RegExp[];
    excludeIndexes?: Set<number>;
  } = {},
) {
  for (const [header, index] of headerMap.entries()) {
    if (options.excludeIndexes?.has(index)) continue;
    if (options.excludePatterns?.some((pattern) => pattern.test(header))) continue;
    if (patterns.some((pattern) => pattern.test(header))) {
      return index;
    }
  }
  return null;
}

function parseTextRows(buffer: Buffer) {
  const text = decodeTextBuffer(buffer);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = lines[0]?.includes('\t') ? '\t' : ',';
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

function parseHotRows(rows: Array<Array<string | null>>) {
  const headerRow = rows.find((row) =>
    row.some((cell) =>
      /hot|薬価基準収載|販売名|医薬品名/i.test(normalizeHeader(normalizeCell(cell))),
    ),
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
  const yjCodeIndex = detectHeaderIndex(headerMap, [
    /yj/,
    /薬価基準収載医薬品コード/,
    /個別医薬品コード/,
  ]);
  const packageCodeIndex = detectHeaderIndex(headerMap, [
    /jan/,
    /gtin/,
    /gs1/,
    /販売包装単位.*コード/,
    /調剤包装単位.*コード/,
    /元梱包装単位.*コード/,
  ]);
  const drugNameIndex = detectHeaderIndex(headerMap, [/販売名/, /品名/, /医薬品名/]);
  const manufacturerIndex = detectHeaderIndex(headerMap, [
    /メーカー/,
    /製造販売業者/,
    /販売会社/,
    /製造元/,
  ]);
  const packageQuantityIndex = detectHeaderIndex(headerMap, [/包装.*数量/, /入数/, /包装量/]);
  const packageUnitIndex = detectHeaderIndex(
    headerMap,
    [/^包装単位$/, /^包装単位名$/, /^包装単位名称$/, /^単位$/, /^単位名$/, /^包装.*単位$/],
    {
      excludeIndexes: new Set([packageCodeIndex].filter((index): index is number => index != null)),
      excludePatterns: [/コード/, /jan/, /gtin/, /gs1/],
    },
  );

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
      package_code: packageCodeIndex != null ? normalizeCell(row[packageCodeIndex]) : null,
      drug_name: drugNameIndex != null ? normalizeCell(row[drugNameIndex]) : null,
      manufacturer: manufacturerIndex != null ? normalizeCell(row[manufacturerIndex]) : null,
      package_quantity:
        packageQuantityIndex != null ? normalizeCell(row[packageQuantityIndex]) : null,
      package_quantity_unit: packageUnitIndex != null ? normalizeCell(row[packageUnitIndex]) : null,
    });
  }

  return records;
}

function resolveHotZipLimits(overrides?: Partial<ZipExpansionLimits>) {
  return {
    ...HOT_ZIP_EXPANSION_LIMITS,
    ...overrides,
  };
}

function unzipHotMasterArchive(buffer: Uint8Array, overrides?: Partial<ZipExpansionLimits>) {
  return unzipWithLimits(buffer, {
    sourceLabel: 'HOTコードマスタ',
    limits: resolveHotZipLimits(overrides),
    filter: (entryName) => /\.(csv|txt|tsv)$/i.test(entryName),
  });
}

export async function parseHotMasterFile(options: ImportHotMasterOptions = {}) {
  const fileUrl = resolveConfiguredHotUrl(options.fileUrl);
  const buffer = await fetchBytes(fileUrl, {
    fetchImpl: options.fetchImpl ?? fetch,
    policy: HOT_IMPORT_URL_POLICY,
  });

  let rows: Array<Array<string | null>>;
  if (/\.(csv|txt|tsv)$/i.test(fileUrl)) {
    rows = parseTextRows(buffer);
  } else {
    try {
      rows = await readWorkbookRows(buffer);
    } catch (error) {
      if (String(fileUrl).toLowerCase().endsWith('.xlsx')) {
        throw error;
      }
      if (isZipBuffer(buffer)) {
        const entries = unzipHotMasterArchive(new Uint8Array(buffer), options.zipLimits);
        const entry = Object.entries(entries).find(([name]) => /\.(csv|txt|tsv)$/i.test(name));
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
    sourceFileHash: sha256ImportPayload(buffer),
    records: parseHotRows(rows),
  };
}

function parsePackageQuantity(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  return new Prisma.Decimal(normalized);
}

function normalizeHotYjCode(value: string | null) {
  const normalized = normalizeCell(value)?.toUpperCase() ?? null;
  if (!normalized) return { status: 'missing' as const, yjCode: null };
  if (!/^[0-9A-Z]{12}$/.test(normalized)) {
    return { status: 'invalid' as const, yjCode: normalized };
  }
  return { status: 'valid' as const, yjCode: normalized };
}

function normalizePreviewLimit(value: number | undefined) {
  if (value == null) return DEFAULT_PREVIEW_ROW_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_ROW_LIMIT;
  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) return DEFAULT_PREVIEW_ROW_LIMIT;
  return Math.min(normalized, MAX_PREVIEW_ROW_LIMIT);
}

function collectValidHotPackageGtins(records: ParsedHotRecord[]) {
  return [
    ...new Set(
      records
        .flatMap((record) => {
          if (normalizeHotYjCode(record.yj_code).status !== 'valid') return [];
          if (!record.package_code) return [];
          const packageCode = normalizePackageCodeIdentity(record.package_code);
          return packageCode.valid && packageCode.gtin ? [packageCode.gtin] : [];
        })
        .filter((gtin): gtin is string => Boolean(gtin)),
    ),
  ];
}

async function fetchExistingHotPackagesByGtin(db: HotMasterPreviewDbClient, gtins: string[]) {
  if (gtins.length === 0) {
    return new Map<
      string,
      {
        gtin: string;
        drug_master_id: string;
        source: string | null;
        source_record_id: string | null;
        is_active: boolean;
        drug_master: { yj_code: string };
      }
    >();
  }

  const rows = await db.drugPackage.findMany({
    where: { gtin: { in: gtins } },
    select: {
      gtin: true,
      drug_master_id: true,
      source: true,
      source_record_id: true,
      is_active: true,
      drug_master: {
        select: { yj_code: true },
      },
    },
  });
  return new Map(rows.map((row) => [row.gtin, row]));
}

function hasExistingPackageConflict(args: {
  existingPackage:
    | {
        drug_master_id: string;
        drug_master: { yj_code: string };
      }
    | undefined;
  incomingDrugMasterId?: string;
  incomingYjCode: string;
  plannedYjCode?: string;
}) {
  if (args.existingPackage && args.existingPackage.drug_master.yj_code !== args.incomingYjCode) {
    return true;
  }
  if (
    args.incomingDrugMasterId &&
    args.existingPackage &&
    args.existingPackage.drug_master_id !== args.incomingDrugMasterId
  ) {
    return true;
  }
  return Boolean(args.plannedYjCode && args.plannedYjCode !== args.incomingYjCode);
}

export async function previewHotMaster(
  db: HotMasterPreviewDbClient,
  options: PreviewHotMasterOptions = {},
): Promise<HotMasterImportPreview> {
  const parsed = await parseHotMasterFile(options);
  const previewLimit = normalizePreviewLimit(options.previewLimit);
  const existingPackageByGtin = await fetchExistingHotPackagesByGtin(
    db,
    collectValidHotPackageGtins(parsed.records),
  );
  let drugMasterUpsertCount = 0;
  let packageUpsertCount = 0;
  let skippedMissingYj = 0;
  let skippedInvalidYj = 0;
  let skippedInvalidPackageCode = 0;
  let skippedPackageConflictCount = 0;
  const plannedYjByGtin = new Map<string, string>();
  const rows: HotMasterPreviewRow[] = [];

  for (const record of parsed.records) {
    let drugMasterAction: HotMasterPreviewDrugMasterAction = 'skip_missing_yj';
    let packageAction: HotMasterPreviewPackageAction = 'none';
    let gtin: string | null = null;
    let janCode: string | null = null;
    const yjCodeResult = normalizeHotYjCode(record.yj_code);

    if (yjCodeResult.status === 'missing') {
      skippedMissingYj += 1;
    } else if (yjCodeResult.status === 'invalid') {
      drugMasterAction = 'skip_invalid_yj';
      skippedInvalidYj += 1;
    } else {
      drugMasterAction = 'upsert';
      drugMasterUpsertCount += 1;

      if (record.package_code) {
        const packageCode = normalizePackageCodeIdentity(record.package_code);
        if (packageCode.valid && packageCode.gtin) {
          packageAction = 'upsert';
          gtin = packageCode.gtin;
          janCode = packageCode.janCode;
          if (
            hasExistingPackageConflict({
              existingPackage: existingPackageByGtin.get(packageCode.gtin),
              incomingYjCode: yjCodeResult.yjCode,
              plannedYjCode: plannedYjByGtin.get(packageCode.gtin),
            })
          ) {
            packageAction = 'conflict_existing_gtin';
            skippedPackageConflictCount += 1;
          } else {
            packageUpsertCount += 1;
            plannedYjByGtin.set(packageCode.gtin, yjCodeResult.yjCode);
          }
        } else {
          packageAction = 'skip_invalid_code';
          skippedInvalidPackageCode += 1;
        }
      }
    }

    if (rows.length < previewLimit) {
      rows.push({
        hot_code: record.hot_code,
        yj_code: yjCodeResult.yjCode,
        drug_name: record.drug_name,
        drug_master_action: drugMasterAction,
        package_action: packageAction,
        gtin,
        jan_code: janCode,
        package_quantity: record.package_quantity,
        package_quantity_unit: record.package_quantity_unit,
        manufacturer: record.manufacturer,
      });
    }
  }

  return {
    dryRun: true,
    fileUrl: parsed.fileUrl,
    sourceFileHash: parsed.sourceFileHash,
    sourcePublishedAt:
      extractImportSourceDateFromUrl(parsed.fileUrl, [
        /(?:^|[^\d])(\d{8})(?:[^\d]|$)/,
      ])?.toISOString() ?? null,
    preview: {
      summary: {
        parsed_records: parsed.records.length,
        drug_master_upsert_count: drugMasterUpsertCount,
        package_upsert_count: packageUpsertCount,
        skipped_missing_yj: skippedMissingYj,
        skipped_invalid_yj: skippedInvalidYj,
        skipped_invalid_package_code: skippedInvalidPackageCode,
        skipped_package_conflict_count: skippedPackageConflictCount,
        sampled_rows: rows.length,
      },
      rows,
    },
  };
}

export async function importHotMaster(
  db: HotMasterImportDbClient,
  options: ImportHotMasterOptions = {},
) {
  return withImportLog(db, 'hot', async () => {
    const parsed = await parseHotMasterFile(options);
    const existingPackageByGtin = await fetchExistingHotPackagesByGtin(
      db,
      collectValidHotPackageGtins(parsed.records),
    );
    let updatedCount = 0;
    let packageUpsertCount = 0;
    let skippedMissingYj = 0;
    let skippedInvalidYj = 0;
    let skippedInvalidPackageCode = 0;
    let skippedPackageConflictCount = 0;
    const plannedYjByGtin = new Map<string, string>();

    for (const record of parsed.records) {
      const yjCodeResult = normalizeHotYjCode(record.yj_code);
      if (yjCodeResult.status === 'missing') {
        skippedMissingYj += 1;
        continue;
      }
      if (yjCodeResult.status === 'invalid') {
        skippedInvalidYj += 1;
        continue;
      }

      if (yjCodeResult.status === 'valid') {
        const drugMaster = await db.drugMaster.upsert({
          where: { yj_code: yjCodeResult.yjCode },
          create: {
            yj_code: yjCodeResult.yjCode,
            drug_name: record.drug_name ?? yjCodeResult.yjCode,
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

        if (record.package_code) {
          const packageCode = normalizePackageCodeIdentity(record.package_code);
          if (packageCode.valid && packageCode.gtin) {
            if (
              hasExistingPackageConflict({
                existingPackage: existingPackageByGtin.get(packageCode.gtin),
                incomingDrugMasterId: drugMaster.id,
                incomingYjCode: yjCodeResult.yjCode,
                plannedYjCode: plannedYjByGtin.get(packageCode.gtin),
              })
            ) {
              skippedPackageConflictCount += 1;
              continue;
            }

            await db.drugPackage.upsert({
              where: { gtin: packageCode.gtin },
              create: {
                drug_master_id: drugMaster.id,
                gtin: packageCode.gtin,
                jan_code: packageCode.janCode,
                package_level: 'sales',
                package_quantity: parsePackageQuantity(record.package_quantity),
                package_quantity_unit: record.package_quantity_unit,
                manufacturer: record.manufacturer,
                source: 'hot',
                source_file_hash: parsed.sourceFileHash,
                source_record_id: record.hot_code,
                is_active: true,
              },
              update: {
                drug_master_id: drugMaster.id,
                jan_code: packageCode.janCode,
                package_level: 'sales',
                package_quantity: parsePackageQuantity(record.package_quantity),
                package_quantity_unit: record.package_quantity_unit,
                manufacturer: record.manufacturer,
                source: 'hot',
                source_file_hash: parsed.sourceFileHash,
                source_record_id: record.hot_code,
                is_active: true,
              },
            });
            packageUpsertCount += 1;
            plannedYjByGtin.set(packageCode.gtin, yjCodeResult.yjCode);
          } else {
            skippedInvalidPackageCode += 1;
          }
        }
        continue;
      }
    }

    return {
      recordCount: updatedCount,
      sourceUrl: parsed.fileUrl,
      sourceFileHash: parsed.sourceFileHash,
      sourcePublishedAt: extractImportSourceDateFromUrl(parsed.fileUrl, [
        /(?:^|[^\d])(\d{8})(?:[^\d]|$)/,
      ]),
      importMode: 'full',
      changeSummary: {
        mode: 'full',
        parsed_records: parsed.records.length,
        imported_records: updatedCount,
        package_records: packageUpsertCount,
        skipped_missing_yj: skippedMissingYj,
        skipped_invalid_yj: skippedInvalidYj,
        skipped_invalid_package_code: skippedInvalidPackageCode,
        skipped_package_conflict_count: skippedPackageConflictCount,
      },
      payload: {
        fileUrl: parsed.fileUrl,
        packageImportedCount: packageUpsertCount,
      },
    };
  });
}
