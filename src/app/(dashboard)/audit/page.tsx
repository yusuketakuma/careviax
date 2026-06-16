import { Metadata } from 'next';
import { DispensingWorkbench } from '@/components/features/dispense-workbench/dispensing-workbench';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '監査 — PH-OS',
};

/**
 * /audit。調剤ワークベンチを監査工程（phase="audit"）でマウントする（段階1・モックデータ駆動）。
 */
export default function AuditPage() {
  return (
    <PageScaffold variant="bare" className="min-h-0 bg-transparent p-0 sm:p-0 lg:p-0 xl:p-0">
      <DispensingWorkbench phase="audit" />
    </PageScaffold>
  );
}
