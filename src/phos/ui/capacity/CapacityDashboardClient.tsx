'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { createPhosApiClient } from '@/phos/api/client';
import type { PhosApiClient } from '@/phos/api/types';
import { CapacityScope, UserRole, type CapacityResponse } from '@/phos/contracts/phos_contracts';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import { CapacityDashboard } from './CapacityDashboard';

export type CapacityDashboardClientProps = {
  apiBaseUrl?: string;
  client?: Pick<PhosApiClient, 'getCapacity'>;
  getAccessToken?: () => string | Promise<string>;
  initialCapacity?: CapacityResponse;
};

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sessionHasCapacityRole(role: unknown, groups: unknown): boolean {
  if (role === UserRole.MANAGER || role === UserRole.ADMIN) return true;
  if (!Array.isArray(groups)) return false;
  return groups.some((group) => {
    if (typeof group !== 'string') return false;
    const normalized = group.trim().toUpperCase();
    return normalized === UserRole.MANAGER || normalized === UserRole.ADMIN;
  });
}

export function CapacityDashboardClient({
  apiBaseUrl,
  client,
  getAccessToken,
  initialCapacity,
}: CapacityDashboardClientProps) {
  const { data: session } = useSession();
  const phosAccessToken = session?.phosAccessToken;
  const canView = sessionHasCapacityRole(session?.phosRole, session?.cognitoGroups);
  const [capacity, setCapacity] = useState<CapacityResponse | undefined>(initialCapacity);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const effectiveGetAccessToken = useMemo(() => {
    if (getAccessToken) return getAccessToken;
    if (!phosAccessToken) return undefined;
    return () => phosAccessToken;
  }, [getAccessToken, phosAccessToken]);

  const apiClient = useMemo(() => {
    if (client) return client;
    if (!apiBaseUrl) return undefined;
    return createPhosApiClient({ baseUrl: apiBaseUrl, getAccessToken: effectiveGetAccessToken });
  }, [apiBaseUrl, client, effectiveGetAccessToken]);

  useEffect(() => {
    if (!canView || !apiClient || initialCapacity) return;
    let cancelled = false;
    apiClient
      .getCapacity({ date: dateKey(new Date()), scope: CapacityScope.PHARMACY })
      .then((response) => {
        if (cancelled) return;
        setCapacity(response);
        setErrorMessage(undefined);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'capacity load failed');
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, canView, initialCapacity]);

  return (
    <div className="space-y-3">
      {errorMessage ? (
        <p className="rounded-md border px-3 py-2 text-sm" style={warningFeedbackStyle}>
          {errorMessage}
        </p>
      ) : null}
      <CapacityDashboard canView={canView} capacity={capacity} />
    </div>
  );
}
