import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { BusinessHolidaysContent } from './business-holidays-content';

export const metadata: Metadata = {
  title: '休日カレンダー — CareViaX',
};

export default function BusinessHolidaysPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">休日カレンダー</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          薬局の休業日・祝日・イベント日を管理します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <BusinessHolidaysContent />
      </Suspense>
    </div>
  );
}
