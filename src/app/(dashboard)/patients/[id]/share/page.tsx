import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { ExternalShareContent } from './external-share-content';

export const metadata: Metadata = {
  title: '外部共有 — CareViaX',
};

export default async function ExternalSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/patients/${id}`}
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          患者詳細へ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          外部共有
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          医療情報の一時共有リンクを発行します（JWT + OTP）
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <ExternalShareContent patientId={id} />
      </Suspense>
    </div>
  );
}
