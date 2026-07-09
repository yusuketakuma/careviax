'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { clientLog } from '@/lib/utils/client-log';

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Client telemetry keeps only coded boundary context; raw Error can carry PHI.
    clientLog.error('global_error_boundary', error, { code: error.digest });
  }, [error]);

  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <ErrorState
          variant="server"
          size="page"
          detail={error.digest ? <span>エラーID: {error.digest}</span> : null}
          onRetry={unstable_retry}
          retryVariant="outline"
          secondaryAction={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
        />
      </body>
    </html>
  );
}
