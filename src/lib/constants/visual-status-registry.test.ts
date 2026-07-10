import { describe, expect, it } from 'vitest';
import {
  getOfflineSyncStatusEntry,
  OFFLINE_SYNC_STATUS_REGISTRY,
  OFFLINE_SYNC_STATUS_VALUES,
} from './visual-status-registry';

describe('offline sync visual status registry', () => {
  it('exhaustively defines the existing offline sync states', () => {
    expect(Object.keys(OFFLINE_SYNC_STATUS_REGISTRY)).toEqual(OFFLINE_SYNC_STATUS_VALUES);
  });

  it('keeps the ratified labels, roles, and failure persistence contract', () => {
    expect(getOfflineSyncStatusEntry('saved_locally')).toMatchObject({
      label: '端末保存済',
      role: 'info',
      persistent: true,
    });
    expect(getOfflineSyncStatusEntry('failed')).toMatchObject({
      label: '送信失敗',
      role: 'blocked',
      persistent: true,
      retryable: true,
    });
    expect(getOfflineSyncStatusEntry('synced')).toMatchObject({
      label: '同期済み',
      role: 'done',
      persistent: false,
    });
    expect(getOfflineSyncStatusEntry('conflict')).toMatchObject({
      label: '競合',
      role: 'confirm',
      persistent: true,
    });
  });
});
