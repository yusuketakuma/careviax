'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type UseFormReturn,
  type FieldValues,
  type Path,
  type RegisterOptions,
} from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { useRealtimeEvents } from './use-realtime-events';
import { useOrgId } from './use-org-id';
import { createYjsProvider, isYjsProviderConfigured } from '@/lib/collaboration/yjs-provider';
import { FormYjsBridge } from '@/lib/collaboration/form-yjs-bridge';
import { readJsonResponseBody } from '@/lib/api/response-body';
import type { PresenceUser } from '@/components/features/collaboration/presence-avatars';

interface UseCollaborativeFormOptions<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  entityType: string;
  entityId: string;
  /** Fields that should use Y.Text (character-level CRDT) instead of Y.Map */
  textFields?: string[];
}

type CollaborativeRegisterReturn = {
  onChange: (event: { target: { value: unknown }; type?: string }) => Promise<boolean | void>;
  onBlur: (e: React.FocusEvent<HTMLElement>) => void;
  onFocus: () => void;
  name: string;
  ref: React.RefCallback<HTMLElement>;
  min?: string | number;
  max?: string | number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  required?: boolean;
  disabled?: boolean;
};

type CollaborationRoomTokenResponse = {
  room: string;
  token: string;
  expires_at: string;
};

type RoomTokenFetchResult =
  | { kind: 'ok'; roomToken: CollaborationRoomTokenResponse }
  | { kind: 'access-denied' }
  | { kind: 'transient-error'; retryAfterMs?: number };

const ROOM_TOKEN_REFRESH_SKEW_MS = 60_000;
const ROOM_TOKEN_REFRESH_RETRY_BASE_MS = 5_000;
const ROOM_TOKEN_REFRESH_RETRY_MAX_MS = 60_000;
const ROOM_TOKEN_REFRESH_RETRY_JITTER_MS = 1_000;
const PROVIDER_RENEWAL_CANDIDATE_TIMEOUT_MS = 10_000;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPresenceUser(value: unknown): PresenceUser | null {
  const object = readRecord(value);
  if (!object) return null;

  const userId = readNonBlankString(object.user_id);
  const displayName = readNonBlankString(object.display_name);
  const updatedAt = readNonBlankString(object.updated_at);
  let activeField: string | null | undefined;
  if (object.active_field == null) {
    activeField = null;
  } else if (typeof object.active_field === 'string') {
    activeField = object.active_field.trim() || null;
  }

  if (!userId || !displayName || !updatedAt || activeField === undefined) return null;
  return {
    user_id: userId,
    display_name: displayName,
    active_field: activeField,
    updated_at: updatedAt,
  };
}

function readPresenceUsersResponse(payload: unknown): PresenceUser[] {
  const object = readRecord(payload);
  const users = object?.data;
  if (!Array.isArray(users)) return [];
  return users.flatMap((user) => {
    const parsed = readPresenceUser(user);
    return parsed ? [parsed] : [];
  });
}

function readCollaborationRoomTokenResponse(
  payload: unknown,
): CollaborationRoomTokenResponse | null {
  const object = readRecord(payload);
  if (!object) return null;

  const room = readNonBlankString(object.room);
  const token = readNonBlankString(object.token);
  const expiresAt = readNonBlankString(object.expires_at);
  if (!room || !token || !expiresAt) return null;

  return { room, token, expires_at: expiresAt };
}

interface UseCollaborativeFormReturn<TFieldValues extends FieldValues> {
  registerCollaborative: (
    name: Path<TFieldValues>,
    options?: RegisterOptions<TFieldValues, Path<TFieldValues>>,
  ) => CollaborativeRegisterReturn;
  presenceData: PresenceUser[];
  yDoc: Y.Doc | null;
  awareness: Awareness | null;
  getTextField: (name: string) => Y.Text | null;
  connected: boolean;
}

export function useCollaborativeForm<TFieldValues extends FieldValues>({
  form,
  entityType,
  entityId,
  textFields: textFieldNames = [],
}: UseCollaborativeFormOptions<TFieldValues>): UseCollaborativeFormReturn<TFieldValues> {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const queryKey = ['presence', entityType, entityId, orgId];
  const presenceTargets = useMemo(() => [{ entityType, entityId }], [entityType, entityId]);
  const collaborationAccessKey = `${orgId}\u0000${entityType}\u0000${entityId}`;
  const [collaborationAccessDeniedState, setCollaborationAccessDeniedState] = useState<{
    key: string;
    denied: boolean;
  }>({ key: '', denied: false });
  const collaborationAccessDenied =
    collaborationAccessDeniedState.denied &&
    collaborationAccessDeniedState.key === collaborationAccessKey;

  const realtime = useRealtimeEvents({
    onEvent: (event) => {
      const e = event as { type?: string; entity_type?: string; entity_id?: string };
      if (
        e.type === 'presence_update' &&
        e.entity_type === entityType &&
        e.entity_id === entityId
      ) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
    enabled: !!orgId && !!entityId && !collaborationAccessDenied,
    presenceTargets,
  });

  const { data: presenceData = [] } = useQuery<PresenceUser[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/presence?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
        { headers: { 'x-org-id': orgId } },
      );
      if (!res.ok) return [];
      const payload = await readJsonResponseBody(res);
      return readPresenceUsersResponse(payload);
    },
    refetchInterval: realtime.connected ? false : 30_000,
    enabled: !!orgId && !!entityId && !collaborationAccessDenied,
  });

  const postActiveField = useCallback(
    (activeField: string | null) => {
      if (!orgId || !entityId || collaborationAccessDenied) return;
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          active_field: activeField,
        }),
      }).catch(() => {
        // Presence is best-effort
      });
    },
    [orgId, entityType, entityId, collaborationAccessDenied],
  );

  // --- Yjs CRDT integration (Phase 6) ---
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
        // Observe remote Y.Map changes and push to React Hook Form
        unobserve = bridge.observeChanges((name, value) => {
          // Skip text fields -- those are handled by CollaborativeTextarea directly
          if (textFieldNamesRef.current.includes(name)) return;
          if (!registeredFieldNamesRef.current.has(name)) return;

          form.setValue(name as Path<TFieldValues>, value as TFieldValues[string], {
            shouldDirty: false,
            shouldValidate: false,
          });
        });
      }
    }

    function getTokenRetryDelayMs(retryAfterMs?: number) {
      if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return Math.min(retryAfterMs, ROOM_TOKEN_REFRESH_RETRY_MAX_MS);
      }

      const exponentialDelayMs =
        ROOM_TOKEN_REFRESH_RETRY_BASE_MS * 2 ** Math.min(transientRetryCount, 4);
      const jitterMs = Math.floor(Math.random() * ROOM_TOKEN_REFRESH_RETRY_JITTER_MS);
      return Math.min(exponentialDelayMs + jitterMs, ROOM_TOKEN_REFRESH_RETRY_MAX_MS);
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

      const delayMs = getTokenRetryDelayMs(retryAfterMs);
      transientRetryCount += 1;
      refreshTimer = setTimeout(() => {
        void connectProvider();
      }, delayMs);
    }

    function parseRetryAfterMs(retryAfterHeader: string | null) {
      if (!retryAfterHeader) return undefined;

      const seconds = Number(retryAfterHeader);
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1_000;
      }

      const retryAtMs = Date.parse(retryAfterHeader);
      if (!Number.isFinite(retryAtMs)) return undefined;

      const delayMs = retryAtMs - Date.now();
      return delayMs > 0 ? delayMs : undefined;
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

    async function fetchRoomToken(): Promise<RoomTokenFetchResult> {
      const tokenResponse = await fetch('/api/collaboration/room-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
        }),
      }).catch(() => null);

      if (!tokenResponse) return { kind: 'transient-error' };
      if (!tokenResponse.ok) {
        const isTransientFailure = tokenResponse.status === 429 || tokenResponse.status >= 500;
        return isTransientFailure
          ? {
              kind: 'transient-error',
              retryAfterMs: parseRetryAfterMs(tokenResponse.headers.get('Retry-After')),
            }
          : { kind: 'access-denied' };
      }

      const roomToken = readCollaborationRoomTokenResponse(
        await readJsonResponseBody(tokenResponse),
      );
      if (!roomToken) return { kind: 'transient-error' };
      const expiresAtMs = Date.parse(roomToken.expires_at);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        return { kind: 'transient-error' };
      }
      return { kind: 'ok', roomToken };
    }

    async function connectProvider() {
      const tokenResult = await fetchRoomToken();
      if (cancelled) return;
      if (tokenResult.kind === 'access-denied') {
        setCollaborationAccessDeniedState({ key: collaborationAccessKey, denied: true });
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
  }, [entityType, entityId, orgId]);

  // --- Combined registerCollaborative (presence + Yjs) ---
  const registerCollaborative = useCallback(
    (name: Path<TFieldValues>, options?: RegisterOptions<TFieldValues, Path<TFieldValues>>) => {
      const registered = form.register(name, options);

      return {
        ...registered,
        ref: (element: HTMLElement | null) => {
          if (element) {
            registeredFieldNamesRef.current.add(name);
          } else {
            registeredFieldNamesRef.current.delete(name);
          }
          registered.ref(element);
        },
        onFocus: () => {
          postActiveField(name);
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
          postActiveField(null);
          if (registered.onBlur) {
            registered.onBlur(e as React.FocusEvent<HTMLInputElement>);
          }
        },
        onChange: async (event: { target: { value: unknown }; type?: string }) => {
          // Call original onChange first (React Hook Form)
          const result = await registered.onChange(event as React.ChangeEvent<HTMLInputElement>);

          // Sync to Yjs
          bridgeRef.current?.setFieldValue(name, event.target.value);

          return result;
        },
      };
    },
    [form, postActiveField],
  );

  const getTextField = useCallback((name: string): Y.Text | null => {
    if (!textFieldNamesRef.current.includes(name)) return null;
    return bridgeRef.current?.getTextField(name) ?? null;
  }, []);

  return {
    registerCollaborative,
    presenceData,
    yDoc,
    awareness,
    getTextField,
    connected,
  };
}
