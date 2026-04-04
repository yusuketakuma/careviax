/**
 * アウトバウンド Webhook サービス
 *
 * イベント駆動の外部通知基盤。
 * 登録済み webhook エンドポイントにイベントを非同期送信する。
 * 実装は in-process HTTP dispatch（スタブ）。将来的には SQS/EventBridge に移行。
 */
import { createHmac } from 'node:crypto';

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

/**
 * Validate that a webhook URL is safe to send outbound requests to.
 * Rejects non-HTTPS URLs and private/loopback/link-local address ranges
 * to prevent SSRF attacks.
 */
export function isAllowedWebhookUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
    if (hostname.startsWith('169.254.') || hostname.startsWith('10.') || hostname.startsWith('192.168.')) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    return true;
  } catch { return false; }
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
