import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { CollaborationContent } from './collaboration-content';

export const metadata: Metadata = {
  title: '今だれが見ているか — PH-OS',
};

/**
 * /patients/[id]/collaboration。design/images/P1/p1_13(今だれが見ているか)。
 * 同じカードを同時に見ている人と直近の作業コメントを共有し、上書き事故を防ぐ。
 */
export default async function PatientCollaborationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <CollaborationContent patientId={id} />
      </Suspense>
    </PageScaffold>
  );
}
