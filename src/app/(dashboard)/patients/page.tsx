import { Suspense } from 'react';
import { UserPlus } from 'lucide-react';
import { PatientsTable } from './patients-table';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export default function PatientsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="患者一覧"
        description="在宅訪問管理対象の患者を管理します"
        action={{
          href: '/patients/new',
          label: '新規登録',
          icon: <UserPlus className="size-4" aria-hidden="true" />,
        }}
      >
        <PageShortcutLinks
          links={[
            { href: '/prescriptions', label: '処方受付' },
            { href: '/schedules', label: 'スケジュール' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <PatientsTable />
      </Suspense>
    </div>
  );
}
