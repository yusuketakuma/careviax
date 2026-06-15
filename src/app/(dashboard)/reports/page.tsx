import { type Metadata } from 'next';
import { ReportShareWorkspace } from './report-share-workspace';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = { title: '報告・共有 — PH-OS' };

/**
 * /reports。ビューポート最上部は new_10_report の「報告・共有」ワークスペース
 * (今日書く報告 / 返信待ち / 今日解決した待ち + 右レール)。
 */
export default function ReportsPage() {
  return (
    <PageScaffold variant="bare">
      <div className="xl:min-h-[calc(100vh-4rem)]">
        <ReportShareWorkspace />
      </div>
    </PageScaffold>
  );
}
