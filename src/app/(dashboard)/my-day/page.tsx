import type { Metadata } from 'next';
import { getMyDayShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { MyDayContent } from './my-day-content';
import { readMyDayState } from './my-day-query-state';

export const metadata: Metadata = {
  title: 'My Day — CareViaX',
};

type MyDayPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MyDayPage({ searchParams }: MyDayPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readMyDayState(resolvedSearchParams);

  return (
    <PageScaffold stackClassName="[&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent [&>*]:p-0 [&>*]:shadow-none">
      <div className="border-b border-border px-6 py-4">
        <WorkflowPageIntro
          backHref="/dashboard"
          backLabel="ホームへ戻る"
          eyebrow="Today Focus"
          title="My Day"
          description="今日の担当訪問・未完了タスク・未解決課題をまとめて確認"
          supportingContent={
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">最初の 5 秒で見ること</p>
              <p className="text-sm text-muted-foreground">
                今日の担当訪問、未完了タスク、優先対応、移動先の導線をここから確認します。
              </p>
            </div>
          }
          shortcuts={getMyDayShortcutLinks()}
          className="mb-0"
        />
      </div>
      <MyDayContent
        initialFocus={initialState.initialFocus}
        initialVisitFilter={initialState.initialVisitFilter}
        initialTaskFilter={initialState.initialTaskFilter}
        initialContext={initialState.initialContext}
      />
    </PageScaffold>
  );
}
