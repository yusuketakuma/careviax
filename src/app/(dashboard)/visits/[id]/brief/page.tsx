import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { VisitBriefReviewContent } from './visit-brief-review-content';

export const metadata: Metadata = {
  title: '訪問前まとめを確認 — PH-OS',
};

/** p1_03「訪問前まとめを確認」: 訪問(予定/記録)ID から患者を解決して表示する。 */
export default async function VisitBriefReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageScaffold variant="bare">
      <VisitBriefReviewContent visitId={id} />
    </PageScaffold>
  );
}
