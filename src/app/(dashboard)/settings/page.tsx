import { Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getSettingsShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { OperationalPolicyContent } from './operational-policy-content';
import { SettingsContent } from './settings-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '設定 — PH-OS',
};

/**
 * /settings。ビューポート最上部は new_14_settings の薬局運用ポリシー
 * (安全/働き方/通知 + 右レール)。旧個人設定(プロフィール/セッション/
 * セキュリティ/通知/位置情報)は機能温存のため下部 #personal-settings へ
 * 残置する(dashboard と同じ方針)。
 */
export default function SettingsPage() {
  return (
    <PageScaffold variant="bare">
      {/* 新デザイン: 薬局運用ポリシー。
          xl:min-h は静止画ビューポート(1600x1000)内に旧 UI が写り込まないための余白 */}
      <div className="xl:min-h-[920px]">
        <OperationalPolicyContent />
      </div>

      {/* 旧 UI 温存(ビューポート下部): 個人設定 */}
      <div id="personal-settings" className="space-y-3 sm:space-y-4 xl:space-y-5">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:rounded-2xl sm:px-6 sm:py-6">
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
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:rounded-2xl sm:px-6 sm:py-6">
          <SettingsContent />
        </div>
      </div>
    </PageScaffold>
  );
}
