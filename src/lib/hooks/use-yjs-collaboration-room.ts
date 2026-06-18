'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  fetchCollaborationRoomToken,
  getRoomTokenRetryDelayMs,
  PROVIDER_RENEWAL_CANDIDATE_TIMEOUT_MS,
  ROOM_TOKEN_REFRESH_RETRY_BASE_MS,
  ROOM_TOKEN_REFRESH_SKEW_MS,
  type CollaborationRoomTokenResponse,
} from '@/lib/collaboration/room-token-client';
import { createYjsProvider, isYjsProviderConfigured } from '@/lib/collaboration/yjs-provider';
import { FormYjsBridge } from '@/lib/collaboration/form-yjs-bridge';

interface UseYjsCollaborationRoomOptions<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  orgId: string;
  entityType: string;
  entityId: string;
  textFieldNames: string[];
  collaborationAccessKey: string;
  onAccessDenied: (key: string) => void;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function useYjsCollaborationRoom<TFieldValues extends FieldValues>({
  form,
  orgId,
  entityType,
  entityId,
  textFieldNames,
  collaborationAccessKey,
  onAccessDenied,
}: UseYjsCollaborationRoomOptions<TFieldValues>) {
  const [yDoc, setYDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [connected, setConnected] = useState(false);
  const bridgeRef = useRef<FormYjsBridge | null>(null);
  const textFieldNamesRef = useRef(textFieldNames);
  const registeredFieldNamesRef = useRef(new Set<string>());

  useEffect(() => {
    textFieldNamesRef.current = textFieldNames;
  }, [textFieldNames]);

  useEffect(() => {
    if (!orgId || !entityId) return;
    if (!isYjsProviderConfigured()) return;

    let cancelled = false;
    let provider: ReturnType<typeof createYjsProvider> = null;
    let renewalCandidateProvider: ReturnType<typeof createYjsProvider> = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let tokenExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    let renewalCandidateTimer: ReturnType<typeof setTimeout> | null = null;
    const doc = new Y.Doc();
    let bridge: FormYjsBridge | null = null;
    let unobserve: (() => void) | null = null;
    let providerGeneration = 0;
    const registeredFieldNames = registeredFieldNamesRef.current;
    let docDestroyed = false;
    let transientRetryCount = 0;

    function clearRefreshTimer() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    }

    function clearTokenExpiryTimer() {
      if (tokenExpiryTimer) {
        clearTimeout(tokenExpiryTimer);
        tokenExpiryTimer = null;
      }
    }

    function clearRenewalCandidateTimer() {
      if (renewalCandidateTimer) {
        clearTimeout(renewalCandidateTimer);
        renewalCandidateTimer = null;
      }
    }

    function destroyProvider(providerToDestroy: ReturnType<typeof createYjsProvider>) {
      if (!providerToDestroy) return;
      providerToDestroy.disconnect();
      providerToDestroy.destroy();
    }

    function destroyRenewalCandidate() {
      clearRenewalCandidateTimer();
      destroyProvider(renewalCandidateProvider);
      renewalCandidateProvider = null;
    }

    function deactivateCollaborationSurface() {
      unobserve?.();
      unobserve = null;
      bridgeRef.current = null;
      setYDoc(null);
      setAwareness(null);
      setConnected(false);
    }

    function destroyCollaborationDoc() {
      if (docDestroyed) return;
      clearTokenExpiryTimer();
      deactivateCollaborationSurface();
      if (bridge) {
        bridge.destroy();
        bridge = null;
      } else {
        doc.destroy();
      }
      docDestroyed = true;
      registeredFieldNames.clear();
    }

    function activateCollaborationSurface() {
      if (!bridge) {
        bridge = new FormYjsBridge(doc);
        bridge.initializeDefaults(readRecord(form.getValues()) ?? {}, textFieldNamesRef.current);
      }

      bridgeRef.current = bridge;
      setYDoc(doc);

      if (!unobserve) {
        // Observe remote Y.Map changes and push to React Hook Form.
        unobserve = bridge.observeChanges((name, value) => {
          // Text fields are handled by CollaborativeTextarea directly.
          if (textFieldNamesRef.current.includes(name)) return;
          if (!registeredFieldNamesRef.current.has(name)) return;

          form.setValue(name as Path<TFieldValues>, value as TFieldValues[string], {
            shouldDirty: false,
            shouldValidate: false,
          });
        });
      }
    }

    function scheduleTokenRefresh(expiresAt: string) {
      clearRefreshTimer();
      if (cancelled) return;

      const expiryMs = Date.parse(expiresAt);
      const delayMs = Math.max(
        ROOM_TOKEN_REFRESH_RETRY_BASE_MS,
        expiryMs - Date.now() - ROOM_TOKEN_REFRESH_SKEW_MS,
      );

      refreshTimer = setTimeout(() => {
        void connectProvider();
      }, delayMs);
    }

    function scheduleTokenHardExpiry(expiresAt: string) {
      clearTokenExpiryTimer();
      if (cancelled) return;

      const expiryMs = Date.parse(expiresAt);
      const delayMs = Number.isFinite(expiryMs) ? Math.max(0, expiryMs - Date.now()) : 0;
      tokenExpiryTimer = setTimeout(() => {
        clearRefreshTimer();
        disconnectCurrentProvider();
        destroyCollaborationDoc();
        cancelled = true;
      }, delayMs);
    }

    function scheduleTokenRetry(retryAfterMs?: number) {
      clearRefreshTimer();
      if (cancelled) return;

      const delayMs = getRoomTokenRetryDelayMs({ retryAfterMs, transientRetryCount });
      transientRetryCount += 1;
      refreshTimer = setTimeout(() => {
        void connectProvider();
      }, delayMs);
    }

    function disconnectCurrentProvider() {
      destroyRenewalCandidate();
      destroyProvider(provider);
      provider = null;
      providerGeneration += 1;
      deactivateCollaborationSurface();
    }

    function attachProvider(providerToAttach: NonNullable<ReturnType<typeof createYjsProvider>>) {
      const nextProviderGeneration = providerGeneration + 1;
      provider = providerToAttach;
      providerGeneration = nextProviderGeneration;
      setConnected(false);
      activateCollaborationSurface();

      const onStatus = ({ status }: { status: string }) => {
        if (cancelled || providerGeneration !== nextProviderGeneration) return;
        setConnected(status === 'connected');
      };
      providerToAttach.on('status', onStatus);
      providerToAttach.on('connection-error', () => {
        if (cancelled || providerGeneration !== nextProviderGeneration) return;
        setConnected(false);
      });
      providerToAttach.on('connection-close', () => {
        if (cancelled || providerGeneration !== nextProviderGeneration) return;
        setConnected(false);
      });

      providerToAttach.awareness.setLocalStateField('user', {
        userId: orgId,
        displayName: orgId ? orgId.slice(0, 8) : 'User',
      });

      setAwareness(providerToAttach.awareness);
    }

    function createRoomProvider(roomToken: CollaborationRoomTokenResponse) {
      try {
        return createYjsProvider(roomToken.room, doc, { token: roomToken.token });
      } catch {
        return null;
      }
    }

    async function connectProvider() {
      const tokenResult = await fetchCollaborationRoomToken({ orgId, entityType, entityId });
      if (cancelled) return;
      if (tokenResult.kind === 'access-denied') {
        onAccessDenied(collaborationAccessKey);
        disconnectCurrentProvider();
        destroyCollaborationDoc();
        cancelled = true;
        return;
      }
      if (tokenResult.kind === 'transient-error') {
        scheduleTokenRetry(tokenResult.retryAfterMs);
        return;
      }

      const { roomToken } = tokenResult;
      transientRetryCount = 0;
      const previousProvider = provider;
      const nextProvider = createRoomProvider(roomToken);

      if (cancelled) {
        destroyProvider(nextProvider);
        return;
      }

      if (!nextProvider) {
        if (previousProvider) {
          scheduleTokenRetry();
          return;
        }
        destroyCollaborationDoc();
        cancelled = true;
        return;
      }

      if (!previousProvider) {
        attachProvider(nextProvider);
        scheduleTokenHardExpiry(roomToken.expires_at);
        scheduleTokenRefresh(roomToken.expires_at);
        return;
      }

      let candidateSettled = false;
      function rejectCandidate() {
        if (candidateSettled) return;
        candidateSettled = true;
        destroyRenewalCandidate();
        scheduleTokenRetry();
      }

      try {
        destroyRenewalCandidate();
        renewalCandidateProvider = nextProvider;
        nextProvider.awareness.setLocalStateField('user', {
          userId: orgId,
          displayName: orgId ? orgId.slice(0, 8) : 'User',
        });
        nextProvider.on('status', ({ status }: { status: string }) => {
          if (cancelled) return;
          if (candidateSettled && provider === nextProvider) {
            setConnected(status === 'connected');
            return;
          }
          if (candidateSettled || provider !== previousProvider) return;

          if (status === 'connected') {
            candidateSettled = true;
            clearRenewalCandidateTimer();
            renewalCandidateProvider = null;
            provider = nextProvider;
            providerGeneration += 1;
            destroyProvider(previousProvider);
            setConnected(true);
            setAwareness(nextProvider.awareness);
            scheduleTokenHardExpiry(roomToken.expires_at);
            scheduleTokenRefresh(roomToken.expires_at);
            return;
          }

          if (status === 'disconnected') {
            rejectCandidate();
          }
        });
        nextProvider.on('connection-error', () => {
          if (cancelled) return;
          if (candidateSettled || provider !== previousProvider) return;
          rejectCandidate();
        });
        nextProvider.on('connection-close', () => {
          if (cancelled) return;
          if (candidateSettled || provider !== previousProvider) return;
          rejectCandidate();
        });
      } catch {
        rejectCandidate();
        return;
      }

      clearRenewalCandidateTimer();
      renewalCandidateTimer = setTimeout(() => {
        if (cancelled) return;
        if (candidateSettled || provider !== previousProvider) return;
        rejectCandidate();
      }, PROVIDER_RENEWAL_CANDIDATE_TIMEOUT_MS);
    }

    void connectProvider();

    return () => {
      cancelled = true;
      clearRefreshTimer();
      clearTokenExpiryTimer();
      destroyRenewalCandidate();
      destroyProvider(provider);
      destroyCollaborationDoc();
      bridgeRef.current = null;
      setYDoc(null);
      setAwareness(null);
      setConnected(false);
    };
    // form is stable (useForm returns a stable reference)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, orgId, collaborationAccessKey, onAccessDenied]);

  const getTextField = useCallback((name: string): Y.Text | null => {
    if (!textFieldNamesRef.current.includes(name)) return null;
    return bridgeRef.current?.getTextField(name) ?? null;
  }, []);

  return {
    awareness,
    bridgeRef,
    connected,
    getTextField,
    registeredFieldNamesRef,
    yDoc,
  };
}
