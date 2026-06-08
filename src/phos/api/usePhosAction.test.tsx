// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ActionPhase,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionRequest,
  ActionResponse,
  CardSummaryView,
  ErrorResponse,
  NextActionView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient, PhosOfflineActionQueue } from './types';
import { PhosApiError, PhosOfflineQueuedError } from './types';
import { usePhosAction } from './usePhosAction';

const readyCard = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: 'Test Patient',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  server_version: 1,
  tags: [],
} satisfies CardSummaryView;

const nextAction = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [],
  target_endpoint: '/cards/card_1/actions',
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
} satisfies NextActionView;

function actionRequest(): ActionRequest {
  return {
    action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    idempotency_key: 'idem_1',
    client_version: 1,
  };
}

function actionResponse(): ActionResponse {
  return {
    card: {
      ...readyCard,
      current_step: CurrentStep.DISPENSING,
      display_status: DisplayStatus.IN_PROGRESS,
      server_version: 2,
    },
    next_action: nextAction,
    display_status: DisplayStatus.IN_PROGRESS,
    blockers: [],
    side_effects: [],
    server_version: 2,
  };
}

function actionClient(
  executeCardAction: PhosApiClient['executeCardAction'],
): Pick<PhosApiClient, 'executeCardAction'> {
  return { executeCardAction };
}

function canonicalError(status: number, response: ErrorResponse) {
  return new PhosApiError(status, response);
}

describe('usePhosAction', () => {
  it('applies only the server ActionResponse after a successful action', async () => {
    const serverResponse = actionResponse();
    const client = actionClient(vi.fn(async () => serverResponse));
    const { result } = renderHook(() => usePhosAction(client));

    await act(async () => {
      await expect(result.current.execute('card_1', actionRequest())).resolves.toBe(serverResponse);
    });

    expect(result.current.phase).toBe(ActionPhase.SUCCEEDED);
    expect(result.current.response).toBe(serverResponse);
  });

  it('keeps response empty while submitting so UI cannot optimistically advance steps', async () => {
    let resolveAction: (response: ActionResponse) => void = () => {};
    const pending = new Promise<ActionResponse>((resolve) => {
      resolveAction = resolve;
    });
    const client = actionClient(vi.fn(() => pending));
    const { result } = renderHook(() => usePhosAction(client));

    let actionPromise: Promise<ActionResponse>;
    await act(async () => {
      actionPromise = result.current.execute('card_1', actionRequest());
    });

    expect(result.current.phase).toBe(ActionPhase.SUBMITTING);
    expect(result.current.response).toBeUndefined();

    const serverResponse = actionResponse();
    await act(async () => {
      resolveAction(serverResponse);
      await actionPromise;
    });

    expect(result.current.phase).toBe(ActionPhase.SUCCEEDED);
    expect(result.current.response).toBe(serverResponse);
  });

  it('maps 422 guard failures to GUARD_FAILED without retaining stale responses', async () => {
    const client = actionClient(
      vi.fn(async () => {
        throw canonicalError(422, {
          request_id: 'req_1',
          error_code: 'ACTION_GUARD_FAILED',
          message_key: 'api.error.action_guard_failed',
        });
      }),
    );
    const { result } = renderHook(() => usePhosAction(client));

    await act(async () => {
      await expect(result.current.execute('card_1', actionRequest())).rejects.toMatchObject({
        status: 422,
      });
    });

    expect(result.current.phase).toBe(ActionPhase.GUARD_FAILED);
    expect(result.current.response).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(PhosApiError);
  });

  it('maps stale version and idempotency conflicts to CONFLICT', async () => {
    const client = actionClient(
      vi.fn(async () => {
        throw canonicalError(409, {
          request_id: 'req_1',
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    );
    const { result } = renderHook(() => usePhosAction(client));

    await act(async () => {
      await expect(result.current.execute('card_1', actionRequest())).rejects.toMatchObject({
        status: 409,
      });
    });

    expect(result.current.phase).toBe(ActionPhase.CONFLICT);
    expect(result.current.response).toBeUndefined();
  });

  it('maps network failures to NET_ERROR', async () => {
    const client = actionClient(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const { result } = renderHook(() => usePhosAction(client));

    await act(async () => {
      await expect(result.current.execute('card_1', actionRequest())).rejects.toThrow(
        'fetch failed',
      );
    });

    expect(result.current.phase).toBe(ActionPhase.NET_ERROR);
    expect(result.current.response).toBeUndefined();
  });

  it('queues network failures only when the server action allows offline execution', async () => {
    const offlineQueue: PhosOfflineActionQueue = {
      enqueueCardAction: vi.fn(async () => ({ queue_id: 10 })),
    };
    const client = actionClient(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const { result } = renderHook(() => usePhosAction(client, { offlineQueue }));

    await act(async () => {
      await expect(
        result.current.execute('card_1', actionRequest(), { offline_allowed: true }),
      ).rejects.toBeInstanceOf(PhosOfflineQueuedError);
    });

    expect(offlineQueue.enqueueCardAction).toHaveBeenCalledWith({
      card_id: 'card_1',
      request: actionRequest(),
      offline_op_class: 'BLOCKING',
    });
    expect(result.current.phase).toBe(ActionPhase.NET_ERROR);
    expect(result.current.offline_queued).toBe(true);
    expect(result.current.response).toBeUndefined();
  });

  it('does not queue network failures when offline execution is not allowed', async () => {
    const offlineQueue: PhosOfflineActionQueue = {
      enqueueCardAction: vi.fn(async () => ({ queue_id: 10 })),
    };
    const client = actionClient(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const { result } = renderHook(() => usePhosAction(client, { offlineQueue }));

    await act(async () => {
      await expect(
        result.current.execute('card_1', actionRequest(), { offline_allowed: false }),
      ).rejects.toThrow('fetch failed');
    });

    expect(offlineQueue.enqueueCardAction).not.toHaveBeenCalled();
    expect(result.current.phase).toBe(ActionPhase.NET_ERROR);
    expect(result.current.offline_queued).toBeUndefined();
  });

  it('does not queue server conflicts even when offline execution is allowed', async () => {
    const offlineQueue: PhosOfflineActionQueue = {
      enqueueCardAction: vi.fn(async () => ({ queue_id: 10 })),
    };
    const client = actionClient(
      vi.fn(async () => {
        throw canonicalError(409, {
          request_id: 'req_1',
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    );
    const { result } = renderHook(() => usePhosAction(client, { offlineQueue }));

    await act(async () => {
      await expect(
        result.current.execute('card_1', actionRequest(), { offline_allowed: true }),
      ).rejects.toMatchObject({ status: 409 });
    });

    expect(offlineQueue.enqueueCardAction).not.toHaveBeenCalled();
    expect(result.current.phase).toBe(ActionPhase.CONFLICT);
  });
});
