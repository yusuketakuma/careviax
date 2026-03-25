import { Suspense } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { PatientsTable } from './patients-table';
import { Loading } from '@/components/ui/loading';

export default function PatientsPage() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">患者一覧</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            在宅訪問管理対象の患者を管理します
          </p>
        </div>
        <Link
          href="/patients/new"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <UserPlus className="size-4" aria-hidden="true" />
          新規登録
        </Link>
      </div>

      <Suspense fallback={<Loading />}>
        <PatientsTable />
      </Suspense>
    </div>
  );
}
