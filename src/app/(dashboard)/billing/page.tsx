import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { BillingCheckContent } from './billing-check-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '算定チェック — PH-OS',
};

/**
 * /billing。ビューポート最上部は new 11_billing の算定チェック
 * (BillingCheckContent: 3 KPI + 疑義テーブル + 右レール 3 点セット)。
 */
export default function BillingPage() {
  return (
    <PageScaffold variant="bare">
      <h1 className="sr-only">算定チェック</h1>
      <Suspense fallback={<Loading />}>
        <BillingCheckContent />
      </Suspense>
    </PageScaffold>
  );
}
