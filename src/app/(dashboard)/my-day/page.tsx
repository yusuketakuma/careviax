import type { Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getMyDayShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { MyDayContent } from './my-day-content';

export const metadata: Metadata = {
  title: 'My Day — CareViaX',
};

export default function MyDayPage() {
  return (
    <div className="space-y-4">
      <div className="border-b border-border px-6 py-4">
        <WorkflowBackLink href="/dashboard" label="ホームへ戻る" className="mb-3" />
        <WorkflowPageHeader
          title="My Day"
          description="今日の担当訪問・未完了タスク・未解決課題をまとめて確認"
          className="mb-0"
        >
          <PageShortcutLinks links={getMyDayShortcutLinks()} />
        </WorkflowPageHeader>
      </div>
      <MyDayContent />
    </div>
  );
}
