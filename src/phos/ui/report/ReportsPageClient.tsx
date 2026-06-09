'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { createPhosApiClient } from '@/phos/api/client';
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
  const { data: session } = useSession();
  const phosAccessToken = session?.phosAccessToken;
  const effectiveGetAccessToken = useMemo(() => {
    if (getAccessToken) return getAccessToken;
    if (!phosAccessToken) return undefined;
    return () => phosAccessToken;
  }, [getAccessToken, phosAccessToken]);
  const apiClient = useMemo(() => {
    if (client) return client;
    if (!apiBaseUrl || !effectiveGetAccessToken) return undefined;
    return createPhosApiClient({ baseUrl: apiBaseUrl, getAccessToken: effectiveGetAccessToken });
  }, [apiBaseUrl, client, effectiveGetAccessToken]);
  const configurationError =
    !apiClient && (!apiBaseUrl || !effectiveGetAccessToken)
      ? !apiBaseUrl
        ? PhosReportsPageCopy.API_BASE_URL_MISSING
        : PhosReportsPageCopy.ACCESS_TOKEN_MISSING
      : undefined;
  const [deliveries, setDeliveries] = useState<ReportDeliveryView[]>([]);
  const [phase, setPhase] = useState<ReportsPagePhase>(apiClient ? 'LOADING' : 'ERROR');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(configurationError);
  const [submittingDeliveryId, setSubmittingDeliveryId] = useState<string | undefined>();

  useEffect(() => {
    if (!apiClient) {
      setPhase('ERROR');
      setErrorMessage(configurationError);
      return;
    }

    let active = true;
    setPhase('LOADING');
    setErrorMessage(undefined);

    void Promise.all([
      apiClient.getReportDeliveries({ status: ReportDeliveryStatus.WAITING_REPLY }),
      apiClient.getReportDeliveries({ status: ReportDeliveryStatus.ACTION_REQUIRED }),
    ])
      .then(([waitingResponse, actionRequiredResponse]) => {
        if (!active) return;
        setDeliveries([...waitingResponse.items, ...actionRequiredResponse.items]);
        setPhase('READY');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPhase('ERROR');
        setErrorMessage(actionErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, [apiClient, configurationError]);

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
      setErrorMessage(undefined);
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
        setErrorMessage(actionErrorMessage(error));
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
      setErrorMessage(undefined);
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
        setErrorMessage(actionErrorMessage(error));
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
