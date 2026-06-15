import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { OperationalPolicyContent } from './operational-policy-content';

export const metadata: Metadata = {
  title: '設定 — PH-OS',
};

export default function SettingsPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <OperationalPolicyContent />
      </Suspense>
    </PageScaffold>
  );
}
