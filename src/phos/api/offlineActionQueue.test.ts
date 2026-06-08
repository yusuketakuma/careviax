import 'fake-indexeddb/auto';

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  UserRole,
  type ActionResponse,
} from '@/phos/contracts/phos_contracts';
import {
  clearOfflineEncryptionKey,
  decryptOfflinePayload,
  initOfflineEncryptionKey,
  isEncryptedOfflinePayload,
} from '@/lib/offline/crypto';
import {
  enqueuePhosOfflineCardAction,
  listPhosPendingOfflineCardActions,
  phosOfflineActionDb,
  retryPhosOfflineCardActions,
} from './offlineActionQueue';
import { PhosApiError } from './types';

function installBrowserCryptoEnvironment() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: webcrypto,
      indexedDB,
    },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    },
  });
}

function actionResponse(): ActionResponse {
  return {
    card: {
      card_id: 'card_1',
      card_type: CardType.PRESCRIPTION,
      patient_name: '患者 山田太郎',
      current_step: CurrentStep.INTAKE,
      display_status: DisplayStatus.READY,
      server_version: 2,
      tags: [],
    },
    next_action: {
      code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      kind: ActionKind.STEP_CHANGING,
      label_key: 'action.confirm_prescription_diff',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: 'POST /cards/{card_id}/actions',
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    },
    display_status: DisplayStatus.READY,
    blockers: [],
    side_effects: [],
    server_version: 2,
  };
}

describe('PH-OS offline action queue', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    installBrowserCryptoEnvironment();
    await indexedDB.deleteDatabase('ph-os-offline-keys');
    await indexedDB.deleteDatabase('PH-OSActionOfflineQueue');
    await initOfflineEncryptionKey('user-1', 'session-secret');
    await phosOfflineActionDb.open();
  });

  afterEach(async () => {
    await clearOfflineEncryptionKey();
    phosOfflineActionDb.close();
    await indexedDB.deleteDatabase('PH-OSActionOfflineQueue');
    await indexedDB.deleteDatabase('ph-os-offline-keys');
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('stores card action payloads encrypted for later PH-OS API Gateway sync', async () => {
    const request = {
      action_code: ActionCode.CANCEL_CARD,
      idempotency_key: 'idem_cancel_1',
      client_version: 4,
      reason_code: 'PATIENT_REQUEST',
      reason_note: '患者 山田太郎からの中止依頼',
    };

    const queued = await enqueuePhosOfflineCardAction({
      card_id: 'card_1',
      request,
      offline_op_class: 'BLOCKING',
    });

    const record = await phosOfflineActionDb.offlineActions.get(Number(queued.queue_id));
    expect(record).toMatchObject({
      operation: 'CARD_ACTION',
      card_id: 'card_1',
      action_code: ActionCode.CANCEL_CARD,
      idempotency_key: 'idem_cancel_1',
      offline_op_class: 'BLOCKING',
      retry_count: 0,
    });
    expect(isEncryptedOfflinePayload(record?.payload)).toBe(true);
    expect(record?.payload).not.toContain('山田太郎');
    expect(await decryptOfflinePayload(record?.payload)).toBe(
      JSON.stringify({ card_id: 'card_1', request }),
    );
  });

  it('reuses the queued item for duplicate idempotency keys', async () => {
    const input = {
      card_id: 'card_1',
      request: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_same',
        client_version: 1,
      },
      offline_op_class: 'NON_BLOCKING' as const,
    };

    const first = await enqueuePhosOfflineCardAction(input);
    const second = await enqueuePhosOfflineCardAction(input);

    expect(second.queue_id).toBe(first.queue_id);
    expect(await phosOfflineActionDb.offlineActions.count()).toBe(1);
  });

  it('replays queued card actions through the PH-OS API client and removes synced records', async () => {
    const request = {
      action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      idempotency_key: 'idem_sync',
      client_version: 1,
    };
    await enqueuePhosOfflineCardAction({
      card_id: 'card_1',
      request,
      offline_op_class: 'NON_BLOCKING',
    });
    const executeCardAction = vi.fn(async () => ({
      ...actionResponse(),
    }));

    await expect(retryPhosOfflineCardActions({ client: { executeCardAction } })).resolves.toEqual({
      synced: 1,
      failed: 0,
    });

    expect(executeCardAction).toHaveBeenCalledWith('card_1', request);
    expect(await phosOfflineActionDb.offlineActions.count()).toBe(0);
  });

  it('keeps failed queued card actions with retry status for the scheduler', async () => {
    await enqueuePhosOfflineCardAction({
      card_id: 'card_1',
      request: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_retry',
        client_version: 1,
      },
      offline_op_class: 'BLOCKING',
    });

    await expect(
      retryPhosOfflineCardActions({
        client: {
          executeCardAction: vi.fn(async () => {
            throw new TypeError('fetch failed');
          }),
        },
      }),
    ).resolves.toEqual({ synced: 0, failed: 1 });

    await expect(listPhosPendingOfflineCardActions()).resolves.toEqual([
      expect.objectContaining({
        card_id: 'card_1',
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        retry_count: 1,
        last_error: 'fetch failed',
      }),
    ]);
  });

  it('blocks 409 conflict replays instead of retrying and overwriting drafts', async () => {
    await enqueuePhosOfflineCardAction({
      card_id: 'card_1',
      request: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_conflict',
        client_version: 1,
      },
      offline_op_class: 'BLOCKING',
    });

    await expect(
      retryPhosOfflineCardActions({
        client: {
          executeCardAction: vi.fn(async () => {
            throw new PhosApiError(409, {
              request_id: 'req_1',
              error_code: 'STALE_VERSION',
              message_key: 'api.error.stale_version',
            });
          }),
        },
      }),
    ).resolves.toEqual({ synced: 0, failed: 1 });

    await expect(listPhosPendingOfflineCardActions()).resolves.toEqual([
      expect.objectContaining({
        card_id: 'card_1',
        retry_count: 1,
        last_error: 'STALE_VERSION',
        blocked_reason: 'CONFLICT',
      }),
    ]);

    await expect(
      retryPhosOfflineCardActions({
        client: { executeCardAction: vi.fn(async () => undefined as never) },
      }),
    ).resolves.toEqual({ synced: 0, failed: 0 });
  });
});
