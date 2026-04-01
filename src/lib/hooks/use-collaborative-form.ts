'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { createYjsProvider } from '@/lib/collaboration/yjs-provider';
import { FormYjsBridge } from '@/lib/collaboration/form-yjs-bridge';
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

  // --- Presence polling (unchanged from Phase 5) ---
  const { data: presenceData = [] } = useQuery<PresenceUser[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/presence?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
        { headers: { 'x-org-id': orgId } },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data: PresenceUser[] };
      return json.data ?? [];
    },
    refetchInterval: 5000,
    enabled: !!orgId && !!entityId,
  });

  useRealtimeEvents({
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
  });

  const postActiveField = useCallback(
    (activeField: string | null) => {
      if (!orgId || !entityId) return;
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
    [orgId, entityType, entityId],
  );

  // --- Yjs CRDT integration (Phase 6) ---
  const [yDoc, setYDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [connected, setConnected] = useState(false);
  const bridgeRef = useRef<FormYjsBridge | null>(null);
  const textFieldNamesRef = useRef(textFieldNames);
  textFieldNamesRef.current = textFieldNames;

  useEffect(() => {
    if (!entityId) return;

    const doc = new Y.Doc();
    const bridge = new FormYjsBridge(doc);
    bridgeRef.current = bridge;

    const provider = createYjsProvider(entityType, entityId, doc);

    if (provider) {
      // Track connection state
      const onStatus = ({ status }: { status: string }) => {
        setConnected(status === 'connected');
      };
      provider.on('status', onStatus);

      // Set awareness user info for cursor rendering
      provider.awareness.setLocalStateField('user', {
        userId: orgId,
        displayName: orgId ? orgId.slice(0, 8) : 'User',
      });

      setAwareness(provider.awareness);
    }

    setYDoc(doc);

    // Observe remote Y.Map changes and push to React Hook Form
    const unobserve = bridge.observeChanges((name, value) => {
      // Skip text fields -- those are handled by CollaborativeTextarea directly
      if (textFieldNamesRef.current.includes(name)) return;

      form.setValue(name as Path<TFieldValues>, value as TFieldValues[string], {
        shouldDirty: false,
        shouldValidate: false,
      });
    });

    return () => {
      unobserve();
      if (provider) {
        provider.disconnect();
        provider.destroy();
      }
      bridge.destroy();
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
    (
      name: Path<TFieldValues>,
      options?: RegisterOptions<TFieldValues, Path<TFieldValues>>,
    ) => {
      const registered = form.register(name, options);

      return {
        ...registered,
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

  const getTextField = useCallback(
    (name: string): Y.Text | null => {
      return bridgeRef.current?.getTextField(name) ?? null;
    },
    [],
  );

  return {
    registerCollaborative,
    presenceData,
    yDoc,
    awareness,
    getTextField,
    connected,
  };
}
