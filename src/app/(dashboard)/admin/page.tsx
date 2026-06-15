import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { MasterHubContent } from './master-hub-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'マスター — PH-OS',
};

export default function AdminDashboardPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <MasterHubContent />
      </Suspense>
    </PageScaffold>
  );
}
