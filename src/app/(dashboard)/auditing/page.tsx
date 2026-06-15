import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { AuditWorkbench } from './audit-workbench';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '監査 — PH-OS',
};

/**
 * /auditing。ビューポート最上部は new_08_audit の 3 ペイン監査ワークベンチ
 * (私の監査キュー / 二人制バナー+麻薬ダブルカウント / 右レール)のみを表示する。
 */
export default function AuditingPage() {
  return (
    <PageScaffold variant="bare">
      <div className="rounded-xl border border-border/70 bg-background px-4 py-4 sm:px-6 sm:py-5">
        <Suspense fallback={<Loading />}>
          <AuditWorkbench />
        </Suspense>
      </div>
    </PageScaffold>
  );
}
