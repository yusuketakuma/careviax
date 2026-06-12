import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { PrintHubContent } from './print-hub-content';

export const metadata: Metadata = { title: '帳票・印刷プレビュー — PH-OS' };

/**
 * p0_47: /reports/print(報告・文書文脈の帳票・印刷ハブ)。
 * 帳票種別は ?type=set_instruction 等のクエリで切り替える
 * (useSearchParams を使うため Suspense 境界で包む)。
 */
export default function ReportsPrintPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading label="印刷プレビューを準備中..." />}>
        <PrintHubContent />
      </Suspense>
    </PageScaffold>
  );
}
