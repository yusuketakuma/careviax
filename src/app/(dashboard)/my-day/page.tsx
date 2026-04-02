import type { Metadata } from 'next';
import { getMyDayShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { MyDayContent } from './my-day-content';

export const metadata: Metadata = {
  title: 'My Day — CareViaX',
};

export default function MyDayPage() {
  return (
    <div className="space-y-4">
      <div className="border-b border-border px-6 py-4">
        <WorkflowPageIntro
          backHref="/dashboard"
          backLabel="ホームへ戻る"
          title="My Day"
          description="今日の担当訪問・未完了タスク・未解決課題をまとめて確認"
          shortcuts={getMyDayShortcutLinks()}
          className="mb-0"
        />
      </div>
      <MyDayContent />
    </div>
  );
}
