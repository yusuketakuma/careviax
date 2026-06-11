'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPhosApiClient, isSameOriginPhosProxyBaseUrl } from '@/phos/api/client';
import type { PhosApiClient } from '@/phos/api/types';
import {
  ReportDeliveryStatus,
  type ReportDeliveryMutationResponse,
  type ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import { PhosReportsPageCopy } from '@/phos/contracts/phos_copy.ja';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import {
  ReportDeliveryQueue,
  type ReportDeliveryActionDoneInput,
  type ReportDeliveryReplyInput,
} from './ReportDeliveryQueue';

export type ReportsPageClientProps = {
  apiBaseUrl?: string;
  client?: PhosApiClient;
  getAccessToken?: () => string | Promise<string>;
};

type ReportsPagePhase = 'LOADING' | 'READY' | 'ERROR';
type ReportsLoadState = {
  key: string;
  phase: Exclude<ReportsPagePhase, 'LOADING'>;
  errorMessage?: string;
};

function buildReportDeliveryIdempotencyKey(deliveryId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${deliveryId}-${operation}-${suffix}`;
}

function upsertActiveReportDelivery(
  items: ReportDeliveryView[],
  response: ReportDeliveryMutationResponse,
): ReportDeliveryView[] {
  const next = response.delivery;
  const active =
    next.status === ReportDeliveryStatus.WAITING_REPLY ||
    next.status === ReportDeliveryStatus.ACTION_REQUIRED;
  if (!active) return items.filter((item) => item.delivery_id !== next.delivery_id);
  const exists = items.some((item) => item.delivery_id === next.delivery_id);
  if (!exists) return [next, ...items];
  return items.map((item) => (item.delivery_id === next.delivery_id ? next : item));
}

function actionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : PhosReportsPageCopy.ACTION_FAILED;
}

export function ReportsPageClient({ apiBaseUrl, client, getAccessToken }: ReportsPageClientProps) {
  const router = useRouter();
  const configurationError =
    !client && !apiBaseUrl
      ? PhosReportsPageCopy.API_BASE_URL_MISSING
      : !client &&
          apiBaseUrl &&
          !getAccessToken &&
          !isSameOriginPhosProxyBaseUrl(apiBaseUrl.trim().replace(/\/+$/, ''))
        ? 'PH-OS access token provider is not configured.'
        : undefined;
  const apiClient = useMemo(() => {
    if (client) return client;
    if (configurationError) return undefined;
    if (!apiBaseUrl) return undefined;
    return createPhosApiClient({ baseUrl: apiBaseUrl, getAccessToken });
  }, [apiBaseUrl, client, configurationError, getAccessToken]);
  const [deliveries, setDeliveries] = useState<ReportDeliveryView[]>([]);
  const requestKey = apiClient ? 'reports:waiting-action-required' : 'unconfigured';
  const [loadState, setLoadState] = useState<ReportsLoadState>({
    key: 'unconfigured',
    phase: 'ERROR',
    errorMessage: configurationError,
  });
  const phase: ReportsPagePhase = configurationError
    ? 'ERROR'
    : loadState.key === requestKey
      ? loadState.phase
      : 'LOADING';
  const errorMessage = configurationError ?? loadState.errorMessage;
  const [submittingDeliveryId, setSubmittingDeliveryId] = useState<string | undefined>();

  useEffect(() => {
    if (!apiClient) return;

    let active = true;

    void Promise.all([
      apiClient.getReportDeliveries({ status: ReportDeliveryStatus.WAITING_REPLY }),
      apiClient.getReportDeliveries({ status: ReportDeliveryStatus.ACTION_REQUIRED }),
    ])
      .then(([waitingResponse, actionRequiredResponse]) => {
        if (!active) return;
        setDeliveries([...waitingResponse.items, ...actionRequiredResponse.items]);
        setLoadState({ key: requestKey, phase: 'READY' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadState({
          key: requestKey,
          phase: 'ERROR',
          errorMessage: actionErrorMessage(error),
        });
      });

    return () => {
      active = false;
    };
  }, [apiClient, requestKey]);

  const handleOpenCard = useCallback(
    (cardId: string) => {
      router.push(`/board?card=${encodeURIComponent(cardId)}`);
    },
    [router],
  );

  const handleRegisterReply = useCallback(
    async (delivery: ReportDeliveryView, input: ReportDeliveryReplyInput) => {
      if (!apiClient || submittingDeliveryId) return;

      setSubmittingDeliveryId(delivery.delivery_id);
      setLoadState((current) => ({ ...current, errorMessage: undefined }));
      try {
        const response = await apiClient.registerReportReply(delivery.delivery_id, {
          ...input,
          idempotency_key: buildReportDeliveryIdempotencyKey(
            delivery.delivery_id,
            'REGISTER_REPORT_REPLY',
          ),
          client_version: delivery.server_version,
        });
        setDeliveries((current) => upsertActiveReportDelivery(current, response));
      } catch (error) {
        setLoadState((current) => ({ ...current, errorMessage: actionErrorMessage(error) }));
      } finally {
        setSubmittingDeliveryId(undefined);
      }
    },
    [apiClient, submittingDeliveryId],
  );

  const handleMarkActionDone = useCallback(
    async (delivery: ReportDeliveryView, input: ReportDeliveryActionDoneInput) => {
      if (!apiClient || submittingDeliveryId) return;

      setSubmittingDeliveryId(delivery.delivery_id);
      setLoadState((current) => ({ ...current, errorMessage: undefined }));
      try {
        const response = await apiClient.markReportActionDone(delivery.delivery_id, {
          ...input,
          idempotency_key: buildReportDeliveryIdempotencyKey(
            delivery.delivery_id,
            'MARK_REPORT_ACTION_DONE',
          ),
          client_version: delivery.server_version,
        });
        setDeliveries((current) => upsertActiveReportDelivery(current, response));
      } catch (error) {
        setLoadState((current) => ({ ...current, errorMessage: actionErrorMessage(error) }));
      } finally {
        setSubmittingDeliveryId(undefined);
      }
    },
    [apiClient, submittingDeliveryId],
  );

  return (
    <div className="space-y-4">
      {phase === 'LOADING' ? (
        <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">{PhosReportsPageCopy.LOADING}</p>
        </section>
      ) : null}
      {errorMessage ? (
        <section className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {errorMessage}
        </section>
      ) : null}
      <ReportDeliveryQueue
        deliveries={deliveries}
        onOpenCard={handleOpenCard}
        onRegisterReply={handleRegisterReply}
        onMarkActionDone={handleMarkActionDone}
        submittingDeliveryId={submittingDeliveryId}
      />
    </div>
  );
}
