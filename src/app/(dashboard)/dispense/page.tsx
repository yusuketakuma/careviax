import { Metadata } from 'next';
import { DispensingWorkbench } from '@/components/features/dispense-workbench/dispensing-workbench';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '調剤 — PH-OS',
};

/**
 * /dispense。レセコン風の調剤ワークベンチ（段階1・モックデータ駆動）を全面マウントする。
 * PageScaffold variant="bare" + 外側 padding/min-h の中和で、ワークベンチ自身の
 * .rootInShell（ヘッダ高 3.5rem 控除の 100vh レイアウト）をそのまま使う。
 */
export default function DispensePage() {
  return (
    <PageScaffold variant="bare" className="min-h-0 bg-transparent p-0 sm:p-0 lg:p-0 xl:p-0">
      <h1 className="sr-only">調剤</h1>
      <DispensingWorkbench phase="dispense" />
    </PageScaffold>
  );
}
