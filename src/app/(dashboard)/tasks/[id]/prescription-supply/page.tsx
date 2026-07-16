import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui/loading';
import { PrescriptionSupplyReviewContent } from './prescription-supply-review-content';

export const metadata: Metadata = { title: '処方供給の残数台帳紐づけ — PH-OS' };

export default async function PrescriptionSupplyReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<Loading label="処方供給の確認情報を読み込み中..." />}>
      <PrescriptionSupplyReviewContent taskId={id} />
    </Suspense>
  );
}
