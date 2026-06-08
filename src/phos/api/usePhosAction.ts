'use client';

import { useCallback, useState } from 'react';
import { ActionPhase } from '@/phos/contracts/phos_contracts';
import type { ActionRequest, ActionResponse } from '@/phos/contracts/phos_contracts';
import type { PhosApiClient } from './types';
import { PhosApiError } from './types';

export type PhosActionState = {
  phase: ActionPhase;
  response?: ActionResponse;
  error?: Error;
};

export type UsePhosActionResult = PhosActionState & {
  execute: (card_id: string, request: ActionRequest) => Promise<ActionResponse>;
  reset: () => void;
};

function phaseForError(error: unknown): ActionPhase {
  if (!(error instanceof PhosApiError)) return ActionPhase.NET_ERROR;
  if (error.status === 422 && error.response.error_code === 'ACTION_GUARD_FAILED') {
    return ActionPhase.GUARD_FAILED;
  }
  if (
    error.status === 409 &&
    (error.response.error_code === 'STALE_VERSION' ||
      error.response.error_code === 'IDEMPOTENCY_CONFLICT')
  ) {
    return ActionPhase.CONFLICT;
  }
  return ActionPhase.NET_ERROR;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('PH-OS action failed');
}

export function usePhosAction(
  client: Pick<PhosApiClient, 'executeCardAction'>,
): UsePhosActionResult {
  const [state, setState] = useState<PhosActionState>({ phase: ActionPhase.IDLE });

  const reset = useCallback(() => {
    setState({ phase: ActionPhase.IDLE });
  }, []);

  const execute = useCallback(
    async (card_id: string, request: ActionRequest): Promise<ActionResponse> => {
      setState({ phase: ActionPhase.SUBMITTING });
      try {
        const response = await client.executeCardAction(card_id, request);
        setState({ phase: ActionPhase.SUCCEEDED, response });
        return response;
      } catch (error) {
        setState({ phase: phaseForError(error), error: normalizeError(error) });
        throw error;
      }
    },
    [client],
  );

  return { ...state, execute, reset };
}
