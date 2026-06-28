import { Metadata } from 'next';
import { getReferralShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { ReferralForm } from './referral-form';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '紹介受付 — PH-OS',
};

export default function NewReferralPage() {
  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        title="紹介受付"
        description="新規患者の紹介情報と患者基本情報をまとめて登録します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">入力の考え方</p>
            <p className="text-sm text-muted-foreground">
              紹介情報と患者基本情報を一度に整理し、その後の患者登録やケース開始を滑らかにします。
            </p>
          </div>
        }
        shortcuts={getReferralShortcutLinks()}
        className="mb-6"
      />

      <div className="mx-auto max-w-3xl">
        <ReferralForm />
      </div>
    </PageScaffold>
  );
}
