'use client';

import { useEffect } from 'react';
import { useOrgId } from './use-org-id';

interface UsePresenceHeartbeatOptions {
  entityType: string;
  entityId: string;
  /** いまいる場所(タブ等)。/api/presence の active_field にそのまま渡す */
  activeField?: string | null;
  enabled?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 対象エンティティに「自分がいま見ている」ことを定期登録する(P1-13 今だれが見ているか)。
 * presence はベストエフォート: 失敗しても画面機能には影響させない。
 */
export function usePresenceHeartbeat({
  entityType,
  entityId,
  activeField = null,
  enabled = true,
}: UsePresenceHeartbeatOptions) {
  const orgId = useOrgId();

  useEffect(() => {
    if (!enabled || !orgId || !entityId) return;

    const postPresence = () => {
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          active_field: activeField,
        }),
      }).catch(() => {
        // presence はベストエフォート
      });
    };

    postPresence();
    const timer = setInterval(postPresence, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, orgId, entityType, entityId, activeField]);
}
