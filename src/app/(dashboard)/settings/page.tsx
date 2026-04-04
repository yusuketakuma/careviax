import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getSettingsShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { SettingsContent } from './settings-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function SettingsPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="User Settings"
        title="ユーザー設定"
        description="プロフィール、通知、セッション、位置情報の個人設定を管理します。"
        className="mb-0"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">設定の見方</p>
            <p className="text-sm text-muted-foreground">
              個人設定だけに絞り、通知、セッション、位置情報を用途ごとに整理して見られるようにします。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks links={getSettingsShortcutLinks()} />
      </WorkflowPageHeader>

      <SettingsContent />
    </PageScaffold>
  );
}
