import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { ConferencesContent } from './conferences-content';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'カンファレンス — CareViaX',
};

export default function ConferencesPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Conference Notes"
        title="カンファレンスノート"
        description="多職種カンファレンスの記録・アクションアイテム管理"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              未完了アクション、共有が必要な論点、関連する報告や提案導線を先に整理します。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/reports', label: '報告書' },
            { href: '/external', label: '外部連携' },
            { href: '/billing/candidates', label: '請求候補' },
            { href: '/schedules/proposals', label: '提案一覧' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <ConferencesContent />
      </Suspense>
    </PageScaffold>
  );
}
