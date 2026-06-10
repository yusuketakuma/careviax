'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionCode, HandoffStatus, type HandoffView } from '@/phos/contracts/phos_contracts';
import { createPhosApiClient, isSameOriginPhosProxyBaseUrl } from '@/phos/api/client';
import type { PhosApiClient } from '@/phos/api/types';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import { HandoffQueue } from './HandoffQueue';

export type HandoffsPageClientProps = {
  apiBaseUrl?: string;
  client?: PhosApiClient;
  getAccessToken?: () => string | Promise<string>;
};

type HandoffsPhase = 'LOADING' | 'READY' | 'ERROR';

function buildHandoffIdempotencyKey(handoffId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${handoffId}-${operation}-${suffix}`;
}

function upsertHandoff(items: HandoffView[], next: HandoffView): HandoffView[] {
  const existing = items.some((item) => item.handoff_id === next.handoff_id);
  if (!existing) return [next, ...items];
  return items.map((item) => (item.handoff_id === next.handoff_id ? next : item));
}

function removeHandoff(items: HandoffView[], handoffId: string): HandoffView[] {
  return items.filter((item) => item.handoff_id !== handoffId);
}

function actionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'PH-OS handoff action failed.';
}

export function HandoffsPageClient({
  apiBaseUrl,
  client,
  getAccessToken,
}: HandoffsPageClientProps) {
  const router = useRouter();
  const configurationError =
    !client && !apiBaseUrl
      ? 'PH-OS API Gateway base URL is not configured.'
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
  const [handoffs, setHandoffs] = useState<HandoffView[]>([]);
  const [phase, setPhase] = useState<HandoffsPhase>(apiClient ? 'LOADING' : 'ERROR');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(configurationError);
  const [submittingHandoffId, setSubmittingHandoffId] = useState<string | undefined>();

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
      apiClient.getHandoffs({ status: HandoffStatus.OPEN, assignee: 'ME' }),
      apiClient.getHandoffs({ status: HandoffStatus.IN_REVIEW, assignee: 'ME' }),
    ])
      .then(([openResponse, inReviewResponse]) => {
        if (!active) return;
        setHandoffs([...openResponse.items, ...inReviewResponse.items]);
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

  const handleOpenReview = useCallback(
    async (handoffId: string) => {
      if (!apiClient || submittingHandoffId) return;
      const handoff = handoffs.find((candidate) => candidate.handoff_id === handoffId);
      if (!handoff) return;

      setSubmittingHandoffId(handoffId);
      setErrorMessage(undefined);
      try {
        const response = await apiClient.openHandoff(handoffId, {
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'OPEN_HANDOFF'),
          client_version: handoff.server_version,
        });
        setHandoffs((current) => upsertHandoff(current, response.handoff));
      } catch (error) {
        setErrorMessage(actionErrorMessage(error));
      } finally {
        setSubmittingHandoffId(undefined);
      }
    },
    [apiClient, handoffs, submittingHandoffId],
  );

  const handleResolve = useCallback(
    async (handoffId: string, resolvedActionCode: ActionCode) => {
      if (!apiClient || submittingHandoffId) return;
      const handoff = handoffs.find((candidate) => candidate.handoff_id === handoffId);
      if (!handoff) return;

      setSubmittingHandoffId(handoffId);
      setErrorMessage(undefined);
      try {
        await apiClient.resolveHandoff(handoffId, {
          resolved_action_code: resolvedActionCode,
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'RESOLVE_HANDOFF'),
          client_version: handoff.server_version,
        });
        setHandoffs((current) => removeHandoff(current, handoffId));
      } catch (error) {
        setErrorMessage(actionErrorMessage(error));
      } finally {
        setSubmittingHandoffId(undefined);
      }
    },
    [apiClient, handoffs, submittingHandoffId],
  );

  const handleReturn = useCallback(
    async (handoffId: string, reasonCode: string, note: string) => {
      if (!apiClient || submittingHandoffId) return;
      const handoff = handoffs.find((candidate) => candidate.handoff_id === handoffId);
      if (!handoff) return;

      setSubmittingHandoffId(handoffId);
      setErrorMessage(undefined);
      try {
        await apiClient.returnHandoff(handoffId, {
          return_reason_code: reasonCode,
          return_note: note,
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'RETURN_HANDOFF'),
          client_version: handoff.server_version,
        });
        setHandoffs((current) => removeHandoff(current, handoffId));
      } catch (error) {
        setErrorMessage(actionErrorMessage(error));
      } finally {
        setSubmittingHandoffId(undefined);
      }
    },
    [apiClient, handoffs, submittingHandoffId],
  );

  return (
    <div className="space-y-4">
      {phase === 'LOADING' ? (
        <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">確認依頼を読み込み中</p>
        </section>
      ) : null}
      {errorMessage ? (
        <section className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {errorMessage}
        </section>
      ) : null}
      <HandoffQueue
        handoffs={handoffs}
        onOpenCard={handleOpenCard}
        onOpenReview={handleOpenReview}
        onResolve={handleResolve}
        onReturn={handleReturn}
      />
    </div>
  );
}
