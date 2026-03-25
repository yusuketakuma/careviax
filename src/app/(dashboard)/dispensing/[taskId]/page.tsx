import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { DispenseForm } from './dispense-form';

export const metadata: Metadata = {
  title: '調剤入力 — CareViaX',
};

export default async function DispenseTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <Link
          href="/dispensing"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          調剤キューへ戻る
        </Link>
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">調剤入力</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          処方明細を確認して調剤実績を入力してください
        </p>
      </div>

      <div className="mx-auto max-w-3xl">
        <DispenseForm taskId={taskId} />
      </div>
    </div>
  );
}
