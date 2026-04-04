import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { type Metadata } from 'next';
import { PrescriptionDetailContent } from './prescription-detail-content';

export const metadata: Metadata = {
  title: '処方受付詳細 — CareViaX',
};

export default async function PrescriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<Loading />}>
      <PrescriptionDetailContent intakeId={id} />
    </Suspense>
  );
}
