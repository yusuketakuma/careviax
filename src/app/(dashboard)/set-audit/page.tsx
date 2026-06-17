import { Metadata } from 'next';
import { DispensingWorkbench } from '@/components/features/dispense-workbench/dispensing-workbench';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット監査 — PH-OS',
};

/**
 * /set-audit。調剤ワークベンチをセット監査工程（phase="seta"）でマウントする（段階1・モックデータ駆動）。
 */
export default function SetAuditPage() {
  return (
    <PageScaffold variant="bare" className="min-h-0 bg-transparent p-0 sm:p-0 lg:p-0 xl:p-0">
      <h1 className="sr-only">セット監査</h1>
      <DispensingWorkbench phase="seta" />
    </PageScaffold>
  );
}
