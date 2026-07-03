'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { platformFetchJson } from '../../platform-fetch';
import { PLATFORM_TENANTS_QUERY_KEY, type PlatformTenant } from '../../tenant-directory-content';
import { AuditLogPanel } from './audit-log-panel';
import { BreakGlassPanel } from './break-glass-panel';
import { DataExplorerPanel } from './data-explorer-panel';

type TenantsResponse = { tenants: PlatformTenant[] };

export function TenantDetailContent({ orgId }: { orgId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: PLATFORM_TENANTS_QUERY_KEY,
    queryFn: () => platformFetchJson<TenantsResponse>('/api/platform/tenants'),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        variant="server"
        title="テナント情報を取得できませんでした"
        description="時間をおいて再試行してください。"
        onRetry={() => refetch()}
      />
    );
  }

  const tenant = data?.tenants.find((t) => t.id === orgId);

  if (!tenant) {
    return (
      <ErrorState
        variant="not-found"
        title="テナントが見つかりません"
        description="指定されたテナントは存在しないか、削除された可能性があります。"
        action={{ label: 'テナント一覧に戻る', href: '/platform' }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/platform"
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          テナント一覧に戻る
        </Link>
        <h1 className="text-xl font-semibold text-foreground">{tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          法人番号: {tenant.corporate_number ?? '—'} ・ メンバー{tenant.member_count}名 ・ 拠点
          {tenant.site_count}件
        </p>
      </div>

      <BreakGlassPanel orgId={orgId} tenantName={tenant.name} />
      <DataExplorerPanel orgId={orgId} />
      <AuditLogPanel orgId={orgId} />
    </div>
  );
}
