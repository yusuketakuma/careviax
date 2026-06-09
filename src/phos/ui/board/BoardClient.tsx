'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  ActionPhase,
  BoardDensity,
  BoardSortKey,
  BoardQuickFilter,
  CapacityScope,
  HandoffStatus,
  ReportDeliveryStatus,
  UserRole,
  VisitArrivalOutcome,
  VisitStep,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  ActionReasonInput,
  CapacityResponse,
  CardBoardItemView,
  CardDetailResponse,
  EvidencePendingView,
  HandoffView,
  ReportDeliveryView,
  TriageLane,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { createPhosApiClient } from '@/phos/api/client';
import {
  listPhosPendingEvidence,
  retryPhosOfflineEvidenceUploads,
} from '@/phos/api/offlineEvidenceQueue';
import { enqueuePhosOfflineCardAction } from '@/phos/api/offlineActionQueue';
import {
  PhosApiError,
  PhosOfflineQueuedError,
  type PhosApiClient,
  type PhosOfflineActionQueue,
  type PhosOfflineEvidenceQueue,
} from '@/phos/api/types';
import { usePhosAction } from '@/phos/api/usePhosAction';
import { countBoardFilters, selectBoardItems } from '@/phos/domain/board/boardFilters';
import { ClerkSupportWorkbench } from '@/phos/ui/handoff/ClerkSupportWorkbench';
import { HandoffQueue } from '@/phos/ui/handoff/HandoffQueue';
import { ReportDeliveryQueue } from '@/phos/ui/report/ReportDeliveryQueue';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import { appendPhosToast, PhosToastRegion } from '@/phos/ui/feedback/PhosToastRegion';
import type { PhosToastInput, PhosToastEntry } from '@/phos/ui/feedback/PhosToastRegion';
import type {
  ReportDeliveryActionDoneInput,
  ReportDeliveryReplyInput,
} from '@/phos/ui/report/ReportDeliveryQueue';
import type { HandoffCreateInput } from '@/phos/ui/workspace/HandoffPanel';
import { WorkspaceOverlay } from '@/phos/ui/workspace/WorkspaceOverlay';
import { CardBoard } from './CardBoard';

export type BoardClientProps = {
  apiBaseUrl?: string;
  client?: PhosApiClient;
  getAccessToken?: () => string | Promise<string>;
  initialSelectedCardId?: string;
  initialItems?: CardBoardItemView[];
  offlineActionQueue?: PhosOfflineActionQueue;
  offlineEvidenceQueue?: PhosOfflineEvidenceQueue;
};

type BoardPhase = 'LOADING' | 'READY' | 'ERROR';
type CapacityPhase = 'IDLE' | 'LOADING' | 'ERROR';

function buildIdempotencyKey(cardId: string, action: ActionCode): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${cardId}-${action}-${suffix}`;
}

function buildHandoffIdempotencyKey(handoffId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${handoffId}-${operation}-${suffix}`;
}

function buildVisitIdempotencyKey(packetId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${packetId}-${operation}-${suffix}`;
}

function buildReportDeliveryIdempotencyKey(deliveryId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${deliveryId}-${operation}-${suffix}`;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sessionHasCapacityRole(role: unknown, groups: unknown): boolean {
  if (role === UserRole.MANAGER || role === UserRole.ADMIN) return true;
  if (!Array.isArray(groups)) return false;
  return groups.some((group) => {
    if (typeof group !== 'string') return false;
    const normalized = group.trim().toUpperCase();
    return normalized === UserRole.MANAGER || normalized === UserRole.ADMIN;
  });
}

function updateBoardItem(
  items: CardBoardItemView[],
  response: Awaited<ReturnType<PhosApiClient['executeCardAction']>>,
): CardBoardItemView[] {
  return items.map((item) =>
    item.card.card_id === response.card.card_id
      ? { card: response.card, next_action: response.next_action }
      : item,
  );
}

function updateDetailFromAction(
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

function upsertHandoff(items: HandoffView[], next: HandoffView): HandoffView[] {
  const existing = items.some((item) => item.handoff_id === next.handoff_id);
  if (!existing) return [next, ...items];
  return items.map((item) => (item.handoff_id === next.handoff_id ? next : item));
}

function removeHandoff(items: HandoffView[], handoffId: string): HandoffView[] {
  return items.filter((item) => item.handoff_id !== handoffId);
}

function upsertActiveReportDelivery(
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

function updateDetailHandoff(detail: CardDetailResponse, handoff: HandoffView): CardDetailResponse {
  if (detail.card.card_id !== handoff.card_id) return detail;
  return {
    ...detail,
    handoffs: upsertHandoff(detail.handoffs ?? [], handoff),
    server_version: Math.max(detail.server_version, handoff.server_version),
  };
}

function updateDetailVisitMode(
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

function actionErrorMessage(error: unknown): string {
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

function errorToast(message: string): PhosToastInput {
  return {
    tone: 'ERROR',
    message_key: 'toast.action.error',
    params: { message },
  };
}

function focusSourceCardOrBoard(cardId: string): void {
  const card = Array.from(document.querySelectorAll<HTMLElement>('[data-card-id]')).find(
    (candidate) => candidate.getAttribute('data-card-id') === cardId,
  );
  const cardButton = card?.querySelector<HTMLButtonElement>('[data-phos-card-body="true"]');
  const fallback = document.querySelector<HTMLElement>('[data-phos-board-root="true"]');
  (cardButton ?? fallback)?.focus();
}

function readCardIdFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const cardId = new URL(window.location.href).searchParams.get('card')?.trim();
  return cardId || undefined;
}

function syncCardIdToUrl(cardId: string | undefined): void {
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

const defaultOfflineEvidenceQueue: PhosOfflineEvidenceQueue = {
  listPendingEvidence: listPhosPendingEvidence,
  retryUploads: retryPhosOfflineEvidenceUploads,
};

export function BoardClient({
  apiBaseUrl,
  client,
  getAccessToken,
  initialSelectedCardId,
  initialItems = [],
  offlineActionQueue,
  offlineEvidenceQueue = defaultOfflineEvidenceQueue,
}: BoardClientProps) {
  const { data: session } = useSession();
  const phosAccessToken = session?.phosAccessToken;
  const currentUserName = session?.user?.name ?? undefined;
  const canViewCapacity = sessionHasCapacityRole(session?.phosRole, session?.cognitoGroups);
  const [items, setItems] = useState<CardBoardItemView[]>(initialItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<BoardSortKey>(BoardSortKey.VISIT_TIME);
  const [density, setDensity] = useState<BoardDensity>(BoardDensity.COMFORTABLE);
  const [quickFilter, setQuickFilter] = useState<BoardQuickFilter>(BoardQuickFilter.ALL);
  const [triageLane, setTriageLane] = useState<TriageLane | undefined>();
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(initialSelectedCardId);
  const [openedCardIds, setOpenedCardIds] = useState<string[]>(
    initialSelectedCardId ? [initialSelectedCardId] : [],
  );
  const [selectedDetail, setSelectedDetail] = useState<CardDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | undefined>();
  const [phase, setPhase] = useState<BoardPhase>(initialItems.length > 0 ? 'READY' : 'LOADING');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [pharmacistHandoffs, setPharmacistHandoffs] = useState<HandoffView[]>([]);
  const [returnedHandoffs, setReturnedHandoffs] = useState<HandoffView[]>([]);
  const [handoffError, setHandoffError] = useState<string | undefined>();
  const [reportDeliveries, setReportDeliveries] = useState<ReportDeliveryView[]>([]);
  const [reportDeliveryError, setReportDeliveryError] = useState<string | undefined>();
  const [submittingReportDeliveryId, setSubmittingReportDeliveryId] = useState<
    string | undefined
  >();
  const [pendingEvidenceByPacket, setPendingEvidenceByPacket] = useState<
    Record<string, EvidencePendingView[]>
  >({});
  const [toasts, setToasts] = useState<PhosToastEntry[]>([]);
  const [capacity, setCapacity] = useState<CapacityResponse | undefined>();
  const [capacityPhase, setCapacityPhase] = useState<CapacityPhase>('LOADING');
  const [capacityError, setCapacityError] = useState<string | undefined>();
  const urlSyncReady = useRef(false);
  const lastAppliedInitialSelectedCardId = useRef<string | undefined>(undefined);
  const effectiveGetAccessToken = useMemo(() => {
    if (getAccessToken) return getAccessToken;
    if (!phosAccessToken) return undefined;
    return () => phosAccessToken;
  }, [getAccessToken, phosAccessToken]);
  const configurationError =
    !client && initialItems.length === 0 && (!apiBaseUrl || !effectiveGetAccessToken)
      ? !apiBaseUrl
        ? 'PH-OS API Gateway base URL is not configured.'
        : 'PH-OS access token provider is not configured.'
      : undefined;
  const displayPhase: BoardPhase = configurationError ? 'ERROR' : phase;
  const displayErrorMessage = configurationError ?? errorMessage;

  const apiClient = useMemo(() => {
    if (client) return client;
    if (!apiBaseUrl || !effectiveGetAccessToken) return undefined;
    return createPhosApiClient({ baseUrl: apiBaseUrl, getAccessToken: effectiveGetAccessToken });
  }, [apiBaseUrl, client, effectiveGetAccessToken]);

  const action = usePhosAction(
    apiClient ?? {
      executeCardAction: async () => {
        throw new Error('PH-OS API client is not configured');
      },
    },
    {
      offlineQueue: offlineActionQueue ?? { enqueueCardAction: enqueuePhosOfflineCardAction },
    },
  );

  const enqueueToast = useCallback((toast: PhosToastInput) => {
    setToasts((current) => appendPhosToast(current, toast, Date.now()));
  }, []);

  useEffect(() => {
    if (initialSelectedCardId) {
      urlSyncReady.current = true;
      if (lastAppliedInitialSelectedCardId.current !== initialSelectedCardId) {
        lastAppliedInitialSelectedCardId.current = initialSelectedCardId;
        setSelectedDetail(null);
        setDetailError(undefined);
        setSelectedCardId(initialSelectedCardId);
        setOpenedCardIds((current) =>
          current.includes(initialSelectedCardId) ? current : [...current, initialSelectedCardId],
        );
      }
      syncCardIdToUrl(initialSelectedCardId);
      return;
    }
    lastAppliedInitialSelectedCardId.current = undefined;
    const cardId = readCardIdFromUrl();
    if (!cardId) {
      urlSyncReady.current = true;
      return;
    }
    setSelectedDetail(null);
    setDetailError(undefined);
    setSelectedCardId(cardId);
    setOpenedCardIds((current) => (current.includes(cardId) ? current : [...current, cardId]));
    window.setTimeout(() => {
      urlSyncReady.current = true;
      syncCardIdToUrl(cardId);
    }, 0);
  }, [initialSelectedCardId]);

  useEffect(() => {
    if (!urlSyncReady.current) return;
    syncCardIdToUrl(selectedCardId);
  }, [selectedCardId]);

  useEffect(() => {
    if (initialItems.length > 0) return;
    if (!apiClient) return;

    let active = true;
    setPhase('LOADING');

    void apiClient
      .getCards({
        ...(searchQuery ? { query: searchQuery } : {}),
        ...(quickFilter !== BoardQuickFilter.ALL ? { filter: quickFilter } : {}),
        sort: sortKey,
      })
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setPhase('READY');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPhase('ERROR');
        setErrorMessage(error instanceof Error ? error.message : 'PH-OS board load failed.');
      });

    return () => {
      active = false;
    };
  }, [apiClient, initialItems.length, quickFilter, searchQuery, sortKey]);

  useEffect(() => {
    if (!apiClient) return;

    let active = true;
    void Promise.all([
      apiClient.getHandoffs({ status: HandoffStatus.OPEN, assignee: 'ME' }),
      apiClient.getHandoffs({ status: HandoffStatus.RETURNED, assignee: 'ME' }),
    ])
      .then(([openResponse, returnedResponse]) => {
        if (!active) return;
        setPharmacistHandoffs(openResponse.items);
        setReturnedHandoffs(returnedResponse.items);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setHandoffError(error instanceof Error ? error.message : 'PH-OS handoff load failed.');
      });

    return () => {
      active = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (!apiClient) return;

    let active = true;
    void Promise.all([
      apiClient.getReportDeliveries({ status: ReportDeliveryStatus.WAITING_REPLY }),
      apiClient.getReportDeliveries({ status: ReportDeliveryStatus.ACTION_REQUIRED }),
    ])
      .then(([waitingResponse, actionRequiredResponse]) => {
        if (!active) return;
        setReportDeliveries([...waitingResponse.items, ...actionRequiredResponse.items]);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReportDeliveryError(
          error instanceof Error ? error.message : 'PH-OS report delivery load failed.',
        );
      });

    return () => {
      active = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (!apiClient || !canViewCapacity) {
      return;
    }

    let active = true;
    void apiClient
      .getCapacity({ date: dateKey(new Date()), scope: CapacityScope.PHARMACY })
      .then((response) => {
        if (!active) return;
        setCapacity(response);
        setCapacityPhase('IDLE');
        setCapacityError(undefined);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCapacity(undefined);
        setCapacityPhase('ERROR');
        setCapacityError(error instanceof Error ? error.message : 'PH-OS capacity load failed.');
      });

    return () => {
      active = false;
    };
  }, [apiClient, canViewCapacity]);

  useEffect(() => {
    if (!selectedCardId || !apiClient) return;

    let active = true;
    void apiClient
      .getCardDetail(selectedCardId)
      .then((detail) => {
        if (!active) return;
        setSelectedDetail(detail);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDetailError(error instanceof Error ? error.message : 'PH-OS card detail load failed.');
      });

    return () => {
      active = false;
    };
  }, [apiClient, selectedCardId]);

  useEffect(() => {
    const visit = selectedDetail?.visit_mode;
    if (!visit) return;
    const packetId = visit.packet_id;
    const visitOnline = visit.online;

    let active = true;

    async function loadPendingEvidence() {
      try {
        if (visitOnline && apiClient) {
          await offlineEvidenceQueue.retryUploads({ client: apiClient });
        }
        const pendingEvidence = await offlineEvidenceQueue.listPendingEvidence(packetId);
        if (!active) return;
        setPendingEvidenceByPacket((current) => ({
          ...current,
          [packetId]: pendingEvidence,
        }));
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error
            ? error.message
            : '同期待ち証跡を読み込めません。再試行してください。';
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    }

    void loadPendingEvidence();

    return () => {
      active = false;
    };
  }, [
    apiClient,
    enqueueToast,
    offlineEvidenceQueue,
    selectedDetail?.visit_mode,
    selectedDetail?.visit_mode?.online,
    selectedDetail?.visit_mode?.packet_id,
    selectedDetail?.visit_mode?.server_version,
  ]);

  const handlePrimaryAction = useCallback(
    async (cardId: string, actionCode: ActionCode, reason?: ActionReasonInput) => {
      const item = items.find((candidate) => candidate.card.card_id === cardId);
      if (!item || action.phase === ActionPhase.SUBMITTING) return;
      const activeDetail = selectedDetail?.card.card_id === cardId ? selectedDetail : undefined;
      const activeNextAction = activeDetail?.next_action ?? item.next_action;
      const detailVersion = activeDetail?.server_version;
      const reasonCode = reason?.reason_code.trim();
      const reasonNote = reason?.reason_note?.trim();

      if (activeNextAction.reason_required && !reasonCode) {
        setSelectedDetail(null);
        setDetailError(undefined);
        setSelectedCardId(cardId);
        setActionError('理由を選択してください。');
        return;
      }

      setActionError(undefined);
      try {
        const response = await action.execute(
          cardId,
          {
            action_code: actionCode,
            idempotency_key: buildIdempotencyKey(cardId, actionCode),
            client_version: detailVersion ?? item.card.server_version,
            ...(reasonCode ? { reason_code: reasonCode } : {}),
            ...(reasonNote ? { reason_note: reasonNote } : {}),
          },
          {
            offline_allowed: activeNextAction.offline_allowed,
            offline_op_class: 'BLOCKING',
          },
        );
        setItems((current) => updateBoardItem(current, response));
        setSelectedDetail((current) =>
          current && current.card.card_id === response.card.card_id
            ? updateDetailFromAction(current, response)
            : current,
        );
        if (response.toast) enqueueToast(response.toast);
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action, enqueueToast, items, selectedDetail],
  );

  const handleOpenCard = useCallback((cardId: string) => {
    setSelectedDetail(null);
    setDetailError(undefined);
    setSelectedCardId(cardId);
    setOpenedCardIds((current) => (current.includes(cardId) ? current : [...current, cardId]));
  }, []);

  const handleCreateHandoff = useCallback(
    async (cardId: string, input: HandoffCreateInput) => {
      if (!apiClient || action.phase === ActionPhase.SUBMITTING) return;
      const detail = selectedDetail?.card.card_id === cardId ? selectedDetail : null;
      if (!detail) return;

      setActionError(undefined);
      try {
        const response = await apiClient.createHandoff({
          card_id: cardId,
          reason_code: input.reason_code,
          summary: input.summary,
          source_refs: detail.source_refs,
          urgency: input.urgency,
          requested_action: input.requested_action,
          related_blocker_code: detail.blockers.find((blocker) => blocker.active)?.blocker_code,
          idempotency_key: buildHandoffIdempotencyKey(cardId, 'CREATE_HANDOFF'),
          client_version: detail.server_version,
        });
        setSelectedDetail((current) =>
          current ? updateDetailHandoff(current, response.handoff) : current,
        );
        setPharmacistHandoffs((current) => upsertHandoff(current, response.handoff));
        if (response.toast) enqueueToast(response.toast);
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action.phase, apiClient, enqueueToast, selectedDetail],
  );

  const handleOpenHandoffReview = useCallback(
    async (handoffId: string) => {
      if (!apiClient || action.phase === ActionPhase.SUBMITTING) return;
      const handoff =
        selectedDetail?.handoffs?.find((candidate) => candidate.handoff_id === handoffId) ??
        pharmacistHandoffs.find((candidate) => candidate.handoff_id === handoffId);
      if (!handoff) return;

      setActionError(undefined);
      try {
        const response = await apiClient.openHandoff(handoffId, {
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'OPEN_HANDOFF'),
          client_version: handoff.server_version,
        });
        setSelectedDetail((current) =>
          current ? updateDetailHandoff(current, response.handoff) : current,
        );
        setPharmacistHandoffs((current) => upsertHandoff(current, response.handoff));
        if (response.toast) enqueueToast(response.toast);
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action.phase, apiClient, enqueueToast, pharmacistHandoffs, selectedDetail],
  );

  const handleResolveHandoff = useCallback(
    async (handoffId: string, resolvedActionCode: ActionCode) => {
      if (!apiClient || action.phase === ActionPhase.SUBMITTING) return;
      const handoff = selectedDetail?.handoffs?.find(
        (candidate) => candidate.handoff_id === handoffId,
      );
      if (!handoff) return;

      setActionError(undefined);
      try {
        const response = await apiClient.resolveHandoff(handoffId, {
          resolved_action_code: resolvedActionCode,
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'RESOLVE_HANDOFF'),
          client_version: handoff.server_version,
        });
        setSelectedDetail((current) =>
          current ? updateDetailHandoff(current, response.handoff) : current,
        );
        setPharmacistHandoffs((current) => removeHandoff(current, handoffId));
        setReturnedHandoffs((current) => removeHandoff(current, handoffId));
        if (response.toast) enqueueToast(response.toast);
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action.phase, apiClient, enqueueToast, selectedDetail],
  );

  const handleReturnHandoff = useCallback(
    async (handoffId: string, reasonCode: string, note: string) => {
      if (!apiClient || action.phase === ActionPhase.SUBMITTING) return;
      const handoff = selectedDetail?.handoffs?.find(
        (candidate) => candidate.handoff_id === handoffId,
      );
      if (!handoff) return;

      setActionError(undefined);
      try {
        const response = await apiClient.returnHandoff(handoffId, {
          return_reason_code: reasonCode,
          return_note: note,
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'RETURN_HANDOFF'),
          client_version: handoff.server_version,
        });
        setSelectedDetail((current) =>
          current ? updateDetailHandoff(current, response.handoff) : current,
        );
        setPharmacistHandoffs((current) => removeHandoff(current, handoffId));
        setReturnedHandoffs((current) => upsertHandoff(current, response.handoff));
        if (response.toast) enqueueToast(response.toast);
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action.phase, apiClient, enqueueToast, selectedDetail],
  );

  const handleVisitArrivalOutcome = useCallback(
    async (outcome: VisitArrivalOutcome, reason?: string) => {
      if (!apiClient || action.phase === ActionPhase.SUBMITTING) return;
      const visit = selectedDetail?.visit_mode;
      if (!visit) return;

      setActionError(undefined);
      try {
        const response = await apiClient.updateVisitStep(
          visit.packet_id,
          VisitStep.ARRIVAL_CONFIRM,
          {
            idempotency_key: buildVisitIdempotencyKey(visit.packet_id, 'ARRIVAL_CONFIRM'),
            client_version: visit.server_version,
            payload: {
              arrival_outcome: outcome,
              ...(reason ? { reason_note: reason } : {}),
            },
          },
        );
        setSelectedDetail((current) =>
          current ? updateDetailVisitMode(current, response) : current,
        );
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action.phase, apiClient, enqueueToast, selectedDetail],
  );

  const handleOpenVisitStep = useCallback(
    async (step: VisitStep) => {
      if (!apiClient || action.phase === ActionPhase.SUBMITTING) return;
      const visit = selectedDetail?.visit_mode;
      if (!visit) return;

      setActionError(undefined);
      try {
        const response = await apiClient.updateVisitStep(visit.packet_id, step, {
          idempotency_key: buildVisitIdempotencyKey(visit.packet_id, step),
          client_version: visit.server_version,
        });
        setSelectedDetail((current) =>
          current ? updateDetailVisitMode(current, response) : current,
        );
      } catch (error) {
        const message = actionErrorMessage(error);
        setActionError(message);
        enqueueToast(errorToast(message));
      }
    },
    [action.phase, apiClient, enqueueToast, selectedDetail],
  );

  const handleCompleteVisit = useCallback(async () => {
    await handleOpenVisitStep(VisitStep.COMPLETE_CHECK);
  }, [handleOpenVisitStep]);

  const handleRegisterReportReply = useCallback(
    async (delivery: ReportDeliveryView, input: ReportDeliveryReplyInput) => {
      if (!apiClient || submittingReportDeliveryId) return;

      setReportDeliveryError(undefined);
      setSubmittingReportDeliveryId(delivery.delivery_id);
      try {
        const response = await apiClient.registerReportReply(delivery.delivery_id, {
          ...input,
          idempotency_key: buildReportDeliveryIdempotencyKey(
            delivery.delivery_id,
            'REGISTER_REPORT_REPLY',
          ),
          client_version: delivery.server_version,
        });
        setReportDeliveries((current) => upsertActiveReportDelivery(current, response.delivery));
      } catch (error) {
        const message = actionErrorMessage(error);
        setReportDeliveryError(message);
        enqueueToast(errorToast(message));
      } finally {
        setSubmittingReportDeliveryId(undefined);
      }
    },
    [apiClient, enqueueToast, submittingReportDeliveryId],
  );

  const handleMarkReportActionDone = useCallback(
    async (delivery: ReportDeliveryView, input: ReportDeliveryActionDoneInput) => {
      if (!apiClient || submittingReportDeliveryId) return;

      setReportDeliveryError(undefined);
      setSubmittingReportDeliveryId(delivery.delivery_id);
      try {
        const response = await apiClient.markReportActionDone(delivery.delivery_id, {
          ...input,
          idempotency_key: buildReportDeliveryIdempotencyKey(
            delivery.delivery_id,
            'MARK_REPORT_ACTION_DONE',
          ),
          client_version: delivery.server_version,
        });
        setReportDeliveries((current) => upsertActiveReportDelivery(current, response.delivery));
      } catch (error) {
        const message = actionErrorMessage(error);
        setReportDeliveryError(message);
        enqueueToast(errorToast(message));
      } finally {
        setSubmittingReportDeliveryId(undefined);
      }
    },
    [apiClient, enqueueToast, submittingReportDeliveryId],
  );

  const handleWorkspaceOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) return;
      const cardId = selectedCardId;
      setSelectedCardId(undefined);
      setSelectedDetail(null);
      setDetailError(undefined);
      if (!cardId) return;
      window.setTimeout(() => {
        focusSourceCardOrBoard(cardId);
      }, 0);
    },
    [selectedCardId],
  );

  const activeDetail =
    selectedDetail && selectedDetail.card.card_id === selectedCardId ? selectedDetail : null;
  const openedCards = useMemo(
    () =>
      openedCardIds.map((cardId) => {
        const item = items.find((candidate) => candidate.card.card_id === cardId);
        const label =
          activeDetail?.card.card_id === cardId
            ? activeDetail.card.patient_name
            : (item?.card.patient_name ?? cardId);
        return { card_id: cardId, label };
      }),
    [activeDetail, items, openedCardIds],
  );
  const activePendingEvidence = activeDetail?.visit_mode
    ? (pendingEvidenceByPacket[activeDetail.visit_mode.packet_id] ?? [])
    : [];
  const today = useMemo(() => dateKey(new Date()), []);
  const isServerFilteredBoard = initialItems.length === 0 && Boolean(apiClient);
  const counts = useMemo(
    () => countBoardFilters(items, currentUserName, today),
    [currentUserName, items, today],
  );
  const visibleItems = useMemo(
    () =>
      selectBoardItems(items, {
        quickFilter,
        triageLane,
        currentUserName,
        query: searchQuery,
        sortKey,
        todayKey: today,
        serverFiltered: isServerFilteredBoard,
      }),
    [
      currentUserName,
      isServerFilteredBoard,
      items,
      quickFilter,
      searchQuery,
      sortKey,
      today,
      triageLane,
    ],
  );
  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setSortKey(BoardSortKey.VISIT_TIME);
    setQuickFilter(BoardQuickFilter.ALL);
    setTriageLane(undefined);
  }, []);

  return (
    <div className="space-y-4">
      <PhosToastRegion toasts={toasts} />
      <div
        className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        style={displayPhase === 'ERROR' ? warningFeedbackStyle : undefined}
      >
        <div className="flex items-center gap-2 font-medium text-foreground">
          {displayPhase === 'LOADING' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : displayPhase === 'ERROR' ? (
            <AlertTriangle className="size-4" aria-hidden="true" />
          ) : null}
          <span>
            {displayPhase === 'LOADING'
              ? 'カードを読み込み中'
              : displayPhase === 'ERROR'
                ? 'カードを読み込めません'
                : 'カード一覧'}
          </span>
        </div>
        {action.phase !== ActionPhase.IDLE ? (
          <p className="text-muted-foreground">操作状態: {action.phase}</p>
        ) : null}
      </div>

      {actionError ? (
        <div className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {actionError}
        </div>
      ) : null}
      {handoffError ? (
        <div className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {handoffError}
        </div>
      ) : null}
      {reportDeliveryError ? (
        <div className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {reportDeliveryError}
        </div>
      ) : null}

      {displayPhase === 'ERROR' ? (
        <div className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {displayErrorMessage}
        </div>
      ) : (
        <>
          <HandoffQueue
            handoffs={pharmacistHandoffs}
            onOpenCard={handleOpenCard}
            onOpenReview={handleOpenHandoffReview}
          />
          <ClerkSupportWorkbench handoffs={returnedHandoffs} onOpenCard={handleOpenCard} />
          <ReportDeliveryQueue
            deliveries={reportDeliveries}
            onOpenCard={handleOpenCard}
            onRegisterReply={handleRegisterReportReply}
            onMarkActionDone={handleMarkReportActionDone}
            submittingDeliveryId={submittingReportDeliveryId}
          />
          <CardBoard
            items={visibleItems}
            totalItemCount={items.length}
            phase={displayPhase === 'LOADING' ? 'LOADING' : 'READY'}
            selectedCardId={selectedCardId}
            density={density}
            searchQuery={searchQuery}
            sortKey={sortKey}
            quickFilter={quickFilter}
            triageLane={triageLane}
            counts={counts}
            capacity={canViewCapacity ? capacity : undefined}
            capacityPhase={canViewCapacity ? capacityPhase : 'IDLE'}
            capacityError={capacityError}
            onSearchQueryChange={setSearchQuery}
            onSortChange={setSortKey}
            onDensityChange={setDensity}
            onQuickFilterChange={setQuickFilter}
            onTriageLaneChange={setTriageLane}
            onResetFilters={resetFilters}
            onOpen={handleOpenCard}
            onPrimaryAction={handlePrimaryAction}
          />
        </>
      )}

      <WorkspaceOverlay
        detail={activeDetail}
        open={Boolean(selectedCardId)}
        openedCards={openedCards}
        activeCardId={selectedCardId}
        detailError={detailError}
        actionPhase={action.phase === ActionPhase.IDLE ? undefined : action.phase}
        actionMessage={actionError}
        pendingEvidence={activePendingEvidence}
        onOpenChange={handleWorkspaceOpenChange}
        onSelectOpenedCard={handleOpenCard}
        onExecute={handlePrimaryAction}
        onCreateHandoff={handleCreateHandoff}
        onOpenHandoffReview={handleOpenHandoffReview}
        onResolveHandoff={handleResolveHandoff}
        onReturnHandoff={handleReturnHandoff}
        onVisitArrivalOutcome={handleVisitArrivalOutcome}
        onOpenVisitStep={handleOpenVisitStep}
        onCompleteVisit={handleCompleteVisit}
      />
    </div>
  );
}
