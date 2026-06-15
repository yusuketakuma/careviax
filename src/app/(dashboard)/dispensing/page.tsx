import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { DispenseWorkbench } from './dispense-workbench';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '調剤 — PH-OS',
};

/**
 * /dispensing。ビューポート最上部は new_07_dispense の 3 ペイン調剤ワークベンチ
 * (左キュー / いまの1件 / 右レール)のみを表示する。
 */
export default function DispensingPage() {
  return (
    <PageScaffold variant="bare">
      <div className="rounded-xl border border-border/70 bg-background px-4 py-4 sm:px-6 sm:py-5">
        <Suspense fallback={<Loading />}>
          <DispenseWorkbench />
        </Suspense>
      </div>
    </PageScaffold>
  );
}
