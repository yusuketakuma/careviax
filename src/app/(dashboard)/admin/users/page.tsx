import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { UsersContent } from './users-content';

export const metadata: Metadata = {
  title: 'ユーザー管理 — CareViaX',
};

export default function UsersPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">ユーザー管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          スタッフの招待・権限変更・停止を管理します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <UsersContent />
      </Suspense>
    </div>
  );
}
