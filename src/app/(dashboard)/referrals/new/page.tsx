import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">紹介受付</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          新規患者の紹介情報と患者基本情報をまとめて登録します
        </p>
      </div>

      <div className="mx-auto max-w-2xl">
        <ReferralForm />
      </div>
    </div>
  );
}
