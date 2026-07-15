import { Prisma, PrismaClient } from '@prisma/client';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { parseSourceDate, type SourceDateInvalidReason } from '@/lib/validations/date-key';
import {
  FetchLike,
  SSK_IMPORT_URL_POLICY,
  ZipExpansionLimits,
  assertDateQuarantineAllowsImport,
  createDateQuarantineSummary,
  dateQuarantineSummaryFields,
  type DateQuarantineSummary,
  extractStrictImportSourceDateFromUrl,
  fetchBytes,
  fetchText,
  recordDateQuarantine,
  resolveDateQuarantineImportMode,
  normalizeCell,
  normalizePreviewRowLimit,
  normalizeImportSourceUrl,
  resolveImportSourceUrl,
  sha256ImportPayload,
  splitDelimitedLine,
  unzipWithLimits,
} from './shared';

export const SSK_DRUG_MASTER_PAGE_URL =
  'https://www.ssk.or.jp/smph/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.html';

const SSK_TOTAL_COLUMNS = 42;
const UPSERT_CHUNK_SIZE = 200;
const PREVIEW_READ_CHUNK_SIZE = 500;
const SSK_ZIP_EXPANSION_LIMITS: ZipExpansionLimits = {
  maxEntries: 20,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};
const SSK_IMPORT_FAILURE_MESSAGE = 'SSK取込に失敗しました';

const SSK_DOSAGE_FORM_MAP: Record<string, string> = {
  '1': '内用薬',
  '3': 'その他',
  '4': '注射薬',
  '6': '外用薬',
  '8': '歯科用薬剤',
};
const NEW_DRUG_MAX_ADMINISTRATION_DAYS = 14;
const ONE_YEAR_IN_DAYS = 365;

type ImportDbClient = Pick<PrismaClient, 'drugMaster' | 'drugMasterImportLog'>;
type PreviewDbClient = Pick<PrismaClient, 'drugMaster'>;

export type ParsedSskDrugMasterRecord = {
  receipt_code: string | null;
  yj_code: string;
  drug_name: string;
  drug_name_kana: string | null;
  generic_name: string | null;
  drug_price: Prisma.Decimal | null;
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  is_biologic: boolean;
  max_administration_days: number | null;
  transitional_expiry_date: Date | null;
  raw_row: string[];
};

export type ParsedSskDrugMasterFile = {
  entryName: string;
  zipUrl: string;
  sourceFileHash: string;
  records: ParsedSskDrugMasterRecord[];
  candidateRecordCount: number;
  dateQuarantine: DateQuarantineSummary;
};

export type SskDrugMasterZipPayload = {
  zipUrl: string;
  sourceFileHash: string;
  entries: Record<string, Uint8Array>;
};

export type ImportSskDrugMasterOptions = {
  zipUrl?: string;
  zipPayload?: SskDrugMasterZipPayload;
  limit?: number;
  fetchImpl?: FetchLike;
  zipLimits?: Partial<ZipExpansionLimits>;
};

export type PreviewSskDrugMasterImportOptions = Pick<
  ImportSskDrugMasterOptions,
  'zipUrl' | 'zipPayload' | 'limit' | 'fetchImpl' | 'zipLimits'
> & {
  previewLimit?: number;
};

export type SskDrugMasterImportPreviewRow = {
  yj_code: string;
  drug_name: string;
  action: 'create' | 'update';
  changed_fields: string[];
};

export type SskDrugMasterImportPreview = {
  dryRun: true;
  entryName: string;
  zipUrl: string;
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      create_count: number;
      update_count: number;
      unchanged_count: number;
      sampled_rows: number;
      quarantined_date_records?: number;
      quarantine_invalid_format_count?: number;
      quarantine_invalid_calendar_date_count?: number;
      quarantine_invalid_era_boundary_count?: number;
    };
    rows: SskDrugMasterImportPreviewRow[];
  };
};

const SSK_PREVIEW_COMPARE_FIELDS = [
  'receipt_code',
  'drug_name',
  'drug_name_kana',
  'generic_name',
  'drug_price',
  'unit',
  'dosage_form',
  'therapeutic_category',
  'manufacturer',
  'is_generic',
  'is_narcotic',
  'is_psychotropic',
  'max_administration_days',
  'transitional_expiry_date',
] as const;

function parseSskDecimal(value: string | null) {
  if (!value || value === '0') return null;
  return new Prisma.Decimal(value);
}

function parseGenericName(value: string | null) {
  if (!value) return null;
  return value.replace(/^【般】/, '').trim() || null;
}

function parseDosageForm(code: string | null) {
  if (!code) return null;
  return SSK_DOSAGE_FORM_MAP[code] ?? null;
}

function differenceInDays(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function parseMaxAdministrationDays(listedAt: Date | null, now = new Date()) {
  if (!listedAt) return null;

  const currentBusinessDate = utcDateFromLocalKey(japanDateKey(now));
  const daysSinceListing = differenceInDays(listedAt, currentBusinessDate);
  if (daysSinceListing < 0 || daysSinceListing > ONE_YEAR_IN_DAYS) {
    return null;
  }

  // New drugs are generally limited to 14 days for the first year after listing.
  return NEW_DRUG_MAX_ADMINISTRATION_DAYS;
}

function parseControlledDrugFlags(code: string | null) {
  return {
    is_narcotic: code === '1',
    is_psychotropic: code === '5',
  };
}

type SskRowParseResult =
  | { status: 'skipped' }
  | { status: 'quarantined'; reason: SourceDateInvalidReason }
  | { status: 'record'; record: ParsedSskDrugMasterRecord };

function mapSskRowToDrugMaster(row: string[]): SskRowParseResult {
  if (row.length < SSK_TOTAL_COLUMNS) return { status: 'skipped' };

  const yjCode = normalizeCell(row[31]);
  const productName = normalizeCell(row[34]) ?? normalizeCell(row[4]);
  if (!yjCode || !productName) return { status: 'skipped' };
  const listedAt = parseSourceDate(normalizeCell(row[35]), 'ssk');
  const transitionalExpiry = parseSourceDate(normalizeCell(row[33]), 'ssk');
  const invalidDate =
    listedAt.status === 'invalid'
      ? listedAt
      : transitionalExpiry.status === 'invalid'
        ? transitionalExpiry
        : null;
  if (invalidDate) return { status: 'quarantined', reason: invalidDate.reason };

  const controlledFlags = parseControlledDrugFlags(normalizeCell(row[13]));

  return {
    status: 'record',
    record: {
      receipt_code: normalizeCell(row[2]),
      yj_code: yjCode,
      drug_name: productName,
      drug_name_kana: normalizeCell(row[6]),
      generic_name: parseGenericName(normalizeCell(row[37])),
      drug_price: parseSskDecimal(normalizeCell(row[11])),
      unit: normalizeCell(row[9]),
      dosage_form: parseDosageForm(normalizeCell(row[27])),
      therapeutic_category: yjCode.slice(0, 4) || null,
      manufacturer: null,
      is_generic: normalizeCell(row[16]) === '1',
      is_narcotic: controlledFlags.is_narcotic,
      is_psychotropic: controlledFlags.is_psychotropic,
      is_biologic: normalizeCell(row[15]) === '1',
      max_administration_days: parseMaxAdministrationDays(
        listedAt.status === 'valid' ? listedAt.date : null,
      ),
      transitional_expiry_date:
        transitionalExpiry.status === 'valid' ? transitionalExpiry.date : null,
      raw_row: row,
    },
  };
}

function shouldReplaceRecord(
  current: ParsedSskDrugMasterRecord,
  candidate: ParsedSskDrugMasterRecord,
) {
  const currentSelection = current.drug_name.includes('（選）');
  const candidateSelection = candidate.drug_name.includes('（選）');

  if (currentSelection !== candidateSelection) {
    return currentSelection && !candidateSelection;
  }

  if (!current.generic_name && candidate.generic_name) {
    return true;
  }

  return false;
}

export function resolveLatestSskDrugMasterZipUrl(html: string, pageUrl = SSK_DRUG_MASTER_PAGE_URL) {
  const match = html.match(/<a\s+href="([^"]+\.zip)"[^>]*>\s*全件ファイル\(ZIP:[^<]+<\/a>/i);

  if (!match) {
    throw new Error('SSK医薬品全件マスターのZIPリンクを解決できませんでした');
  }

  return resolveImportSourceUrl(match[1], pageUrl, SSK_IMPORT_URL_POLICY);
}

function resolveSskZipLimits(overrides?: Partial<ZipExpansionLimits>) {
  return {
    ...SSK_ZIP_EXPANSION_LIMITS,
    ...overrides,
  };
}

function unzipSskDrugMasterArchive(buffer: Uint8Array, overrides?: Partial<ZipExpansionLimits>) {
  return unzipWithLimits(buffer, {
    sourceLabel: 'SSK医薬品マスター',
    limits: resolveSskZipLimits(overrides),
    filter: (entryName) => entryName.toLowerCase().endsWith('.csv'),
  });
}

async function fetchSskDrugMasterZipPayload(
  zipUrl: string,
  fetchImpl: FetchLike,
  zipLimits?: Partial<ZipExpansionLimits>,
): Promise<SskDrugMasterZipPayload> {
  const zipBytes = new Uint8Array(
    await fetchBytes(zipUrl, {
      fetchImpl,
      policy: SSK_IMPORT_URL_POLICY,
    }),
  );

  return {
    zipUrl,
    sourceFileHash: sha256ImportPayload(zipBytes),
    entries: unzipSskDrugMasterArchive(zipBytes, zipLimits),
  };
}

export async function fetchLatestSskDrugMasterZip(
  fetchImpl: FetchLike = fetch,
  pageUrl = SSK_DRUG_MASTER_PAGE_URL,
  zipLimits?: Partial<ZipExpansionLimits>,
) {
  const html = await fetchText(pageUrl, {
    fetchImpl,
    policy: SSK_IMPORT_URL_POLICY,
  });
  const zipUrl = resolveLatestSskDrugMasterZipUrl(html, pageUrl);

  return fetchSskDrugMasterZipPayload(zipUrl, fetchImpl, zipLimits);
}

export function buildSskDrugMasterDedupeKey(sourceFileHash: string) {
  return `ssk:${sourceFileHash}`;
}

export async function parseSskDrugMasterZip(
  options: Pick<
    ImportSskDrugMasterOptions,
    'zipUrl' | 'zipPayload' | 'limit' | 'fetchImpl' | 'zipLimits'
  > = {},
): Promise<ParsedSskDrugMasterFile> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const explicitZipUrl = options.zipUrl
    ? normalizeImportSourceUrl(options.zipUrl, SSK_IMPORT_URL_POLICY)
    : null;

  const zipPayload = options.zipPayload
    ? options.zipPayload
    : explicitZipUrl
      ? await fetchSskDrugMasterZipPayload(explicitZipUrl, fetchImpl, options.zipLimits)
      : await fetchLatestSskDrugMasterZip(fetchImpl, SSK_DRUG_MASTER_PAGE_URL, options.zipLimits);

  const entry = Object.entries(zipPayload.entries).find(([name]) =>
    name.toLowerCase().endsWith('.csv'),
  );

  if (!entry) {
    throw new Error('SSK ZIP内にCSVファイルが見つかりませんでした');
  }

  const [entryName, entryBytes] = entry;
  const csvText = new TextDecoder('shift_jis').decode(entryBytes);
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const deduped = new Map<string, ParsedSskDrugMasterRecord>();
  const dateQuarantine = createDateQuarantineSummary();
  let candidateRecordCount = 0;

  for (const line of lines) {
    const parsedRow = mapSskRowToDrugMaster(splitDelimitedLine(line));
    if (parsedRow.status === 'skipped') continue;
    candidateRecordCount += 1;
    if (parsedRow.status === 'quarantined') {
      recordDateQuarantine(dateQuarantine, parsedRow.reason);
      continue;
    }
    const { record } = parsedRow;

    const current = deduped.get(record.yj_code);
    if (!current || shouldReplaceRecord(current, record)) {
      deduped.set(record.yj_code, record);
    }

    if (options.limit && deduped.size >= options.limit) {
      break;
    }
  }

  return {
    entryName,
    zipUrl: zipPayload.zipUrl,
    sourceFileHash: zipPayload.sourceFileHash,
    records: [...deduped.values()],
    candidateRecordCount,
    dateQuarantine,
  };
}

async function upsertDrugMasterChunk(db: ImportDbClient, records: ParsedSskDrugMasterRecord[]) {
  await Promise.all(
    records.map((record) =>
      db.drugMaster.upsert({
        where: { yj_code: record.yj_code },
        create: {
          yj_code: record.yj_code,
          receipt_code: record.receipt_code,
          drug_name: record.drug_name,
          drug_name_kana: record.drug_name_kana,
          generic_name: record.generic_name,
          drug_price: record.drug_price,
          unit: record.unit,
          dosage_form: record.dosage_form,
          therapeutic_category: record.therapeutic_category,
          manufacturer: record.manufacturer,
          is_generic: record.is_generic,
          is_narcotic: record.is_narcotic,
          is_psychotropic: record.is_psychotropic,
          max_administration_days: record.max_administration_days,
          transitional_expiry_date: record.transitional_expiry_date,
        },
        update: {
          receipt_code: record.receipt_code,
          drug_name: record.drug_name,
          drug_name_kana: record.drug_name_kana,
          generic_name: record.generic_name,
          drug_price: record.drug_price,
          unit: record.unit,
          dosage_form: record.dosage_form,
          therapeutic_category: record.therapeutic_category,
          manufacturer: record.manufacturer,
          is_generic: record.is_generic,
          is_narcotic: record.is_narcotic,
          is_psychotropic: record.is_psychotropic,
          max_administration_days: record.max_administration_days,
          transitional_expiry_date: record.transitional_expiry_date,
        },
      }),
    ),
  );
}

function comparableValue(value: unknown) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  return value;
}

function changedSskDrugMasterFields(
  record: ParsedSskDrugMasterRecord,
  existing: Record<string, unknown>,
) {
  return SSK_PREVIEW_COMPARE_FIELDS.filter(
    (field) =>
      comparableValue(record[field as keyof ParsedSskDrugMasterRecord]) !==
      comparableValue(existing[field]),
  );
}

async function fetchExistingSskDrugMastersByYjCode(db: PreviewDbClient, yjCodes: string[]) {
  const existingByYjCode = new Map<string, Record<string, unknown>>();

  for (let index = 0; index < yjCodes.length; index += PREVIEW_READ_CHUNK_SIZE) {
    const batch = yjCodes.slice(index, index + PREVIEW_READ_CHUNK_SIZE);
    const rows = await db.drugMaster.findMany({
      where: { yj_code: { in: batch } },
      select: {
        yj_code: true,
        receipt_code: true,
        drug_name: true,
        drug_name_kana: true,
        generic_name: true,
        drug_price: true,
        unit: true,
        dosage_form: true,
        therapeutic_category: true,
        manufacturer: true,
        is_generic: true,
        is_narcotic: true,
        is_psychotropic: true,
        max_administration_days: true,
        transitional_expiry_date: true,
      },
    });

    for (const row of rows) {
      existingByYjCode.set(row.yj_code, row as Record<string, unknown>);
    }
  }

  return existingByYjCode;
}

export async function previewSskDrugMasterImport(
  db: PreviewDbClient,
  options: PreviewSskDrugMasterImportOptions = {},
): Promise<SskDrugMasterImportPreview> {
  const parsed = await parseSskDrugMasterZip(options);
  const sourcePublishedAt = extractStrictImportSourceDateFromUrl(parsed.zipUrl, [
    /y_ALL(\d{8})\.zip/i,
  ]);
  const previewLimit = normalizePreviewRowLimit(options.previewLimit);
  const existingByYjCode = await fetchExistingSskDrugMastersByYjCode(
    db,
    parsed.records.map((record) => record.yj_code),
  );

  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  const rows: SskDrugMasterImportPreviewRow[] = [];

  for (const record of parsed.records) {
    const existing = existingByYjCode.get(record.yj_code);
    if (!existing) {
      createCount += 1;
      if (rows.length < previewLimit) {
        rows.push({
          yj_code: record.yj_code,
          drug_name: record.drug_name,
          action: 'create',
          changed_fields: SSK_PREVIEW_COMPARE_FIELDS.slice(),
        });
      }
      continue;
    }

    const changedFields = changedSskDrugMasterFields(record, existing);
    if (changedFields.length === 0) {
      unchangedCount += 1;
      continue;
    }

    updateCount += 1;
    if (rows.length < previewLimit) {
      rows.push({
        yj_code: record.yj_code,
        drug_name: record.drug_name,
        action: 'update',
        changed_fields: changedFields,
      });
    }
  }

  return {
    dryRun: true,
    entryName: parsed.entryName,
    zipUrl: parsed.zipUrl,
    sourceFileHash: parsed.sourceFileHash,
    sourcePublishedAt: sourcePublishedAt?.toISOString() ?? null,
    preview: {
      summary: {
        parsed_records: parsed.records.length,
        create_count: createCount,
        update_count: updateCount,
        unchanged_count: unchangedCount,
        sampled_rows: rows.length,
        ...dateQuarantineSummaryFields(parsed.dateQuarantine),
      },
      rows,
    },
  };
}

export async function importSskDrugMaster(
  db: ImportDbClient,
  options: ImportSskDrugMasterOptions = {},
) {
  const log = await db.drugMasterImportLog.create({
    data: {
      source: 'ssk',
      status: 'running',
      record_count: 0,
    },
  });

  try {
    const parsed = await parseSskDrugMasterZip(options);
    const sourcePublishedAt = extractStrictImportSourceDateFromUrl(parsed.zipUrl, [
      /y_ALL(\d{8})\.zip/i,
    ]);
    assertDateQuarantineAllowsImport(parsed.records.length, parsed.dateQuarantine);
    const importMode = resolveDateQuarantineImportMode('full', parsed.dateQuarantine);

    for (let index = 0; index < parsed.records.length; index += UPSERT_CHUNK_SIZE) {
      await upsertDrugMasterChunk(db, parsed.records.slice(index, index + UPSERT_CHUNK_SIZE));
    }

    const completedLog = await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'completed',
        record_count: parsed.records.length,
        source_url: parsed.zipUrl,
        source_file_hash: parsed.sourceFileHash,
        source_published_at: sourcePublishedAt,
        import_mode: importMode,
        change_summary: {
          mode: importMode,
          parsed_records: parsed.records.length,
          imported_records: parsed.records.length,
          entry_name: parsed.entryName,
          ...dateQuarantineSummaryFields(parsed.dateQuarantine),
        },
      },
    });

    return {
      log: completedLog,
      entryName: parsed.entryName,
      zipUrl: parsed.zipUrl,
      importedCount: parsed.records.length,
    };
  } catch (error) {
    await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        error_log: SSK_IMPORT_FAILURE_MESSAGE,
      },
    });
    throw error;
  }
}
