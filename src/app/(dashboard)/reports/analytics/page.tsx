import { Suspense } from 'react';
import { type Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ReportDeliveryDashboard } from '../report-delivery-dashboard';
import { Loading } from '@/components/ui/loading';

export const metadata: Metadata = { title: '報告書送達分析 — CareViaX' };

export default function ReportsAnalyticsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/reports"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          報告書一覧
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">報告書送達分析</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          月別送達成功率・医師別集計・チャネル別集計・未確認報告フォロー
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <ReportDeliveryDashboard />
      </Suspense>
    </div>
  );
}
