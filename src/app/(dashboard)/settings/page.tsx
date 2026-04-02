import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getSettingsShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { SettingsContent } from './settings-content';

export default function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <WorkflowPageHeader
        title="ユーザー設定"
        description="プロフィール、通知、セッション、位置情報の個人設定を管理します。"
        className="mb-0"
      >
        <PageShortcutLinks links={getSettingsShortcutLinks()} />
      </WorkflowPageHeader>

      <SettingsContent />
    </div>
  );
}
