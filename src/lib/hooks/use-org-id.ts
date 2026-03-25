'use client';

import { useAuthStore } from '@/lib/stores/auth-store';

/**
 * Returns the current orgId from the auth store.
 * Falls back to empty string if not set (e.g., during initial load).
 */
export function useOrgId(): string {
  return useAuthStore((s) => s.orgId ?? '');
}
