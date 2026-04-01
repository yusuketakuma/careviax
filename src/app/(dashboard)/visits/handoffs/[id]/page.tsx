import { Metadata } from 'next';
import { HandoffReviewContent } from './handoff-review-content';

export const metadata: Metadata = {
  title: '申し送り確認 — CareViaX',
};

export default async function HandoffReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <HandoffReviewContent visitRecordId={id} />;
}
