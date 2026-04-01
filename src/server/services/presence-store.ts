const TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;

export interface PresenceEntry {
  user_id: string;
  display_name: string;
  active_field: string | null;
  updated_at: string;
  expires_at: number;
}

// Key: `${orgId}:${entityType}:${entityId}:${userId}`
const store = new Map<string, PresenceEntry>();

function entryKey(orgId: string, entityType: string, entityId: string, userId: string): string {
  return `${orgId}:${entityType}:${entityId}:${userId}`;
}

function entityPrefix(orgId: string, entityType: string, entityId: string): string {
  return `${orgId}:${entityType}:${entityId}:`;
}

// Periodic cleanup of expired entries
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expires_at < now) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS).unref?.();
}

export function setPresence(
  orgId: string,
  entityType: string,
  entityId: string,
  userId: string,
  displayName: string,
  activeField: string | null
): void {
  const key = entryKey(orgId, entityType, entityId, userId);
  store.set(key, {
    user_id: userId,
    display_name: displayName,
    active_field: activeField,
    updated_at: new Date().toISOString(),
    expires_at: Date.now() + TTL_MS,
  });
}

export function getPresence(
  orgId: string,
  entityType: string,
  entityId: string
): Omit<PresenceEntry, 'expires_at'>[] {
  const prefix = entityPrefix(orgId, entityType, entityId);
  const now = Date.now();
  const results: Omit<PresenceEntry, 'expires_at'>[] = [];

  for (const [key, entry] of store) {
    if (!key.startsWith(prefix)) continue;
    if (entry.expires_at < now) {
      store.delete(key);
      continue;
    }
    const { expires_at, ...rest } = entry;
    void expires_at;
    results.push(rest);
  }

  return results;
}

export function removePresence(
  orgId: string,
  entityType: string,
  entityId: string,
  userId: string
): void {
  store.delete(entryKey(orgId, entityType, entityId, userId));
}
