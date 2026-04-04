import { Suspense } from 'react';
import { UserPlus } from 'lucide-react';
import { PatientsTable } from './patients-table';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PatientsPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Patient Registry"
        title="患者一覧"
        description="同意不足、高リスク、初回予定を先に見つけて、患者詳細や処方受付へつなげる一覧です。"
        action={{
          href: '/patients/new',
          label: '新規登録',
          icon: <UserPlus className="size-4" aria-hidden="true" />,
        }}
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              リスク、ケース状態、同意不足を上段で絞り込み、そのまま患者詳細や訪問準備へ進めます。
            </p>
          </div>
        }
        childrenLabel="関連導線"
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
    </PageScaffold>
  );
}
