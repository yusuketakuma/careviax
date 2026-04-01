import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { HandoffBoard } from '@/components/features/handoff/handoff-board';

export const metadata: Metadata = {
  title: '申し送り — CareViaX',
};

export default function HandoffPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          申し送りボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          シフト交代時の申し送り・引き継ぎ事項
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <HandoffBoard />
      </Suspense>
    </div>
  );
}
