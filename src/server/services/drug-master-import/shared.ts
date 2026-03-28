import { Prisma, PrismaClient } from '@prisma/client';

export type DrugMasterImportDbClient = Pick<
  PrismaClient,
  | 'drugMaster'
  | 'drugMasterImportLog'
  | 'genericDrugMapping'
  | 'drugPackageInsert'
  | 'drugInteraction'
  | 'drugAlertRule'
>;

export type DrugMasterImportSource =
  | 'ssk'
  | 'pmda'
  | 'mhlw_price'
  | 'mhlw_generic'
  | 'hot'
  | 'manual_clinical';

export type FetchLike = typeof fetch;

export async function fetchBytes(url: string, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      accept:
        'application/octet-stream,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/xml,text/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`外部ファイルの取得に失敗しました: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function fetchText(
  url: string,
  fetchImpl: FetchLike = fetch,
  accept = 'text/html,application/xhtml+xml'
) {
  const response = await fetchImpl(url, {
    headers: { accept },
  });

  if (!response.ok) {
    throw new Error(`ページの取得に失敗しました: ${response.status}`);
  }

  return response.text();
}

export function resolveAbsoluteUrl(pathOrUrl: string, baseUrl: string) {
  return new URL(pathOrUrl, baseUrl).toString();
}

export function normalizeCell(value: unknown) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
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

export function splitDelimitedLine(line: string, delimiter = ',') {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export function isZipBuffer(buffer: Buffer) {
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function decodeTextBuffer(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

type LoggedImportResult<T> = {
  recordCount: number;
  payload: T;
};

export async function withImportLog<T>(
  db: DrugMasterImportDbClient,
  source: DrugMasterImportSource,
  fn: () => Promise<LoggedImportResult<T>>
) {
  const log = await db.drugMasterImportLog.create({
    data: {
      source,
      status: 'running',
      record_count: 0,
    },
  });

  try {
    const result = await fn();
    const completedLog = await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'completed',
        record_count: result.recordCount,
      },
    });

    return {
      ...result.payload,
      log: completedLog,
      importedCount: result.recordCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '医薬品マスタ取込に失敗しました';
    await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        error_log: message,
      },
    });
    throw error;
  }
}
