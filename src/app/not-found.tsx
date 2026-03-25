import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-foreground">404</h1>
        <h2 className="text-lg font-semibold text-foreground">
          ページが見つかりません
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          お探しのページは存在しないか、移動された可能性があります。
        </p>
      </div>
      <Link href="/dashboard">
        <Button>ダッシュボードへ戻る</Button>
      </Link>
    </div>
  );
}
