'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { createPhosApiClient } from '@/phos/api/client';
import {
  enqueuePhosOfflineEvidence,
  listPhosPendingEvidence,
  retryPhosOfflineEvidenceUploads,
} from '@/phos/api/offlineEvidenceQueue';
import type { PhosApiClient, PhosOfflineEvidenceQueue } from '@/phos/api/types';
import {
  VisitArrivalOutcome,
  VisitStep,
  type EvidencePendingView,
  type OfflineOpClass,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { PhosVisitModePageCopy } from '@/phos/contracts/phos_copy.ja';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import { VisitMode } from './VisitMode';

export type VisitModePageClientProps = {
  packetId: string;
  apiBaseUrl?: string;
  client?: PhosApiClient;
  getAccessToken?: () => string | Promise<string>;
  offlineEvidenceQueue?: PhosOfflineEvidenceQueue;
};

type VisitModePagePhase = 'LOADING' | 'READY' | 'ERROR';

const defaultOfflineEvidenceQueue: PhosOfflineEvidenceQueue = {
  enqueueEvidence: enqueuePhosOfflineEvidence,
  listPendingEvidence: listPhosPendingEvidence,
  retryUploads: retryPhosOfflineEvidenceUploads,
};

function buildVisitIdempotencyKey(packetId: string, operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${packetId}-${operation}-${suffix}`;
}

async function sha256Hex(file: Blob): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('PH-OS evidence hashing is not available in this browser.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : PhosVisitModePageCopy.ACTION_FAILED;
}

export function VisitModePageClient({
  packetId,
  apiBaseUrl,
  client,
  getAccessToken,
  offlineEvidenceQueue = defaultOfflineEvidenceQueue,
}: VisitModePageClientProps) {
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
        ? PhosVisitModePageCopy.API_BASE_URL_MISSING
        : PhosVisitModePageCopy.ACCESS_TOKEN_MISSING
      : undefined;
  const [visit, setVisit] = useState<VisitModeView | undefined>();
  const [pendingEvidence, setPendingEvidence] = useState<EvidencePendingView[]>([]);
  const [phase, setPhase] = useState<VisitModePagePhase>(apiClient ? 'LOADING' : 'ERROR');
  const [error, setError] = useState<string | undefined>(configurationError);
  const displayPhase: VisitModePagePhase = configurationError ? 'ERROR' : phase;
  const displayError = configurationError ?? error;

  const refreshPendingEvidence = useCallback(
    async (nextVisit: VisitModeView) => {
      let effectiveVisit = nextVisit;
      if (nextVisit.online && apiClient) {
        const retryResult = await offlineEvidenceQueue.retryUploads({ client: apiClient });
        effectiveVisit =
          retryResult.verified_visits.find(
            (candidate) => candidate.packet_id === nextVisit.packet_id,
          ) ?? nextVisit;
        if (effectiveVisit !== nextVisit) setVisit(effectiveVisit);
      }
      setPendingEvidence(await offlineEvidenceQueue.listPendingEvidence(effectiveVisit.packet_id));
    },
    [apiClient, offlineEvidenceQueue],
  );

  useEffect(() => {
    if (!apiClient) return;

    let active = true;

    void apiClient
      .getVisitMode(packetId)
      .then(async (response) => {
        if (!active) return;
        setVisit(response);
        await refreshPendingEvidence(response);
        if (!active) return;
        setPhase('READY');
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setPhase('ERROR');
        setError(errorMessage(loadError));
      });

    return () => {
      active = false;
    };
  }, [apiClient, packetId, refreshPendingEvidence]);

  const updateVisitStep = useCallback(
    async (
      step: VisitStep,
      payload?: Parameters<PhosApiClient['updateVisitStep']>[2]['payload'],
    ) => {
      if (!apiClient || !visit) return;
      setError(undefined);
      try {
        const response = await apiClient.updateVisitStep(visit.packet_id, step, {
          idempotency_key: buildVisitIdempotencyKey(visit.packet_id, step),
          client_version: visit.server_version,
          ...(payload ? { payload } : {}),
        });
        setVisit(response);
        await refreshPendingEvidence(response);
      } catch (updateError) {
        setError(errorMessage(updateError));
      }
    },
    [apiClient, refreshPendingEvidence, visit],
  );

  const handleArrivalOutcome = useCallback(
    (outcome: VisitArrivalOutcome, reason?: string) =>
      updateVisitStep(VisitStep.ARRIVAL_CONFIRM, {
        arrival_outcome: outcome,
        ...(reason ? { reason_note: reason } : {}),
      }),
    [updateVisitStep],
  );

  const handleSaveDraft = useCallback(
    (step: VisitStep) => {
      if (!visit?.step_completed[step] || step === VisitStep.ARRIVAL_CONFIRM) return;
      void updateVisitStep(step);
    },
    [updateVisitStep, visit],
  );

  const handleCaptureEvidence = useCallback(
    async (input: { file: File; offlineOpClass: OfflineOpClass; label: string }) => {
      if (!visit?.card_id) {
        setError(PhosVisitModePageCopy.CARD_ID_MISSING);
        return;
      }

      try {
        const now = Date.now();
        const evidenceKey = `${
          input.offlineOpClass === 'BLOCKING' ? 'required' : 'optional'
        }_visit_photo_${now}`;
        await offlineEvidenceQueue.enqueueEvidence({
          card_id: visit.card_id,
          packet_id: visit.packet_id,
          evidence_key: evidenceKey,
          label: input.label,
          evidence_type: 'VISIT_PHOTO',
          file_name: input.file.name || `${evidenceKey}.jpg`,
          mime_type: input.file.type || 'application/octet-stream',
          sha256: await sha256Hex(input.file),
          offline_op_class: input.offlineOpClass,
          file: input.file,
        });
        await refreshPendingEvidence(visit);
      } catch (captureError) {
        setError(errorMessage(captureError));
      }
    },
    [offlineEvidenceQueue, refreshPendingEvidence, visit],
  );

  return (
    <div className="space-y-4">
      {displayPhase === 'LOADING' ? (
        <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">{PhosVisitModePageCopy.LOADING}</p>
        </section>
      ) : null}
      {displayError ? (
        <section className="rounded-lg border px-4 py-3 text-sm" style={warningFeedbackStyle}>
          {displayError}
        </section>
      ) : null}
      {visit ? (
        <VisitMode
          visit={visit}
          pendingEvidence={pendingEvidence}
          onArrivalOutcome={handleArrivalOutcome}
          onOpenStep={(step) => void updateVisitStep(step)}
          onSaveDraft={handleSaveDraft}
          onCaptureEvidence={visit.card_id ? handleCaptureEvidence : undefined}
          onCompleteVisit={() => void updateVisitStep(VisitStep.COMPLETE_CHECK)}
        />
      ) : null}
    </div>
  );
}
