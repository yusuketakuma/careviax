'use client';

import { useCallback, useState } from 'react';
import { ActionPhase } from '@/phos/contracts/phos_contracts';
import type {
  ActionRequest,
  ActionResponse,
  OfflineOpClass,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient, PhosOfflineActionQueue } from './types';
import { PhosApiError, PhosOfflineQueuedError } from './types';

export type PhosActionState = {
  phase: ActionPhase;
  response?: ActionResponse;
  error?: Error;
  offline_queued?: boolean;
};

export type UsePhosActionResult = PhosActionState & {
  execute: (
    card_id: string,
    request: ActionRequest,
    options?: PhosActionExecuteOptions,
  ) => Promise<ActionResponse>;
  reset: () => void;
};

export type PhosActionExecuteOptions = {
  offline_allowed?: boolean;
  offline_op_class?: OfflineOpClass;
};

export type UsePhosActionOptions = {
  offlineQueue?: PhosOfflineActionQueue;
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

function isNetworkError(error: unknown): boolean {
  return !(error instanceof PhosApiError);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('PH-OS action failed');
}

export function usePhosAction(
  client: Pick<PhosApiClient, 'executeCardAction'>,
  options: UsePhosActionOptions = {},
): UsePhosActionResult {
  const [state, setState] = useState<PhosActionState>({ phase: ActionPhase.IDLE });

  const reset = useCallback(() => {
    setState({ phase: ActionPhase.IDLE });
  }, []);

  const execute = useCallback(
    async (
      card_id: string,
      request: ActionRequest,
      executeOptions?: PhosActionExecuteOptions,
    ): Promise<ActionResponse> => {
      setState({ phase: ActionPhase.SUBMITTING });
      try {
        const response = await client.executeCardAction(card_id, request);
        setState({ phase: ActionPhase.SUCCEEDED, response });
        return response;
      } catch (error) {
        if (options.offlineQueue && isNetworkError(error)) {
          if (executeOptions?.offline_allowed === true) {
            let queued;
            try {
              queued = await options.offlineQueue.enqueueCardAction({
                card_id,
                request,
                offline_op_class: executeOptions.offline_op_class ?? 'BLOCKING',
              });
            } catch (queueError) {
              setState({ phase: ActionPhase.NET_ERROR, error: normalizeError(queueError) });
              throw queueError;
            }
            const queuedError = new PhosOfflineQueuedError(queued);
            setState({
              phase: ActionPhase.NET_ERROR,
              error: queuedError,
              offline_queued: true,
            });
            throw queuedError;
          }
        }
        setState({ phase: phaseForError(error), error: normalizeError(error) });
        throw error;
      }
    },
    [client, options.offlineQueue],
  );

  return { ...state, execute, reset };
}
