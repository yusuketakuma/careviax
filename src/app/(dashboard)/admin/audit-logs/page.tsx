import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { AuditLogsContent } from './audit-logs-content';

export const metadata: Metadata = {
  title: '監査ログ — CareViaX',
};

export default function AuditLogsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          監査ログ
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          操作履歴の閲覧・フィルタリング・CSV出力（3省2ガイドライン対応）
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <AuditLogsContent />
      </Suspense>
    </div>
  );
}
