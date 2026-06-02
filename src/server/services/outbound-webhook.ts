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
    events: record.events.filter(isWebhookEventType),
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
        'X-PH-OS-Event': payload.event,
        'X-PH-OS-Delivery': payload.id,
        'X-PH-OS-Signature': buildSignatureHeader(registration.secret, body),
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

  return Promise.all(active.map((reg) => dispatchToEndpoint(reg, payload)));
}

export async function dispatchWebhookEventForOrg(
  orgId: string,
  event: WebhookEventType,
  data: Record<string, unknown>,
) {
  const registrations = await loadWebhookRegistrationsForOrg(orgId);
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
    console.error(`[webhook] Failed to dispatch ${event} for org ${orgId}:`, error);
    return [];
  }
}
