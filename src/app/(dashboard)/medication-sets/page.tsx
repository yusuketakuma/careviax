import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { SetWorkspace } from './set-workspace';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット — PH-OS',
};

/**
 * /medication-sets。ビューポート最上部は new_09_set のセット準備ワークスペース
 * (施設グルーピング・居室別テーブル・右レール)。
 */
export default function MedicationSetsPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <SetWorkspace />
      </Suspense>
    </PageScaffold>
  );
}
