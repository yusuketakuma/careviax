import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { MedicationSetsContent } from './medication-sets-content';

export const metadata: Metadata = {
  title: 'セット管理 — CareViaX',
};

export default function MedicationSetsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          セット管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          薬剤セット対象患者の一覧・セットプラン作成・セット鑑査を行います
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <MedicationSetsContent />
      </Suspense>
    </div>
  );
}
