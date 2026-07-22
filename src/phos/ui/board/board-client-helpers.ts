import { ReportDeliveryStatus, UserRole } from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  CardBoardItemView,
  CardDetailResponse,
  HandoffView,
  ReportDeliveryView,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { PhosApiError, PhosOfflineQueuedError, type PhosApiClient } from '@/phos/api/types';
import type { PhosToastInput } from '@/phos/ui/feedback/PhosToastRegion';

function buildOperationIdempotencyKey(subjectId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${subjectId}-${operation}-${suffix}`;
}

export function buildIdempotencyKey(cardId: string, action: ActionCode): string {
  return buildOperationIdempotencyKey(cardId, action);
}

export function buildHandoffIdempotencyKey(handoffId: string, operation: string): string {
  return buildOperationIdempotencyKey(handoffId, operation);
}

export function buildVisitIdempotencyKey(packetId: string, operation: string): string {
  return buildOperationIdempotencyKey(packetId, operation);
}

export function buildReportDeliveryIdempotencyKey(deliveryId: string, operation: string): string {
  return buildOperationIdempotencyKey(deliveryId, operation);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sessionHasCapacityRole(role: unknown, groups: unknown): boolean {
  if (role === UserRole.MANAGER || role === UserRole.ADMIN) return true;
  if (!Array.isArray(groups)) return false;
  return groups.some((group) => {
    if (typeof group !== 'string') return false;
    const normalized = group.trim().toUpperCase();
    return normalized === UserRole.MANAGER || normalized === UserRole.ADMIN;
  });
}

export function updateBoardItem(
  items: CardBoardItemView[],
  response: Awaited<ReturnType<PhosApiClient['executeCardAction']>>,
): CardBoardItemView[] {
  return items.map((item) =>
    item.card.card_id === response.card.card_id
      ? { card: response.card, next_action: response.next_action }
      : item,
  );
}

export function updateDetailFromAction(
  detail: CardDetailResponse,
  response: Awaited<ReturnType<PhosApiClient['executeCardAction']>>,
): CardDetailResponse {
  return {
    ...detail,
    card: response.card,
    next_action: response.next_action,
    blockers: response.blockers,
    visible_tabs: response.visible_tabs ?? detail.visible_tabs,
    server_version: response.server_version,
  };
}

export function upsertHandoff(items: HandoffView[], next: HandoffView): HandoffView[] {
  const existing = items.some((item) => item.handoff_id === next.handoff_id);
  if (!existing) return [next, ...items];
  return items.map((item) => (item.handoff_id === next.handoff_id ? next : item));
}

export function removeHandoff(items: HandoffView[], handoffId: string): HandoffView[] {
  return items.filter((item) => item.handoff_id !== handoffId);
}

export function upsertActiveReportDelivery(
  items: ReportDeliveryView[],
  next: ReportDeliveryView,
): ReportDeliveryView[] {
  const active =
    next.status === ReportDeliveryStatus.WAITING_REPLY ||
    next.status === ReportDeliveryStatus.ACTION_REQUIRED;
  if (!active) return items.filter((item) => item.delivery_id !== next.delivery_id);
  const existing = items.some((item) => item.delivery_id === next.delivery_id);
  if (!existing) return [next, ...items];
  return items.map((item) => (item.delivery_id === next.delivery_id ? next : item));
}

export function updateDetailHandoff(
  detail: CardDetailResponse,
  handoff: HandoffView,
): CardDetailResponse {
  if (detail.card.card_id !== handoff.card_id) return detail;
  return {
    ...detail,
    handoffs: upsertHandoff(detail.handoffs ?? [], handoff),
    server_version: Math.max(detail.server_version, handoff.server_version),
  };
}

export function updateDetailVisitMode(
  detail: CardDetailResponse,
  visitMode: VisitModeView,
): CardDetailResponse {
  if (detail.visit_mode?.packet_id !== visitMode.packet_id) return detail;
  return {
    ...detail,
    visit_mode: visitMode,
    server_version: Math.max(detail.server_version, visitMode.server_version),
  };
}

export function actionErrorMessage(error: unknown): string {
  if (error instanceof PhosOfflineQueuedError) {
    return 'オフラインキューに保存しました。オンライン復帰後に同期します。';
  }
  if (error instanceof PhosApiError) {
    if (error.status === 422 && error.response.error_code === 'ACTION_GUARD_FAILED') {
      return '必要な情報が不足しています。カード詳細で不足内容を確認してください。';
    }
    if (
      error.status === 409 &&
      (error.response.error_code === 'STALE_VERSION' ||
        error.response.error_code === 'IDEMPOTENCY_CONFLICT')
    ) {
      return '他の端末で更新されています。カードを再読み込みしてください。';
    }
  }
  return '通信できません。再試行してください。';
}

export function errorToast(message: string): PhosToastInput {
  return {
    tone: 'ERROR',
    message_key: 'toast.action.error',
    params: { message },
  };
}

export function focusSourceCardOrBoard(cardId: string): void {
  const card = Array.from(document.querySelectorAll<HTMLElement>('[data-card-id]')).find(
    (candidate) => candidate.getAttribute('data-card-id') === cardId,
  );
  const cardButton = card?.querySelector<HTMLButtonElement>('[data-phos-card-body="true"]');
  const fallback = document.querySelector<HTMLElement>('[data-phos-board-root="true"]');
  (cardButton ?? fallback)?.focus();
}

export function readCardIdFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const cardId = new URL(window.location.href).searchParams.get('card')?.trim();
  return cardId || undefined;
}

export function syncCardIdToUrl(cardId: string | undefined): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const current = url.searchParams.get('card') ?? undefined;
  if (cardId) {
    if (current === cardId) return;
    url.searchParams.set('card', cardId);
  } else {
    if (!current) return;
    url.searchParams.delete('card');
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
