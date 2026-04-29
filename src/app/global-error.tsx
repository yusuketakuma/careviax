'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
    Sentry.captureException(error, {
      tags: { boundary: 'GlobalError' },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <ErrorState
          variant="server"
          size="page"
          detail={error.digest ? <span>エラーID: {error.digest}</span> : null}
          action={{ label: '再試行', onClick: unstable_retry, variant: 'outline' }}
          secondaryAction={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
        />
      </body>
    </html>
  );
}
