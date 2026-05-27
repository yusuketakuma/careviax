import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { NotificationsContent } from './notifications-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readNotificationsState } from './notifications-query-state';

export const metadata: Metadata = {
  title: '通知 — PH-OS',
};

type NotificationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readNotificationsState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Notifications"
        title="通知"
        description="未読・既読の通知一覧"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              未読通知から優先対応を見つけ、必要に応じてタスクや外部連携画面へ移動します。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/tasks', label: 'タスク' },
            { href: '/admin/notification-settings', label: '通知設定' },
            { href: '/external', label: '外部連携' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <NotificationsContent
          initialTab={initialState.initialTab}
          initialTypeFilter={initialState.initialTypeFilter}
          initialContext={initialState.initialContext}
        />
      </Suspense>
    </PageScaffold>
  );
}
