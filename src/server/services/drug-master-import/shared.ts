import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Prisma, PrismaClient } from '@prisma/client';
import { unzipSync } from 'fflate';

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

export type FetchLike = typeof fetch;

const BYTES_PER_MIB = 1024 * 1024;
const DEFAULT_IMPORT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_IMPORT_MAX_REDIRECTS = 3;
const DEFAULT_IMPORT_TEXT_MAX_BYTES = 2 * BYTES_PER_MIB;
const EXTRA_ALLOWED_IMPORT_HOSTS_ENV = 'DRUG_MASTER_IMPORT_ALLOWED_HOSTS';

export type HostnameResolver = (hostname: string) => Promise<string[]>;

export type DrugMasterImportUrlPolicy = {
  source: DrugMasterImportSource;
  allowedHosts: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

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

type FetchImportOptions = {
  fetchImpl?: FetchLike;
  policy: DrugMasterImportUrlPolicy;
  accept?: string;
  maxBytes?: number;
  resolveHostname?: HostnameResolver;
};

type ImportUrlValidationResult = { ok: true; url: URL } | { ok: false; message: string };

export type ZipExpansionLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
};

type LimitedUnzipOptions = {
  sourceLabel: string;
  limits: ZipExpansionLimits;
  filter?: (entryName: string) => boolean;
};

type FetchImportResponseResult = {
  response: Response;
  signal: AbortSignal;
  clearTimeout: () => void;
};

function formatByteLimit(bytes: number) {
  if (bytes >= BYTES_PER_MIB && bytes % BYTES_PER_MIB === 0) {
    return `${bytes / BYTES_PER_MIB}MiB`;
  }
  return `${bytes} bytes`;
}

function normalizeHostname(hostname: string) {
  return hostname
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '')
    .toLowerCase();
}

function parseAllowedHost(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return normalizeHostname(new URL(trimmed).hostname);
    }
  } catch {
    return null;
  }

  return normalizeHostname(trimmed);
}

function getAllowedHosts(policy: DrugMasterImportUrlPolicy) {
  const extraHosts =
    process.env[EXTRA_ALLOWED_IMPORT_HOSTS_ENV]?.split(',')
      .map(parseAllowedHost)
      .filter((host): host is string => Boolean(host)) ?? [];

  return [...new Set([...policy.allowedHosts.map(normalizeHostname), ...extraHosts])];
}

function parseIpv4Bytes(address: string) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (
    bytes.some(
      (byte, index) => !Number.isInteger(byte) || byte < 0 || byte > 255 || parts[index] === '',
    )
  ) {
    return null;
  }
  return bytes;
}

function isDisallowedIpv4(address: string) {
  const bytes = parseIpv4Bytes(address);
  if (!bytes) return true;
  const [first, second, third] = bytes;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function mappedIpv4FromIpv6(address: string) {
  const match = address.toLowerCase().match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return match?.[1] ?? null;
}

function isDisallowedIpv6(address: string) {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = mappedIpv4FromIpv6(normalized);
  if (mappedIpv4) {
    return isDisallowedIpv4(mappedIpv4);
  }

  if (normalized === '::' || normalized === '::1') return true;
  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (!Number.isFinite(firstHextet)) return true;

  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  );
}

function isDisallowedIpAddress(hostname: string) {
  const normalized = normalizeHostname(hostname);
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isDisallowedIpv4(normalized);
  if (ipVersion === 6) return isDisallowedIpv6(normalized);
  return false;
}

function isAllowedHostname(hostname: string, policy: DrugMasterImportUrlPolicy) {
  const normalized = normalizeHostname(hostname);
  return getAllowedHosts(policy).includes(normalized);
}

export function validateImportSourceUrl(
  url: string,
  policy: DrugMasterImportUrlPolicy,
): ImportUrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: '取込URLの形式が不正です' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, message: '認証情報を含む取込URLは指定できません' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, message: '取込URLはHTTPSのみ指定できます' };
  }

  if (isDisallowedIpAddress(parsed.hostname)) {
    return { ok: false, message: 'private/reserved IP 宛ての取込URLは許可されていません' };
  }

  if (!isAllowedHostname(parsed.hostname, policy)) {
    return { ok: false, message: '許可された公式取込ホストのみ指定できます' };
  }

  return { ok: true, url: parsed };
}

export function isAllowedImportSourceUrl(url: string, policy: DrugMasterImportUrlPolicy) {
  return validateImportSourceUrl(url, policy).ok;
}

export function importSourceUrlValidationMessage() {
  return '許可された公式HTTPS取込URLのみ指定できます';
}

async function resolveHostnameAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) return [normalized];
  const records = await dnsLookup(normalized, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function assertPublicDnsResolution(url: URL, resolveHostname: HostnameResolver) {
  const addresses = await resolveHostname(url.hostname);
  if (addresses.length === 0) {
    throw new Error('取込URLの名前解決に失敗しました');
  }

  const blockedAddress = addresses.find(isDisallowedIpAddress);
  if (blockedAddress) {
    throw new Error(`private/reserved IP 宛ての取込URLは許可されていません: ${blockedAddress}`);
  }
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function createImportTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('外部ファイルの取得がタイムアウトしました'));
  }, timeoutMs);
  timeout.unref?.();

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function timeoutError(signal: AbortSignal) {
  const reason = signal.reason;
  if (reason instanceof Error && reason.message) {
    return new Error(reason.message);
  }
  return new Error('外部ファイルの取得がタイムアウトしました');
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    throw timeoutError(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(timeoutError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

async function fetchImportResponse(
  url: string,
  options: FetchImportOptions,
): Promise<FetchImportResponseResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.policy.timeoutMs ?? DEFAULT_IMPORT_FETCH_TIMEOUT_MS;
  const maxRedirects = options.policy.maxRedirects ?? DEFAULT_IMPORT_MAX_REDIRECTS;
  const resolveHostname =
    options.resolveHostname ?? (fetchImpl === fetch ? resolveHostnameAddresses : null);
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const validation = validateImportSourceUrl(currentUrl, options.policy);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    if (resolveHostname) {
      await assertPublicDnsResolution(validation.url, resolveHostname);
    }

    const timeout = createImportTimeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(validation.url.toString(), {
        cache: 'no-store',
        redirect: 'manual',
        signal: timeout.signal,
        headers: options.accept ? { accept: options.accept } : undefined,
      });
    } catch (error) {
      timeout.clear();
      if (timeout.signal.aborted) {
        throw timeoutError(timeout.signal);
      }
      throw error;
    }

    if (!isRedirectStatus(response.status)) {
      return {
        response,
        signal: timeout.signal,
        clearTimeout: timeout.clear,
      };
    }

    const location = response.headers.get('location');
    timeout.clear();
    if (!location) {
      throw new Error(`外部ファイルのリダイレクト先を解決できませんでした: ${response.status}`);
    }
    if (redirectCount === maxRedirects) {
      throw new Error('外部ファイルのリダイレクト回数が上限を超えました');
    }

    currentUrl = new URL(location, validation.url).toString();
  }

  throw new Error('外部ファイルの取得に失敗しました');
}

function assertContentLength(response: Response, maxBytes: number) {
  const header = response.headers.get('content-length');
  if (!header || !/^\d+$/.test(header)) return;
  const contentLength = Number(header);
  if (contentLength > maxBytes) {
    throw new Error(`外部ファイルのサイズが上限（${formatByteLimit(maxBytes)}）を超えています`);
  }
}

async function readResponseBytes(response: Response, maxBytes: number, signal: AbortSignal) {
  assertContentLength(response, maxBytes);

  if (!response.body) {
    const buffer = Buffer.from(await abortable(response.arrayBuffer(), signal));
    if (buffer.byteLength > maxBytes) {
      throw new Error(`外部ファイルのサイズが上限（${formatByteLimit(maxBytes)}）を超えています`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await abortable(reader.read(), signal);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }

    const { done, value } = chunk;
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`外部ファイルのサイズが上限（${formatByteLimit(maxBytes)}）を超えています`);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

export async function fetchBytes(url: string, options: FetchImportOptions) {
  const result = await fetchImportResponse(url, {
    ...options,
    accept:
      options.accept ??
      'application/octet-stream,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/xml,text/xml',
  });

  try {
    if (!result.response.ok) {
      throw new Error(`外部ファイルの取得に失敗しました: ${result.response.status}`);
    }

    return await readResponseBytes(
      result.response,
      options.maxBytes ?? options.policy.maxBytes,
      result.signal,
    );
  } finally {
    result.clearTimeout();
  }
}

export async function fetchText(url: string, options: FetchImportOptions) {
  const result = await fetchImportResponse(url, {
    ...options,
    accept: options.accept ?? 'text/html,application/xhtml+xml',
  });

  try {
    if (!result.response.ok) {
      throw new Error(`ページの取得に失敗しました: ${result.response.status}`);
    }

    const buffer = await readResponseBytes(
      result.response,
      options.maxBytes ?? Math.min(options.policy.maxBytes, DEFAULT_IMPORT_TEXT_MAX_BYTES),
      result.signal,
    );
    return new TextDecoder('utf-8').decode(buffer);
  } finally {
    result.clearTimeout();
  }
}

export function resolveAbsoluteUrl(pathOrUrl: string, baseUrl: string) {
  return new URL(pathOrUrl, baseUrl).toString();
}

export function normalizeImportSourceUrl(url: string, policy: DrugMasterImportUrlPolicy) {
  const validation = validateImportSourceUrl(url, policy);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return validation.url.toString();
}

export function resolveImportSourceUrl(
  pathOrUrl: string,
  baseUrl: string,
  policy: DrugMasterImportUrlPolicy,
) {
  return normalizeImportSourceUrl(resolveAbsoluteUrl(pathOrUrl, baseUrl), policy);
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

function assertZipExpansionLimit(
  sourceLabel: string,
  limitLabel: string,
  actual: number,
  max: number,
) {
  if (actual <= max) return;
  if (limitLabel === 'entryCount') {
    throw new Error(`${sourceLabel}のZIPエントリ数が上限（${max}件）を超えています`);
  }
  throw new Error(`${sourceLabel}のZIP展開サイズが上限（${formatByteLimit(max)}）を超えています`);
}

export function unzipWithLimits(buffer: Uint8Array, options: LimitedUnzipOptions) {
  const { limits, sourceLabel } = options;
  let seenEntries = 0;
  let declaredTotalBytes = 0;

  const entries = unzipSync(buffer, {
    filter(file) {
      seenEntries += 1;
      assertZipExpansionLimit(sourceLabel, 'entryCount', seenEntries, limits.maxEntries);
      assertZipExpansionLimit(sourceLabel, 'entryBytes', file.originalSize, limits.maxEntryBytes);
      declaredTotalBytes += file.originalSize;
      assertZipExpansionLimit(sourceLabel, 'totalBytes', declaredTotalBytes, limits.maxTotalBytes);
      return options.filter?.(file.name) ?? true;
    },
  });

  let extractedEntries = 0;
  let extractedTotalBytes = 0;
  for (const bytes of Object.values(entries)) {
    extractedEntries += 1;
    assertZipExpansionLimit(sourceLabel, 'entryCount', extractedEntries, limits.maxEntries);
    assertZipExpansionLimit(sourceLabel, 'entryBytes', bytes.byteLength, limits.maxEntryBytes);
    extractedTotalBytes += bytes.byteLength;
    assertZipExpansionLimit(sourceLabel, 'totalBytes', extractedTotalBytes, limits.maxTotalBytes);
  }

  return entries;
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
