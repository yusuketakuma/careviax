import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { SafetyCheckContent } from './safety-check-content';

export const metadata: Metadata = {
  title: '薬の安全チェック — PH-OS',
};

/**
 * /patients/[id]/safety-check。design/images/P0/p0_32(薬の安全チェック)。
 * 患者文脈で「気になる点 → 確認の流れ → 次にやること」を 1 画面で完結させる。
 */
export default async function SafetyCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading label="薬の安全チェックを読み込み中..." />}>
        <SafetyCheckContent patientId={id} />
      </Suspense>
    </PageScaffold>
  );
}
