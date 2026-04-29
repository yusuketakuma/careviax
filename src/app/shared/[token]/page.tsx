import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { QueryProvider } from '@/components/providers/query-provider';
import { Loading } from '@/components/ui/loading';
import { SharedViewerContent } from './shared-viewer-content';

type SharedViewerPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharedViewerPage(props: SharedViewerPageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  if (Object.keys(searchParams).some((key) => key.toLowerCase() === 'otp')) {
    redirect(`/shared/${encodeURIComponent(params.token)}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <QueryProvider>
          <Suspense fallback={<Loading />}>
            <SharedViewerContent token={params.token} />
          </Suspense>
        </QueryProvider>
      </div>
    </div>
  );
}
