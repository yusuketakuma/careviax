import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { CommunicationRequestsContent } from './requests-content';

export const metadata: Metadata = {
  title: '依頼・照会一覧 — CareViaX',
};

type CommunicationRequestsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

export default async function CommunicationRequestsPage({
  searchParams,
}: CommunicationRequestsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="依頼・照会一覧"
        description="返信待ち・対応中・完了の依頼・照会を管理します"
      >
        <PageShortcutLinks
          links={[
            { href: '/reports', label: '報告書' },
            { href: '/external', label: '外部連携' },
            { href: '/notifications', label: '通知' },
            { href: '/handoff', label: '申し送り' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <CommunicationRequestsContent
          initialStatus={readString(resolvedSearchParams?.status)}
          initialPatientId={readString(resolvedSearchParams?.patient_id)}
          initialRelatedEntityType={readString(resolvedSearchParams?.related_entity_type)}
          initialRelatedEntityId={readString(resolvedSearchParams?.related_entity_id)}
        />
      </Suspense>
    </div>
  );
}
