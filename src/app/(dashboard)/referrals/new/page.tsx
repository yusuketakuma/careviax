import { Metadata } from 'next';
import { getReferralShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { ReferralForm } from './referral-form';

export const metadata: Metadata = {
  title: '紹介受付 — CareViaX',
};

export default function NewReferralPage() {
  return (
    <div className="p-6">
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        title="紹介受付"
        description="新規患者の紹介情報と患者基本情報をまとめて登録します"
        shortcuts={getReferralShortcutLinks()}
        className="mb-6"
      />

      <div className="mx-auto max-w-2xl">
        <ReferralForm />
      </div>
    </div>
  );
}
