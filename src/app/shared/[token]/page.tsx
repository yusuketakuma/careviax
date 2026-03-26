import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { SharedViewerContent } from './shared-viewer-content';

type SharedViewerPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ otp?: string | string[] }>;
};

export default async function SharedViewerPage(props: SharedViewerPageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const otp = Array.isArray(searchParams.otp) ? searchParams.otp[0] : searchParams.otp;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <Suspense fallback={<Loading />}>
          <SharedViewerContent token={params.token} initialOtp={otp ?? ''} />
        </Suspense>
      </div>
    </div>
  );
}
