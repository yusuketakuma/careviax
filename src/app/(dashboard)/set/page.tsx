import { Metadata } from 'next';
import { DispensingWorkbench } from '@/components/features/dispense-workbench/dispensing-workbench';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット — PH-OS',
};

/**
 * /set。調剤ワークベンチをセット作成工程（phase="setp"）でマウントする（段階1・モックデータ駆動）。
 */
export default function SetPage() {
  return (
    <PageScaffold variant="bare" className="min-h-0 bg-transparent p-0 sm:p-0 lg:p-0 xl:p-0">
      <h1 className="sr-only">セット</h1>
      <DispensingWorkbench phase="setp" />
    </PageScaffold>
  );
}
