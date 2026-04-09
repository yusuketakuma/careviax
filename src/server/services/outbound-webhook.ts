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

export type WebhookEventType =
  | 'prescription.created'
  | 'prescription.dispensed'
  | 'patient.created'
  | 'billing.exported'
  | 'qualification.checked';

export type WebhookRegistration = {
  id: string;
  orgId: string;
  url: string;
  secret: string;
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

function normalizeHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isUnsafeIpv4(ip: string) {
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isUnsafeIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4[1]);

  const firstSegment = normalized.split(':').find((segment) => segment.length > 0);
  if (!firstSegment) return true;

  const firstHextet = Number.parseInt(firstSegment, 16);
  if (Number.isNaN(firstHextet)) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 link-local
  return false;
}

function isUnsafeIpAddress(ip: string) {
  const family = isIP(ip);
  if (family === 4) return isUnsafeIpv4(ip);
  if (family === 6) return isUnsafeIpv6(ip);
  return true;
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
  secret: string;
  events: string[];
  is_active: boolean;
  created_at: Date;
}): WebhookRegistration {
  return {
    id: record.id,
    orgId: record.org_id,
    url: record.url,
    secret: record.secret,
    events: record.events as WebhookEventType[],
    isActive: record.is_active,
    createdAt: record.created_at,
  };
}

async function loadWebhookRegistrationsForOrg(orgId: string) {
  const { prisma } = await import('@/lib/db/client');
  const records = await prisma.webhookRegistration.findMany({
    where: { org_id: orgId, is_active: true },
    select: {
      id: true,
      org_id: true,
      url: true,
      secret: true,
      events: true,
      is_active: true,
      created_at: true,
    },
  });

  return records.map(toWebhookRegistration);
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
  payload: WebhookPayload
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
    if (!(await isAllowedWebhookUrl(registration.url))) {
      return {
        ...base,
        error: 'Blocked unsafe webhook destination',
      };
    }

    const response = await fetch(registration.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CareViaX-Event': payload.event,
        'X-CareViaX-Delivery': payload.id,
        'X-CareViaX-Signature': buildSignatureHeader(registration.secret, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return { ...base, statusCode: response.status, success: response.ok };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
  data: Record<string, unknown>
): Promise<WebhookDeliveryResult[]> {
  const active = registrations.filter(
    (registration) => registration.isActive && registration.events.includes(event)
  );

  if (active.length === 0) return [];

  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event,
    orgId,
    occurredAt: new Date().toISOString(),
    data,
  };

  return Promise.all(active.map((reg) => dispatchToEndpoint(reg, payload)));
}

export async function dispatchWebhookEventForOrg(
  orgId: string,
  event: WebhookEventType,
  data: Record<string, unknown>
) {
  const registrations = await loadWebhookRegistrationsForOrg(orgId);
  return dispatchWebhookEvent(registrations, event, orgId, data);
}

export async function notifyWebhookEventForOrg(
  orgId: string,
  event: WebhookEventType,
  data: Record<string, unknown>
) {
  try {
    return await dispatchWebhookEventForOrg(orgId, event, data);
  } catch (error) {
    console.error(`[webhook] Failed to dispatch ${event} for org ${orgId}:`, error);
    return [];
  }
}
