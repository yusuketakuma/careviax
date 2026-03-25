import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { NotificationsContent } from './notifications-content';

export const metadata: Metadata = {
  title: '通知 — CareViaX',
};

export default function NotificationsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">通知</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          未読・既読の通知一覧
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <NotificationsContent />
      </Suspense>
    </div>
  );
}
