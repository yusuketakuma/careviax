'use client';

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
    }, [error]);

    return (
      <ErrorState
        variant="server"
        size="page"
        detail={error.digest ? <span>エラーID: {error.digest}</span> : null}
        action={{ label: '再試行', onClick: reset, variant: 'outline' }}
        secondaryAction={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
      />
    );
  };
}
