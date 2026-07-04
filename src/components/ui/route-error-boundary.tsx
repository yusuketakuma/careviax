'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export function createRouteErrorBoundary(tag: string) {
  return function RouteError({
    error,
    reset,
  }: {
    error: Error & { digest?: string };
    reset: () => void;
  }) {
    useEffect(() => {
      console.error(`[${tag}]`, error);
      Sentry.captureException(error, {
        tags: { boundary: tag },
        extra: { digest: error.digest },
      });
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
