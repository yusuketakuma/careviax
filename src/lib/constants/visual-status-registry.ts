import type { StatusRole } from '@/lib/constants/status-tokens';

/**
 * Central, executable metadata for a domain state. Consumers pass the semantic
 * key; visual copy and role come from this registry rather than local maps.
 */
export type VisualStatusEntry<TKey extends string, TDomain extends string> = Readonly<{
  key: TKey;
  domain: TDomain;
  label: string;
  role: StatusRole;
  component: 'SyncStateBadge';
  persistent: boolean;
  retryable: boolean;
}>;

export const OFFLINE_SYNC_STATUS_VALUES = [
  'saved_locally',
  'queued',
  'failed',
  'synced',
  'conflict',
] as const;

export type OfflineSyncStatus = (typeof OFFLINE_SYNC_STATUS_VALUES)[number];

/**
 * SSOT 6.6: local and server persistence are intentionally distinct. This
 * registry describes existing UI states only; it does not alter queue behavior.
 */
export const OFFLINE_SYNC_STATUS_REGISTRY = {
  saved_locally: {
    key: 'saved_locally',
    domain: 'synchronization',
    label: '端末保存済',
    role: 'info',
    component: 'SyncStateBadge',
    persistent: true,
    retryable: false,
  },
  queued: {
    key: 'queued',
    domain: 'synchronization',
    label: '送信待ち',
    role: 'info',
    component: 'SyncStateBadge',
    persistent: true,
    retryable: false,
  },
  failed: {
    key: 'failed',
    domain: 'synchronization',
    label: '送信失敗',
    role: 'blocked',
    component: 'SyncStateBadge',
    persistent: true,
    retryable: true,
  },
  synced: {
    key: 'synced',
    domain: 'synchronization',
    label: '同期済み',
    role: 'done',
    component: 'SyncStateBadge',
    persistent: false,
    retryable: false,
  },
  conflict: {
    key: 'conflict',
    domain: 'synchronization',
    label: '競合',
    role: 'confirm',
    component: 'SyncStateBadge',
    persistent: true,
    retryable: false,
  },
} as const satisfies Record<
  OfflineSyncStatus,
  VisualStatusEntry<OfflineSyncStatus, 'synchronization'>
>;

export function getOfflineSyncStatusEntry(status: OfflineSyncStatus) {
  return OFFLINE_SYNC_STATUS_REGISTRY[status];
}

/** Compatibility exports for existing consumers; derive them from the registry. */
export const OFFLINE_SYNC_STATUS_ROLE = {
  saved_locally: OFFLINE_SYNC_STATUS_REGISTRY.saved_locally.role,
  queued: OFFLINE_SYNC_STATUS_REGISTRY.queued.role,
  failed: OFFLINE_SYNC_STATUS_REGISTRY.failed.role,
  synced: OFFLINE_SYNC_STATUS_REGISTRY.synced.role,
  conflict: OFFLINE_SYNC_STATUS_REGISTRY.conflict.role,
} as const satisfies Record<OfflineSyncStatus, StatusRole>;

export const OFFLINE_SYNC_STATUS_LABELS = {
  saved_locally: OFFLINE_SYNC_STATUS_REGISTRY.saved_locally.label,
  queued: OFFLINE_SYNC_STATUS_REGISTRY.queued.label,
  failed: OFFLINE_SYNC_STATUS_REGISTRY.failed.label,
  synced: OFFLINE_SYNC_STATUS_REGISTRY.synced.label,
  conflict: OFFLINE_SYNC_STATUS_REGISTRY.conflict.label,
} as const satisfies Record<OfflineSyncStatus, string>;
