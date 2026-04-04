'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function VisitsError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[VisitsError]', error);
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
}
