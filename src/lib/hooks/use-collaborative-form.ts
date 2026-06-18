'use client';

import { useCallback, useState } from 'react';
import {
  type UseFormReturn,
  type FieldValues,
  type Path,
  type RegisterOptions,
} from 'react-hook-form';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { useOrgId } from './use-org-id';
import { usePresenceUsers } from './use-presence-users';
import { useYjsCollaborationRoom } from './use-yjs-collaboration-room';
import { postPresenceUpdate } from '@/lib/collaboration/presence-api-client';
import type { PresenceUser } from '@/lib/collaboration/presence-contract';

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
  const collaborationAccessKey = `${orgId}\u0000${entityType}\u0000${entityId}`;
  const [collaborationAccessDeniedState, setCollaborationAccessDeniedState] = useState<{
    key: string;
    denied: boolean;
  }>({ key: '', denied: false });
  const collaborationAccessDenied =
    collaborationAccessDeniedState.denied &&
    collaborationAccessDeniedState.key === collaborationAccessKey;

  const { users: presenceData } = usePresenceUsers({
    entityType,
    entityId,
    enabled: !collaborationAccessDenied,
  });

  const onAccessDenied = useCallback((key: string) => {
    setCollaborationAccessDeniedState({ key, denied: true });
  }, []);

  const { awareness, bridgeRef, connected, getTextField, registeredFieldNamesRef, yDoc } =
    useYjsCollaborationRoom({
      form,
      orgId,
      entityType,
      entityId,
      textFieldNames,
      collaborationAccessKey,
      onAccessDenied,
    });

  const postActiveField = useCallback(
    (activeField: string | null) => {
      if (!orgId || !entityId || collaborationAccessDenied) return;
      void postPresenceUpdate({ orgId, entityType, entityId, activeField });
    },
    [orgId, entityType, entityId, collaborationAccessDenied],
  );

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
          // Call original onChange first (React Hook Form), then mirror the value into Yjs.
          const result = await registered.onChange(event as React.ChangeEvent<HTMLInputElement>);
          bridgeRef.current?.setFieldValue(name, event.target.value);
          return result;
        },
      };
    },
    [bridgeRef, form, postActiveField, registeredFieldNamesRef],
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
