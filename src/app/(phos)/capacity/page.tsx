import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { CapacityDashboardClient } from '@/phos/ui/capacity/CapacityDashboardClient';

export default function PhosCapacityPage() {
  return (
    <PageScaffold variant="bare">
      <WorkflowPageHeader
        eyebrow="PH-OS Capacity"
        title="Capacity"
        description="在宅業務の残作業、訪問枠、ボトルネックを管理薬剤師が確認します。"
      />
      <CapacityDashboardClient apiBaseUrl={process.env.NEXT_PUBLIC_PHOS_API_BASE_URL} />
    </PageScaffold>
  );
}
