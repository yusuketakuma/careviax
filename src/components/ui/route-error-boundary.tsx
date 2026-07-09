'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { clientLog } from '@/lib/utils/client-log';

export function createRouteErrorBoundary(tag: string) {
  return function RouteError({
    error,
    reset,
  }: {
    error: Error & { digest?: string };
    reset: () => void;
  }) {
    useEffect(() => {
      // Client telemetry keeps only coded boundary context; raw Error can carry PHI.
      clientLog.error('route_error_boundary', error, { code: error.digest, route: tag });
    }, [error]);

    return (
      <ErrorState
        variant="server"
        size="page"
        detail={error.digest ? <span>エラーID: {error.digest}</span> : null}
        onRetry={reset}
        retryVariant="outline"
        secondaryAction={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
      />
    );
  };
}
