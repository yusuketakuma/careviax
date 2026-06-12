import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { CompareBoard } from './compare-board';
import { parseComparePatientsParam } from './compare-card-helpers';

export const metadata: Metadata = {
  title: '複数カードを並べて確認 — PH-OS',
};

/**
 * /patients/compare(design/images/P1 p1_02_multi_card_split_workspace):
 * 複数カード(処方サイクル)のプレビューを最大 3 枚並べて確認する。
 * ?patients=id1,id2,id3 で対象を指定。未指定時は患者カード一覧から
 * 「注目すべきカード 3 枚」(最優先 + 返信待ち + 止まっている患者)を導出する。
 */
export default async function PatientsComparePage({
  searchParams,
}: {
  searchParams: Promise<{ patients?: string }>;
}) {
  const { patients } = await searchParams;

  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <CompareBoard requestedPatientIds={parseComparePatientsParam(patients)} />
      </Suspense>
    </PageScaffold>
  );
}
