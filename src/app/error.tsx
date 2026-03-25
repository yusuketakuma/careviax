'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // In production this would log to CloudWatch
    console.error('[ErrorPage]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle
          className="h-10 w-10 text-destructive"
          aria-hidden="true"
        />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-foreground">500</h1>
        <h2 className="text-lg font-semibold text-foreground">
          サーバーエラーが発生しました
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          予期しないエラーが発生しました。問題が続く場合はシステム管理者にお問い合わせください。
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            エラーID: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset} variant="outline">
        再試行
      </Button>
    </div>
  );
}
