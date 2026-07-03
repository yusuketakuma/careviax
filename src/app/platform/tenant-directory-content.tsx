'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { PageSection } from '@/components/layout/page-section';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { StateBadge } from '@/components/ui/state-badge';
import { formatDateLabel } from '@/lib/ui/date-format';
import { platformFetchJson } from './platform-fetch';
import { useRemainingMinutesLabel } from './use-remaining-minutes-label';

export type PlatformTenant = {
  id: string;
  name: string;
  corporate_number: string | null;
  created_at: string;
  member_count: number;
  site_count: number;
  active_break_glass: { id: string; expires_at: string; scope: 'read_only' | 'read_write' } | null;
};

type TenantsResponse = { tenants: PlatformTenant[] };

export const PLATFORM_TENANTS_QUERY_KEY = ['platform-tenants'] as const;

function BreakGlassStatusCell({
  activeBreakGlass,
}: {
  activeBreakGlass: PlatformTenant['active_break_glass'];
}) {
  const remainingLabel = useRemainingMinutesLabel(activeBreakGlass?.expires_at ?? '');
  if (!activeBreakGlass) {
    return <span className="text-xs text-muted-foreground">未アクセス</span>;
  }
  const isReadWrite = activeBreakGlass.scope === 'read_write';
  return (
    <StateBadge role={isReadWrite ? 'hazard' : 'readonly'}>
      {isReadWrite ? `アクセス中・書込可（${remainingLabel}）` : `アクセス中（${remainingLabel}）`}
    </StateBadge>
  );
}

export function TenantDirectoryContent() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: PLATFORM_TENANTS_QUERY_KEY,
    queryFn: () => platformFetchJson<TenantsResponse>('/api/platform/tenants'),
  });

  const tenants = data?.tenants ?? [];

  const columns: ColumnDef<PlatformTenant>[] = [
    {
      accessorKey: 'name',
      header: '名称',
      cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: 'corporate_number',
      header: '法人番号',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.corporate_number ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'member_count',
      header: 'メンバー数',
      cell: ({ row }) => <span className="tabular-nums">{row.original.member_count}</span>,
      meta: { mobileLabel: 'メンバー数' },
    },
    {
      accessorKey: 'site_count',
      header: '拠点数',
      cell: ({ row }) => <span className="tabular-nums">{row.original.site_count}</span>,
      meta: { mobileLabel: '拠点数' },
    },
    {
      id: 'break_glass_status',
      header: 'ブレークグラス状態',
      cell: ({ row }) => (
        <BreakGlassStatusCell activeBreakGlass={row.original.active_break_glass} />
      ),
      meta: { mobileLabel: 'ブレークグラス状態' },
    },
    {
      accessorKey: 'created_at',
      header: '登録日',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDateLabel(row.original.created_at)}
        </span>
      ),
      meta: { tabletHidden: true },
    },
  ];

  return (
    <div className="space-y-4">
      <PageSection
        title="テナントディレクトリ"
        description="全テナントの一覧です。行を選択すると、テナント別のブレークグラス起動・データエクスプローラ・監査ログへ進みます。"
        headingLevel={2}
      >
        {isError ? (
          <ErrorState
            variant="server"
            title="テナント一覧を取得できませんでした"
            description="時間をおいて再試行してください。解消しない場合はシステム管理者に連絡してください。"
            onRetry={() => refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={tenants}
            isLoading={isLoading}
            caption="テナント一覧"
            emptyMessage="登録されているテナントがありません"
            onRowClick={(index) => {
              const tenant = tenants[index];
              if (tenant) router.push(`/platform/tenants/${tenant.id}`);
            }}
            getRowA11yLabel={(row) => row.name}
            toolbar={{
              enableGlobalFilter: true,
              globalFilterPlaceholder: 'テナント名・法人番号で絞り込み',
            }}
          />
        )}
      </PageSection>
    </div>
  );
}
