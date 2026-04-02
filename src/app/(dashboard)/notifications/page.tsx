import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { NotificationsContent } from './notifications-content';

export const metadata: Metadata = {
  title: '通知 — CareViaX',
};

export default function NotificationsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="通知"
        description="未読・既読の通知一覧"
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
        <NotificationsContent />
      </Suspense>
    </div>
  );
}
