import { Metadata } from 'next';
import { Suspense } from 'react';
import { CardWorkspace } from './card-workspace';
import { PatientDetailTabs } from './patient-detail-tabs';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';

export const metadata: Metadata = {
  title: 'カード — PH-OS',
};

/**
 * /patients/[id] は 2 ビュー構成(docs/design-gap-analysis-new.md 06_card):
 * - 既定: カード = その患者の進行中 RX サイクルの作業台(CardWorkspace)
 * - ?view=profile(または旧来の ?tab= 直リンク): 患者プロフィール = 旧タブ構成(PatientDetailTabs)
 */
export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; tab?: string }>;
}) {
  const [{ id }, { view, tab }] = await Promise.all([params, searchParams]);
  const showProfile = view === 'profile' || Boolean(tab);

  return (
    <PageScaffold>
      <Suspense fallback={<Loading />}>
        {showProfile ? <PatientDetailTabs patientId={id} /> : <CardWorkspace patientId={id} />}
      </Suspense>
    </PageScaffold>
  );
}
