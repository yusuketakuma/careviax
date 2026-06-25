/**
 * アウトバウンド Webhook サービス
 *
 * イベント駆動の外部通知基盤。
 * 登録済み webhook エンドポイントにイベントを非同期送信する。
 * 実装は in-process HTTP dispatch（スタブ）。将来的には SQS/EventBridge に移行。
 */
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readJsonObject } from '@/lib/db/json';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import { logger } from '@/lib/utils/logger';
import { createFetchTimeout } from './fetch-timeout';
import { readWebhookSigningSecret } from './webhook-secret-encryption';

export const WEBHOOK_EVENT_TYPES = [
  'prescription.created',
  'prescription.dispensed',
  'patient.created',
  'billing.exported',
  'qualification.checked',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const webhookEventTypeSet = new Set<string>(WEBHOOK_EVENT_TYPES);

export function isWebhookEventType(value: string): value is WebhookEventType {
  return webhookEventTypeSet.has(value);
}

export type WebhookRegistration = {
  id: string;
  orgId: string;
  url: string;
  secret: string | null;
  secretCiphertext?: string | null;
  secretIv?: string | null;
  secretTag?: string | null;
  secretKeyId?: string | null;
  secretAlgorithm?: string | null;
  events: WebhookEventType[];
  isActive: boolean;
  createdAt: Date;
};

export type WebhookPayload<T = Record<string, unknown>> = {
  id: string;
  event: WebhookEventType;
  orgId: string;
  occurredAt: string;
  data: T;
};

export type WebhookDeliveryResult = {
  webhookId: string;
  event: WebhookEventType;
  url: string;
  statusCode: number | null;
  success: boolean;
  error?: string;
};

export type WebhookDeliveryRetrySummary = {
  processedCount: number;
  scannedCount: number;
  succeededCount: number;
  failedCount: number;
  blockedCount: number;
  errors?: string[];
};

type WebhookDeliveryRetryRecord = {
  id: string;
  org_id: string;
  webhook_registration_id: string;
  delivery_id: string;
  event: string;
  payload: unknown;
  url: string;
  attempt_count: number;
  registration: {
    id: string;
    org_id: string;
    url: string;
    secret: string | null;
    secret_ciphertext: string | null;
    secret_iv: string | null;
    secret_tag: string | null;
    secret_key_id: string | null;
    secret_algorithm: string | null;
    events: string[];
    is_active: boolean;
    created_at: Date;
  } | null;
};

type WebhookDeliveryRetryAttempt = WebhookDeliveryResult & {
  deliveryStatus: 'succeeded' | 'failed' | 'blocked';
};

type WebhookDeliveryStore = {
  findMany?(args: unknown): Promise<WebhookDeliveryRetryRecord[]>;
  upsert(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany?(args: unknown): Promise<{ count: number }>;
};

type WebhookDeliveryPersistenceClient = {
  webhookDelivery?: WebhookDeliveryStore;
};

let webhookDeliveryPersistenceClientPromise: Promise<WebhookDeliveryPersistenceClient> | null =
  null;

const WEBHOOK_RETRY_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_WEBHOOK_RETRY_LIMIT = 50;
const MAX_WEBHOOK_RETRY_LIMIT = 100;
const DEFAULT_WEBHOOK_DISPATCH_CONCURRENCY = 4;
const DEFAULT_WEBHOOK_RETRY_CONCURRENCY = 4;
const MAX_WEBHOOK_RETRY_CONCURRENCY = 8;
const WEBHOOK_MAX_DELIVERY_ATTEMPTS = 8;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

function normalizeHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function readIpv4Octets(ip: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return octets as [number, number, number, number];
}

function isUnsafeIpv4Octets(octets: [number, number, number, number]) {
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (octets[2] === 0 || octets[2] === 2)) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && octets[2] === 100))) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function isUnsafeIpv4(ip: string) {
  const octets = readIpv4Octets(ip);
  return !octets || isUnsafeIpv4Octets(octets);
}

function ipv4OctetsToHextets(octets: [number, number, number, number]) {
  return [
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16),
  ] as const;
}

function normalizeIpv6Ipv4Tail(ip: string) {
  const ipv4Tail = ip.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!ipv4Tail) return ip;

  const octets = readIpv4Octets(ipv4Tail[2]);
  if (!octets) return null;

  const [first, second] = ipv4OctetsToHextets(octets);
  return `${ipv4Tail[1]}${first}:${second}`;
}

function readIpv6Hextets(ip: string) {
  const normalized = ip.toLowerCase();
  const ipv6 = normalizeIpv6Ipv4Tail(normalized);
  if (!ipv6) return null;

  const doubleColonParts = ipv6.split('::');
  if (doubleColonParts.length > 2) return null;

  const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
  const missing = doubleColonParts.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (doubleColonParts.length === 1 && left.length !== 8)) return null;

  const segments = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (segments.length !== 8) return null;

  const hextets = segments.map((segment) => {
    if (!/^[0-9a-f]{1,4}$/.test(segment)) return null;
    const value = Number.parseInt(segment, 16);
    return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : null;
  });

  return hextets.every((value): value is number => value !== null)
    ? (hextets as [number, number, number, number, number, number, number, number])
    : null;
}

function readMappedIpv4Octets(
  hextets: [number, number, number, number, number, number, number, number],
) {
  const isMapped =
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff;
  if (!isMapped) return null;

  return [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff] as [
    number,
    number,
    number,
    number,
  ];
}

function isUnsafeIpv6(ip: string) {
  const hextets = readIpv6Hextets(ip);
  if (!hextets) return true;

  const mappedIpv4 = readMappedIpv4Octets(hextets);
  if (mappedIpv4) return isUnsafeIpv4Octets(mappedIpv4);

  const [firstHextet, secondHextet, thirdHextet, fourthHextet] = hextets;
  const isUnspecifiedOrLoopback =
    hextets.slice(0, 7).every((value) => value === 0) && hextets[7] <= 1;
  if (isUnspecifiedOrLoopback) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (
    firstHextet === 0x0064 &&
    secondHextet === 0xff9b &&
    thirdHextet === 0 &&
    fourthHextet === 0
  ) {
    return true;
  }
  if (firstHextet === 0x0100 && secondHextet === 0 && thirdHextet === 0 && fourthHextet === 0) {
    return true;
  }
  if (firstHextet === 0x2001 && secondHextet === 0x0db8) return true; // documentation
  if (firstHextet === 0x2002) return true; // 6to4
  return false;
}

function isUnsafeIpAddress(ip: string) {
  const family = isIP(ip);
  if (family === 4) return isUnsafeIpv4(ip);
  if (family === 6) return isUnsafeIpv6(ip);
  return true;
}

export function hasWebhookUrlCredentials(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

export function redactWebhookUrlForDisplay(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid webhook URL]';
  }
}

/**
 * Validate that a webhook URL is safe to send outbound requests to.
 * Rejects non-HTTPS URLs and private/loopback/link-local address ranges
 * to prevent SSRF attacks.
 */
export async function isAllowedWebhookUrl(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    if (hasWebhookUrlCredentials(rawUrl)) return false;
    const hostname = normalizeHostname(url.hostname);
    if (hostname === 'localhost') return false;

    if (isIP(hostname)) {
      return !isUnsafeIpAddress(hostname);
    }

    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return false;

    return addresses.every((address) => !isUnsafeIpAddress(address.address));
  } catch {
    return false;
  }
}

function toWebhookRegistration(record: {
  id: string;
  org_id: string;
  url: string;
  secret: string | null;
  secret_ciphertext?: string | null;
  secret_iv?: string | null;
  secret_tag?: string | null;
  secret_key_id?: string | null;
  secret_algorithm?: string | null;
  events: string[];
  is_active: boolean;
  created_at: Date;
}): WebhookRegistration {
  return {
    id: record.id,
    orgId: record.org_id,
    url: record.url,
    secret: record.secret,
    secretCiphertext: record.secret_ciphertext ?? null,
    secretIv: record.secret_iv ?? null,
    secretTag: record.secret_tag ?? null,
    secretKeyId: record.secret_key_id ?? null,
    secretAlgorithm: record.secret_algorithm ?? null,
    events: record.events.filter(isWebhookEventType),
    isActive: record.is_active,
    createdAt: record.created_at,
  };
}

async function loadWebhookRegistrationsForOrg(orgId: string, event: WebhookEventType) {
  const { prisma } = await import('@/lib/db/client');
  const records = await prisma.webhookRegistration.findMany({
    where: { org_id: orgId, is_active: true, events: { has: event } },
    select: {
      id: true,
      org_id: true,
      url: true,
      secret: true,
      secret_ciphertext: true,
      secret_iv: true,
      secret_tag: true,
      secret_key_id: true,
      secret_algorithm: true,
      events: true,
      is_active: true,
      created_at: true,
    },
  });

  return records.map(toWebhookRegistration);
}

async function loadWebhookDeliveryPersistenceClient() {
  webhookDeliveryPersistenceClientPromise ??= import('@/lib/db/client')
    .then(({ prisma }) => prisma as unknown as WebhookDeliveryPersistenceClient)
    .catch((error: unknown) => {
      webhookDeliveryPersistenceClientPromise = null;
      throw error;
    });
  return webhookDeliveryPersistenceClientPromise;
}

function deliveryWhere(registration: WebhookRegistration, payload: WebhookPayload) {
  return {
    delivery_id_webhook_registration_id: {
      delivery_id: payload.id,
      webhook_registration_id: registration.id,
    },
  };
}

function truncateWebhookDeliveryError(error: string | undefined) {
  if (!error) return undefined;
  return error.length > 500 ? `${error.slice(0, 497)}...` : error;
}

function normalizeWebhookRetryLimit(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_WEBHOOK_RETRY_LIMIT;
  const normalized = Math.trunc(value);
  if (normalized <= 0) return DEFAULT_WEBHOOK_RETRY_LIMIT;
  return Math.min(normalized, MAX_WEBHOOK_RETRY_LIMIT);
}

function normalizeWebhookRetryConcurrency(value: number | undefined) {
  return normalizeConcurrencyLimit(value, {
    defaultValue: DEFAULT_WEBHOOK_RETRY_CONCURRENCY,
    max: MAX_WEBHOOK_RETRY_CONCURRENCY,
  });
}

function readStoredWebhookPayload(record: WebhookDeliveryRetryRecord): WebhookPayload | null {
  const payload = readJsonObject(record.payload);
  if (!payload) return null;

  const id = typeof payload.id === 'string' ? payload.id : null;
  const event = typeof payload.event === 'string' ? payload.event : null;
  const orgId = typeof payload.orgId === 'string' ? payload.orgId : null;
  const occurredAt = typeof payload.occurredAt === 'string' ? payload.occurredAt : null;
  const data = readJsonObject(payload.data);

  if (
    id !== record.delivery_id ||
    event !== record.event ||
    orgId !== record.org_id ||
    !occurredAt ||
    !data ||
    !isWebhookEventType(event)
  ) {
    return null;
  }

  return {
    id,
    event,
    orgId,
    occurredAt,
    data,
  };
}

async function blockStoredWebhookDelivery(record: WebhookDeliveryRetryRecord, error: string) {
  const db = await loadWebhookDeliveryPersistenceClient();
  if (!db.webhookDelivery) return;

  await db.webhookDelivery.update({
    where: { id: record.id },
    data: {
      status: 'blocked',
      status_code: null,
      error: truncateWebhookDeliveryError(error) ?? null,
      attempt_count: { increment: 1 },
      last_attempt_at: new Date(),
      next_attempt_at: null,
    },
  });
}

async function listDueWebhookDeliveries(args: {
  orgId?: string;
  limit: number;
  now: Date;
}): Promise<WebhookDeliveryRetryRecord[]> {
  const db = await loadWebhookDeliveryPersistenceClient();
  if (!db.webhookDelivery?.findMany) return [];

  return db.webhookDelivery.findMany({
    where: {
      status: 'failed',
      attempt_count: { lt: WEBHOOK_MAX_DELIVERY_ATTEMPTS },
      next_attempt_at: { lte: args.now },
      ...(args.orgId ? { org_id: args.orgId } : {}),
    },
    orderBy: [{ next_attempt_at: 'asc' }, { created_at: 'asc' }],
    take: args.limit,
    select: {
      id: true,
      org_id: true,
      webhook_registration_id: true,
      delivery_id: true,
      event: true,
      payload: true,
      url: true,
      attempt_count: true,
      registration: {
        select: {
          id: true,
          org_id: true,
          url: true,
          secret: true,
          secret_ciphertext: true,
          secret_iv: true,
          secret_tag: true,
          secret_key_id: true,
          secret_algorithm: true,
          events: true,
          is_active: true,
          created_at: true,
        },
      },
    },
  });
}

async function claimDueWebhookDelivery(record: WebhookDeliveryRetryRecord, now: Date) {
  const db = await loadWebhookDeliveryPersistenceClient();
  if (!db.webhookDelivery?.updateMany) return true;

  const claim = await db.webhookDelivery.updateMany({
    where: {
      id: record.id,
      org_id: record.org_id,
      status: 'failed',
      attempt_count: record.attempt_count,
      next_attempt_at: { lte: now },
    },
    data: {
      status: 'pending',
      status_code: null,
      error: null,
      next_attempt_at: null,
    },
  });

  return claim.count === 1;
}

async function retryStoredWebhookDelivery(
  record: WebhookDeliveryRetryRecord,
): Promise<WebhookDeliveryRetryAttempt> {
  const payload = readStoredWebhookPayload(record);
  const registrationRecord = record.registration;
  const blockedBase = {
    webhookId: record.webhook_registration_id,
    event: isWebhookEventType(record.event) ? record.event : 'patient.created',
    url: record.url,
    statusCode: null,
    success: false,
  } satisfies WebhookDeliveryResult;

  if (!payload) {
    const error = 'Malformed persisted webhook payload';
    await blockStoredWebhookDelivery(record, error);
    return { ...blockedBase, error, deliveryStatus: 'blocked' };
  }

  if (!registrationRecord || registrationRecord.org_id !== record.org_id) {
    const error = 'Webhook registration is unavailable';
    await blockStoredWebhookDelivery(record, error);
    return { ...blockedBase, event: payload.event, error, deliveryStatus: 'blocked' };
  }

  const registration = toWebhookRegistration(registrationRecord);
  if (!registration.isActive) {
    const error = 'Webhook registration is inactive';
    await blockStoredWebhookDelivery(record, error);
    return {
      ...blockedBase,
      event: payload.event,
      url: registration.url,
      error,
      deliveryStatus: 'blocked',
    };
  }

  if (!registration.events.includes(payload.event)) {
    const error = 'Webhook registration no longer accepts this event';
    await blockStoredWebhookDelivery(record, error);
    return {
      ...blockedBase,
      event: payload.event,
      url: registration.url,
      error,
      deliveryStatus: 'blocked',
    };
  }

  const result = await dispatchToEndpoint(registration, payload);
  return {
    ...result,
    deliveryStatus: result.success
      ? 'succeeded'
      : result.error === 'Blocked unsafe webhook destination'
        ? 'blocked'
        : 'failed',
  };
}

async function recordWebhookDeliveryPending(
  registration: WebhookRegistration,
  payload: WebhookPayload,
) {
  try {
    const db = await loadWebhookDeliveryPersistenceClient();
    if (!db.webhookDelivery) return;
    const now = new Date();
    const displayUrl = redactWebhookUrlForDisplay(registration.url);
    await db.webhookDelivery.upsert({
      where: deliveryWhere(registration, payload),
      create: {
        org_id: payload.orgId,
        webhook_registration_id: registration.id,
        delivery_id: payload.id,
        event: payload.event,
        payload,
        url: displayUrl,
        status: 'pending',
        next_attempt_at: now,
      },
      update: {
        event: payload.event,
        payload,
        url: displayUrl,
        status: 'pending',
        status_code: null,
        error: null,
        next_attempt_at: now,
      },
    });
  } catch (error) {
    logger.error(
      {
        event: 'webhook.delivery_pending_persist_failed',
        orgId: payload.orgId,
        entityType: 'webhook_delivery',
        entityId: payload.id,
        targetId: registration.id,
        code: 'WEBHOOK_PENDING_PERSIST_FAILED',
      },
      error,
    );
  }
}

async function recordWebhookDeliveryResult(
  registration: WebhookRegistration,
  payload: WebhookPayload,
  result: WebhookDeliveryResult,
  status: 'succeeded' | 'failed' | 'blocked',
) {
  try {
    const db = await loadWebhookDeliveryPersistenceClient();
    if (!db.webhookDelivery) return;
    const retryAt =
      status === 'succeeded' || status === 'blocked'
        ? null
        : new Date(Date.now() + WEBHOOK_RETRY_DELAY_MS);
    await db.webhookDelivery.update({
      where: deliveryWhere(registration, payload),
      data: {
        status,
        status_code: result.statusCode,
        error: truncateWebhookDeliveryError(result.error) ?? null,
        attempt_count: { increment: 1 },
        last_attempt_at: new Date(),
        next_attempt_at: retryAt,
      },
    });
  } catch (error) {
    logger.error(
      {
        event: 'webhook.delivery_result_persist_failed',
        orgId: payload.orgId,
        entityType: 'webhook_delivery',
        entityId: payload.id,
        targetId: registration.id,
        code: 'WEBHOOK_RESULT_PERSIST_FAILED',
      },
      error,
    );
  }
}

/**
 * HMAC-SHA256 署名ヘッダを生成する。
 */
function buildSignatureHeader(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * 単一の webhook エンドポイントにイベントを送信する。
 * タイムアウト: 10 秒。失敗してもスローしない（呼び出し元はエラーを無視できる）。
 */
async function dispatchToEndpoint(
  registration: WebhookRegistration,
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify(payload);
  const base: WebhookDeliveryResult = {
    webhookId: registration.id,
    event: payload.event,
    url: registration.url,
    statusCode: null,
    success: false,
  };

  try {
    await recordWebhookDeliveryPending(registration, payload);

    if (!(await isAllowedWebhookUrl(registration.url))) {
      const blocked = {
        ...base,
        error: 'Blocked unsafe webhook destination',
      };
      await recordWebhookDeliveryResult(registration, payload, blocked, 'blocked');
      return blocked;
    }

    const signingSecret = await readWebhookSigningSecret({
      secret: registration.secret,
      secret_ciphertext: registration.secretCiphertext,
      secret_iv: registration.secretIv,
      secret_tag: registration.secretTag,
      secret_key_id: registration.secretKeyId,
      secret_algorithm: registration.secretAlgorithm,
    });

    const abort = createFetchTimeout(WEBHOOK_DELIVERY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(registration.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'X-PH-OS-Event': payload.event,
          'X-PH-OS-Delivery': payload.id,
          'X-PH-OS-Signature': buildSignatureHeader(signingSecret, body),
        },
        body,
        signal: abort.signal,
      });
    } finally {
      abort.clear();
    }

    const result = { ...base, statusCode: response.status, success: response.ok };
    await recordWebhookDeliveryResult(
      registration,
      payload,
      result,
      result.success ? 'succeeded' : 'failed',
    );
    return result;
  } catch (err) {
    const result = {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
    await recordWebhookDeliveryResult(registration, payload, result, 'failed');
    return result;
  }
}

export async function retryDueWebhookDeliveries(
  options: {
    orgId?: string;
    limit?: number;
    concurrency?: number;
    now?: Date;
  } = {},
): Promise<WebhookDeliveryRetrySummary> {
  const now = options.now ?? new Date();
  const deliveries = await listDueWebhookDeliveries({
    orgId: options.orgId,
    limit: normalizeWebhookRetryLimit(options.limit),
    now,
  });

  if (deliveries.length === 0) {
    return {
      processedCount: 0,
      scannedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      blockedCount: 0,
    };
  }

  const claimedDeliveries = (
    await mapWithConcurrency(
      deliveries,
      normalizeWebhookRetryConcurrency(options.concurrency),
      (record) => claimDueWebhookDelivery(record, now).then((claimed) => (claimed ? record : null)),
    )
  ).filter((record): record is WebhookDeliveryRetryRecord => record !== null);

  if (claimedDeliveries.length === 0) {
    return {
      processedCount: 0,
      scannedCount: deliveries.length,
      succeededCount: 0,
      failedCount: 0,
      blockedCount: 0,
    };
  }

  const attempts = await mapWithConcurrency(
    claimedDeliveries,
    normalizeWebhookRetryConcurrency(options.concurrency),
    retryStoredWebhookDelivery,
  );
  const errors = attempts.flatMap((attempt) => (attempt.error ? [attempt.error] : []));

  return {
    processedCount: attempts.length,
    scannedCount: deliveries.length,
    succeededCount: attempts.filter((attempt) => attempt.deliveryStatus === 'succeeded').length,
    failedCount: attempts.filter((attempt) => attempt.deliveryStatus === 'failed').length,
    blockedCount: attempts.filter((attempt) => attempt.deliveryStatus === 'blocked').length,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

/**
 * イベントを受け取り、登録された全エンドポイントに並行配信する。
 *
 * @param registrations - 対象 org の webhook 登録一覧
 * @param event - 発生したイベント種別
 * @param orgId - 発生元 org ID
 * @param data - イベントペイロード
 */
export async function dispatchWebhookEvent(
  registrations: WebhookRegistration[],
  event: WebhookEventType,
  orgId: string,
  data: Record<string, unknown>,
): Promise<WebhookDeliveryResult[]> {
  const active = registrations.filter(
    (registration) => registration.isActive && registration.events.includes(event),
  );

  if (active.length === 0) return [];

  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event,
    orgId,
    occurredAt: new Date().toISOString(),
    data,
  };

  return mapWithConcurrency(active, DEFAULT_WEBHOOK_DISPATCH_CONCURRENCY, (registration) =>
    dispatchToEndpoint(registration, payload),
  );
}

export async function dispatchWebhookEventForOrg(
  orgId: string,
  event: WebhookEventType,
  data: Record<string, unknown>,
) {
  const registrations = await loadWebhookRegistrationsForOrg(orgId, event);
  return dispatchWebhookEvent(registrations, event, orgId, data);
}

export async function notifyWebhookEventForOrg(
  orgId: string,
  event: WebhookEventType,
  data: Record<string, unknown>,
) {
  try {
    return await dispatchWebhookEventForOrg(orgId, event, data);
  } catch (error) {
    logger.error(
      {
        event: 'webhook.org_dispatch_failed',
        orgId,
        entityType: 'webhook_event',
        entityId: event,
        code: 'WEBHOOK_ORG_DISPATCH_FAILED',
      },
      error,
    );
    return [];
  }
}
