import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getReferralShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { ReferralForm } from './referral-form';

export const metadata: Metadata = {
  title: '紹介受付 — CareViaX',
};

export default function NewReferralPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/patients"
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          患者一覧へ戻る
        </Link>
        <WorkflowPageHeader
          title="紹介受付"
          description="新規患者の紹介情報と患者基本情報をまとめて登録します"
          className="mb-0 mt-2"
        >
          <PageShortcutLinks links={getReferralShortcutLinks()} />
        </WorkflowPageHeader>
      </div>

      <div className="mx-auto max-w-2xl">
        <ReferralForm />
      </div>
    </div>
  );
}
