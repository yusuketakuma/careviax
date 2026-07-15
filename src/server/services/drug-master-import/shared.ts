import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  parseSourceDate,
  type SourceDateInvalidReason,
  type SourceDateParseResult,
} from '@/lib/validations/date-key';
import { logger } from '@/lib/utils/logger';
import type { ImportSourceUrlPolicy } from '@/server/services/import-source/shared';
export {
  decodeTextBuffer,
  fetchBytes,
  fetchText,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
  isZipBuffer,
  normalizeCell,
  normalizeImportSourceUrl,
  parseDelimitedRows,
  readDelimitedCell,
  resolveAbsoluteUrl,
  resolveImportSourceUrl,
  splitDelimitedLine,
  stripBom,
  unzipWithLimits,
  validateImportSourceUrl,
  type FetchLike,
  type HostnameResolver,
  type ZipExpansionLimits,
} from '@/server/services/import-source/shared';

export type DrugMasterImportDbClient = Pick<
  PrismaClient,
  | 'drugMaster'
  | 'drugMasterImportLog'
  | 'genericDrugMapping'
  | 'drugPackageInsert'
  | 'drugInteraction'
  | 'drugAlertRule'
  | 'drugMasterChangeEvent'
>;
export type DrugMasterImportLogDbClient = {
  drugMasterImportLog: Pick<PrismaClient['drugMasterImportLog'], 'create' | 'update'>;
};

export type DrugMasterImportSource =
  | 'ssk'
  | 'pmda'
  | 'mhlw_price'
  | 'mhlw_generic'
  | 'hot'
  | 'manual_clinical';

export type ImportSourceFingerprint = {
  sourceUrl: string;
  sourceFileHash: string;
};
export type ImportProvenanceSummary = Prisma.InputJsonObject;

const BYTES_PER_MIB = 1024 * 1024;
export const DEFAULT_IMPORT_PREVIEW_ROW_LIMIT = 20;
export const MAX_IMPORT_PREVIEW_ROW_LIMIT = 100;
const DRUG_MASTER_IMPORT_FAILURE_MESSAGE = '医薬品マスタ取込に失敗しました';
export const INVALID_IMPORT_SOURCE_DATE_CODE = 'DRUG_MASTER_SOURCE_DATE_INVALID';
export const ALL_DATE_ROWS_QUARANTINED_CODE = 'DRUG_MASTER_DATE_ALL_ROWS_QUARANTINED';

export type DateQuarantineSummary = {
  quarantinedDateRecords: number;
  invalidFormatCount: number;
  invalidCalendarDateCount: number;
  invalidEraBoundaryCount: number;
};

export function createDateQuarantineSummary(): DateQuarantineSummary {
  return {
    quarantinedDateRecords: 0,
    invalidFormatCount: 0,
    invalidCalendarDateCount: 0,
    invalidEraBoundaryCount: 0,
  };
}

export function recordDateQuarantine(
  summary: DateQuarantineSummary,
  reason: SourceDateInvalidReason,
) {
  summary.quarantinedDateRecords += 1;
  if (reason === 'invalid_format') summary.invalidFormatCount += 1;
  if (reason === 'invalid_calendar_date') summary.invalidCalendarDateCount += 1;
  if (reason === 'invalid_era_boundary') summary.invalidEraBoundaryCount += 1;
}

export function mergeDateQuarantineSummary(
  target: DateQuarantineSummary,
  source: DateQuarantineSummary,
) {
  target.quarantinedDateRecords += source.quarantinedDateRecords;
  target.invalidFormatCount += source.invalidFormatCount;
  target.invalidCalendarDateCount += source.invalidCalendarDateCount;
  target.invalidEraBoundaryCount += source.invalidEraBoundaryCount;
  return target;
}

export function dateQuarantineSummaryFields(summary: DateQuarantineSummary) {
  if (summary.quarantinedDateRecords === 0) return {};
  return {
    quarantined_date_records: summary.quarantinedDateRecords,
    quarantine_invalid_format_count: summary.invalidFormatCount,
    quarantine_invalid_calendar_date_count: summary.invalidCalendarDateCount,
    quarantine_invalid_era_boundary_count: summary.invalidEraBoundaryCount,
  };
}

export function assertDateQuarantineAllowsImport(
  validRecordCount: number,
  summary: DateQuarantineSummary,
) {
  if (validRecordCount === 0 && summary.quarantinedDateRecords > 0) {
    throw new RangeError(ALL_DATE_ROWS_QUARANTINED_CODE);
  }
}

export function resolveDateQuarantineImportMode(baseMode: string, summary: DateQuarantineSummary) {
  return summary.quarantinedDateRecords > 0 ? 'partial' : baseMode;
}

export type DrugMasterImportUrlPolicy = ImportSourceUrlPolicy<DrugMasterImportSource>;

export const MHLW_IMPORT_URL_POLICY: DrugMasterImportUrlPolicy = {
  source: 'mhlw_price',
  allowedHosts: ['www.mhlw.go.jp'],
  maxBytes: 64 * BYTES_PER_MIB,
};

export const SSK_IMPORT_URL_POLICY: DrugMasterImportUrlPolicy = {
  source: 'ssk',
  allowedHosts: ['www.ssk.or.jp'],
  maxBytes: 64 * BYTES_PER_MIB,
};

export const HOT_IMPORT_URL_POLICY: DrugMasterImportUrlPolicy = {
  source: 'hot',
  allowedHosts: ['www.medis.or.jp'],
  maxBytes: 128 * BYTES_PER_MIB,
};

export const PMDA_IMPORT_URL_POLICY: DrugMasterImportUrlPolicy = {
  source: 'pmda',
  allowedHosts: ['www.pmda.go.jp', 'pmda.go.jp'],
  maxBytes: 512 * BYTES_PER_MIB,
};

function normalizeImportSourceForLog(source: DrugMasterImportSource) {
  return source.replaceAll('_', '-');
}

export function sha256ImportPayload(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function combineImportSourceFingerprints(fingerprints: readonly ImportSourceFingerprint[]) {
  if (fingerprints.length === 0) return null;
  if (fingerprints.length === 1) return fingerprints[0]?.sourceFileHash ?? null;

  const hash = createHash('sha256');
  for (const fingerprint of fingerprints) {
    hash.update(fingerprint.sourceUrl);
    hash.update('\0');
    hash.update(fingerprint.sourceFileHash);
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function parseImportSourceDateToken(value: string) {
  const parsed = parseSourceDate(value, 'import_source_token');
  return parsed.status === 'valid' ? parsed.date : null;
}

function parseImportSourceDateFromUrl(
  url: string,
  patterns: readonly RegExp[],
): SourceDateParseResult {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { status: 'invalid', reason: 'invalid_format' };
  }

  for (const pattern of patterns) {
    // Provenance dates belong to official file paths. Query and fragment text
    // must never inject or poison the date recorded for an import.
    const match = pathname.match(pattern);
    const token = match?.[1];
    if (!token) continue;
    return parseSourceDate(token, 'import_source_token');
  }
  return { status: 'missing' };
}

export function extractImportSourceDateFromUrl(url: string, patterns: readonly RegExp[]) {
  const parsed = parseImportSourceDateFromUrl(url, patterns);
  return parsed.status === 'valid' ? parsed.date : null;
}

export function extractStrictImportSourceDateFromUrl(url: string, patterns: readonly RegExp[]) {
  const parsed = parseImportSourceDateFromUrl(url, patterns);
  if (parsed.status === 'invalid') throw new RangeError(INVALID_IMPORT_SOURCE_DATE_CODE);
  if (parsed.status === 'valid') return parsed.date;
  return null;
}

export function parseJapaneseEraApplicableDateText(value: string | null | undefined) {
  const parsed = parseSourceDate(value, 'japanese_era_text');
  return parsed.status === 'valid' ? parsed.date : null;
}

export function extractStrictJapaneseEraApplicableDateText(value: string | null | undefined) {
  const parsed = parseSourceDate(value, 'japanese_era_text');
  if (parsed.status === 'invalid') throw new RangeError(INVALID_IMPORT_SOURCE_DATE_CODE);
  if (parsed.status === 'valid') return parsed.date;
  return null;
}

export function normalizePreviewRowLimit(
  value: number | undefined,
  options: {
    defaultLimit?: number;
    maxLimit?: number;
  } = {},
) {
  const defaultLimit = options.defaultLimit ?? DEFAULT_IMPORT_PREVIEW_ROW_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_IMPORT_PREVIEW_ROW_LIMIT;
  if (value == null) return defaultLimit;
  if (!Number.isFinite(value)) return defaultLimit;
  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) return defaultLimit;
  return Math.min(normalized, maxLimit);
}

export function normalizeDigits(value: string) {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，]/g, ',');
}

export function parseDecimal(value: string | null) {
  if (!value) return null;
  const normalized = normalizeDigits(value).replace(/,/g, '').trim();
  if (!normalized) return null;

  try {
    return new Prisma.Decimal(normalized);
  } catch {
    return null;
  }
}

export function parseDate(value: string | null) {
  const parsed = parseDrugMasterDate(value);
  return parsed.status === 'valid' ? parsed.date : null;
}

export function parseDrugMasterDate(value: string | null | undefined) {
  return parseSourceDate(value, 'mhlw_pmda');
}

type LoggedImportResult<T> = {
  recordCount: number;
  payload: T;
  sourceUrl?: string | null;
  sourceFileHash?: string | null;
  sourcePublishedAt?: Date | null;
  importMode?: string | null;
  changeSummary?: Prisma.InputJsonValue | null;
};

export async function withImportLog<T>(
  db: DrugMasterImportLogDbClient,
  source: DrugMasterImportSource,
  fn: (log: { id: string }) => Promise<LoggedImportResult<T>>,
) {
  const log = await db.drugMasterImportLog.create({
    data: {
      source,
      status: 'running',
      record_count: 0,
    },
  });

  try {
    const result = await fn(log);
    const completedLog = await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'completed',
        record_count: result.recordCount,
        source_url: result.sourceUrl ?? null,
        source_file_hash: result.sourceFileHash ?? null,
        source_published_at: result.sourcePublishedAt ?? null,
        import_mode: result.importMode ?? null,
        change_summary: result.changeSummary ?? Prisma.JsonNull,
      },
    });

    return {
      ...result.payload,
      log: completedLog,
      importedCount: result.recordCount,
    };
  } catch (error) {
    try {
      await db.drugMasterImportLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          error_log: DRUG_MASTER_IMPORT_FAILURE_MESSAGE,
        },
      });
    } catch (logError) {
      logger.warn(
        {
          event: 'drug-master-import.failure-log-update-failed',
          operation: 'with-import-log',
          filePurpose: 'drug-master-import',
          externalProvider: normalizeImportSourceForLog(source),
        },
        logError,
      );
    }
    throw error;
  }
}
