import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
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
  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return new Date(Date.UTC(year, month - 1, day));
  }

  if (/^\d{6}$/.test(value)) {
    const year = 2000 + Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    return new Date(Date.UTC(year, month - 1, day));
  }

  return null;
}

export function extractImportSourceDateFromUrl(url: string, patterns: readonly RegExp[]) {
  for (const pattern of patterns) {
    const match = url.match(pattern);
    const token = match?.[1];
    if (!token) continue;
    const parsed = parseImportSourceDateToken(token);
    if (parsed) return parsed;
  }
  return null;
}

export function parseJapaneseEraApplicableDateText(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeDigits(value);
  const match = normalized.match(/(令和|平成)(\d{1,2})年(\d{1,2})月(\d{1,2})日(?:\s*適用)?/);
  if (!match) return null;

  const era = match[1];
  const eraYear = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (eraYear < 1) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const baseYear = era === '令和' ? 2018 : 1988;
  const year = baseYear + eraYear;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
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
  if (!value) return null;
  const normalized = normalizeDigits(value).trim();
  const isoMatch = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const jpMatch = normalized.match(/^R?(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
  if (jpMatch) {
    const year = 2018 + Number(jpMatch[1]);
    return new Date(Date.UTC(year, Number(jpMatch[2]) - 1, Number(jpMatch[3])));
  }

  return null;
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
