'use client';

import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, SortAsc, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PatientCardItem } from './patient-card';
import type { DashboardPatientsResponse } from '@/types/dashboard-home';

async function fetchPatients(
  orgId: string,
  search: string,
  sort: string,
  page: number,
): Promise<DashboardPatientsResponse> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (sort) params.set('sort', sort);
  params.set('page', String(page));

  const res = await fetch(`/api/dashboard/home/patients?${params.toString()}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('患者情報の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

function PatientsSkeleton() {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label="患者カード読み込み中"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function PatientGridSection() {
  const orgId = useOrgId();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'risk' | 'name'>('risk');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim();
  const isBootstrappingOrg = !orgId;

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['dashboard', 'patients', orgId, normalizedSearch, sort, page],
    queryFn: () => fetchPatients(orgId, normalizedSearch, sort, page),
    staleTime: 120_000,
    enabled: !isBootstrappingOrg,
  });

  const totalPages = data ? Math.ceil(data.total / 12) : 1;

  return (
    <Card className="border-border/70 bg-card/95 shadow-none">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" aria-hidden="true" />
            患者一覧
            {data && (
              <span className="text-sm font-normal text-muted-foreground">({data.total}名)</span>
            )}
          </CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="dashboard-patient-search"
                type="search"
                placeholder="患者名で検索..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9 w-44 pl-8"
                aria-label="患者名で検索"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSort(sort === 'risk' ? 'name' : 'risk');
                setPage(1);
              }}
              title={sort === 'risk' ? 'リスク順' : '名前順'}
            >
              <SortAsc className="size-3.5" aria-hidden="true" />
              {sort === 'risk' ? 'リスク順' : '名前順'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {isBootstrappingOrg || isLoading ? (
          <PatientsSkeleton />
        ) : isError ? (
          <ErrorState
            variant="server"
            title="患者カードを取得できません"
            description="患者ホーム API の取得に失敗しました。再試行してください。"
            detail={error instanceof Error ? error.message : undefined}
            action={{ label: '再試行', onClick: () => void refetch() }}
          />
        ) : !data || data.patients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="該当する患者はいません"
            description={
              normalizedSearch
                ? '検索条件を変更してお試しください。'
                : 'アクティブな患者が登録されると、ここにカードが表示されます。'
            }
            action={
              normalizedSearch
                ? { label: '検索をクリア', onClick: () => setSearch('') }
                : { label: '患者一覧を開く', href: '/patients' }
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.patients.map((patient) => (
                <PatientCardItem key={patient.patient_id} patient={patient} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  前へ
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  次へ
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
