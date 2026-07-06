/**
 * OS 通知ブリッジ redaction (HG-5)。
 *
 * ブラウザ Notification API(OS 層 = 端末のロック画面 / 通知センター / 他アプリから
 * 可視な層)へ患者名・通知本文・ディープリンク等の PHI を一切渡さないための境界。
 * サーバー外部通知(SMS/LINE/email/FAX 等)の redaction 方針と同様に、
 * 「外部へ出る文言は種別ベースの汎用文言のみ」とし、詳細はアプリ内で開く。
 *
 * in-app(通知センター)の表示は従来どおり raw な title/message/link を使う。
 * ここで redact するのは OS 通知ブリッジへ渡す文言のみ。
 */

/** OS 層へ渡す固定タイトル(アプリ名のみ、PHI なし)。 */
const OS_BRIDGE_TITLE = 'PH-OS 通知';

/** OS 層へ渡す汎用本文(種別のみ、患者名・本文などの PHI は含めない)。 */
const OS_BRIDGE_BODY_BY_TYPE: Record<string, string> = {
  urgent: '新しい緊急通知があります',
  business: '新しい業務通知があります',
  reminder: '新しいリマインダーがあります',
  system: '新しいシステム通知があります',
};

/** 未知の種別に対する汎用本文。 */
const OS_BRIDGE_BODY_FALLBACK = '新しい通知があります';

/**
 * OS 通知クリック時に開くアプリ内ランディング。
 * 患者 ID などの識別子を含むディープリンクは渡さず、通知センターへ誘導し
 * 詳細はアプリ内で開かせる(PHI をディープリンク経由で OS 層へ漏らさない)。
 *
 * クライアント(notification-bell)側の OS ブリッジと、サーバー Web Push 送信側
 * (server/services/notifications) の双方で同じ汎用ランディングを使うため export する。
 */
export const OS_BRIDGE_LANDING_URL = '/notifications';

export type OsBridgeRedactedNotification = {
  title: string;
  body: string;
  url: string;
};

function readPushPayloadType(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 'system';
  const object = payload as Record<string, unknown>;
  const type = object.type ?? object.notification_type;
  return typeof type === 'string' ? type : 'system';
}

/**
 * in-app 通知 1 件を OS 通知ブリッジ用に redact する。
 * raw な title / message / link は破棄し、種別ベースの汎用文言と
 * 汎用ランディング URL のみを返す。
 */
export function redactNotificationForOsBridge(notification: {
  type: string;
}): OsBridgeRedactedNotification {
  return {
    title: OS_BRIDGE_TITLE,
    body: OS_BRIDGE_BODY_BY_TYPE[notification.type] ?? OS_BRIDGE_BODY_FALLBACK,
    url: OS_BRIDGE_LANDING_URL,
  };
}

/**
 * Web Push payload を OS 通知ブリッジ用に fail-close で redact する。
 * Service Worker は raw push payload を信用せず、種別だけを安全側に読む。
 */
export function redactPushPayloadForOsBridge(payload: unknown): OsBridgeRedactedNotification {
  return redactNotificationForOsBridge({ type: readPushPayloadType(payload) });
}
