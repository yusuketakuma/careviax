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
type HandoffsLoadState = {
  key: string;
  phase: Exclude<HandoffsPhase, 'LOADING'>;
  errorMessage?: string;
};

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
  const requestKey = apiClient ? 'handoffs:me:open-in-review' : 'unconfigured';
  const [loadState, setLoadState] = useState<HandoffsLoadState>({
    key: 'unconfigured',
    phase: 'ERROR',
    errorMessage: configurationError,
  });
  const phase: HandoffsPhase = configurationError
    ? 'ERROR'
    : loadState.key === requestKey
      ? loadState.phase
      : 'LOADING';
  const errorMessage = configurationError ?? loadState.errorMessage;
  const [submittingHandoffId, setSubmittingHandoffId] = useState<string | undefined>();

  useEffect(() => {
    if (!apiClient) return;

    let active = true;

    void Promise.all([
      apiClient.getHandoffs({ status: HandoffStatus.OPEN, assignee: 'ME' }),
      apiClient.getHandoffs({ status: HandoffStatus.IN_REVIEW, assignee: 'ME' }),
    ])
      .then(([openResponse, inReviewResponse]) => {
        if (!active) return;
        setHandoffs([...openResponse.items, ...inReviewResponse.items]);
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

  const handleOpenReview = useCallback(
    async (handoffId: string) => {
      if (!apiClient || submittingHandoffId) return;
      const handoff = handoffs.find((candidate) => candidate.handoff_id === handoffId);
      if (!handoff) return;

      setSubmittingHandoffId(handoffId);
      setLoadState((current) => ({ ...current, errorMessage: undefined }));
      try {
        const response = await apiClient.openHandoff(handoffId, {
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'OPEN_HANDOFF'),
          client_version: handoff.server_version,
        });
        setHandoffs((current) => upsertHandoff(current, response.handoff));
      } catch (error) {
        setLoadState((current) => ({ ...current, errorMessage: actionErrorMessage(error) }));
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
      setLoadState((current) => ({ ...current, errorMessage: undefined }));
      try {
        await apiClient.resolveHandoff(handoffId, {
          resolved_action_code: resolvedActionCode,
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'RESOLVE_HANDOFF'),
          client_version: handoff.server_version,
        });
        setHandoffs((current) => removeHandoff(current, handoffId));
      } catch (error) {
        setLoadState((current) => ({ ...current, errorMessage: actionErrorMessage(error) }));
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
      setLoadState((current) => ({ ...current, errorMessage: undefined }));
      try {
        await apiClient.returnHandoff(handoffId, {
          return_reason_code: reasonCode,
          return_note: note,
          idempotency_key: buildHandoffIdempotencyKey(handoffId, 'RETURN_HANDOFF'),
          client_version: handoff.server_version,
        });
        setHandoffs((current) => removeHandoff(current, handoffId));
      } catch (error) {
        setLoadState((current) => ({ ...current, errorMessage: actionErrorMessage(error) }));
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
