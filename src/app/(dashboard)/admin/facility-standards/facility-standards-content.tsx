'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, XCircle, Bell } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type FacilityStandard = {
  id: string;
  standard_type: string;
  filed_date: string;
  effective_date: string | null;
  expiry_date: string | null;
  renewal_alert_date: string | null;
  requirements_status: Record<string, boolean> | null;
  claim_status: 'claimable' | 'blocked' | 'unknown';
};

// --- Helpers ---

function getRequirementBadge(status: Record<string, boolean> | null) {
  if (!status) {
    return <Badge variant="outline" className="text-xs text-muted-foreground">未確認</Badge>;
  }
  const values = Object.values(status);
  const allMet = values.every(Boolean);
  const noneMet = values.every((v) => !v);

  if (allMet) {
    return (
      <Badge variant="outline" className="flex w-fit items-center gap-1 text-xs text-green-700 border-green-300 bg-green-50">
        <CheckCircle2 className="size-3" aria-hidden="true" /> 充足
      </Badge>
    );
  }
  if (noneMet) {
    return (
      <Badge variant="outline" className="flex w-fit items-center gap-1 text-xs text-red-700 border-red-300 bg-red-50">
        <XCircle className="size-3" aria-hidden="true" /> 不足
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="flex w-fit items-center gap-1 text-xs text-orange-700 border-orange-300 bg-orange-50">
      <AlertTriangle className="size-3" aria-hidden="true" /> 一部不足
    </Badge>
  );
}

function ExpiryCell({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return <span className="text-xs text-muted-foreground">—</span>;

  const days = differenceInDays(parseISO(expiryDate), new Date());
  const formatted = format(parseISO(expiryDate), 'yyyy/MM/dd', { locale: ja });

  if (days < 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700">
        <XCircle className="size-3.5" aria-hidden="true" />
        {formatted}（期限切れ）
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700">
        <Bell className="size-3.5" aria-hidden="true" />
        {formatted}（残{days}日）
      </span>
    );
  }
  if (days <= 90) {
    return (
      <span className="flex items-center gap-1 text-xs text-orange-700">
        <Bell className="size-3.5" aria-hidden="true" />
        {formatted}（残{days}日）
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{formatted}</span>;
}

function ClaimStatusBadge({ status }: { status: FacilityStandard['claim_status'] }) {
  if (status === 'claimable') {
    return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">算定可</Badge>;
  }
  if (status === 'blocked') {
    return <Badge variant="destructive">算定不可</Badge>;
  }
  return <Badge variant="outline">判定待ち</Badge>;
}

// --- Main ---

export function FacilityStandardsContent() {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['facility-standards', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/facility-standards', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('施設基準の取得に失敗しました');
      return res.json() as Promise<{ data: FacilityStandard[] }>;
    },
    enabled: !!orgId,
  });

  const standards = data?.data ?? [];

  // Alerts: expiry within 90 days
  const alertItems = standards.filter((s) => {
    if (!s.expiry_date) return false;
    const days = differenceInDays(parseISO(s.expiry_date), new Date());
    return days <= 90;
  });

  const columns = useMemo<ColumnDef<FacilityStandard>[]>(
    () => [
      {
        accessorKey: 'standard_type',
        header: '届出種別',
        cell: ({ row }) => (
          <span className="text-sm font-medium">{row.original.standard_type}</span>
        ),
      },
      {
        accessorKey: 'filed_date',
        header: '届出日',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {format(parseISO(row.original.filed_date), 'yyyy/MM/dd', { locale: ja })}
          </span>
        ),
      },
      {
        id: 'requirements',
        header: '要件充足',
        cell: ({ row }) => getRequirementBadge(row.original.requirements_status),
      },
      {
        accessorKey: 'expiry_date',
        header: '有効期限',
        cell: ({ row }) => <ExpiryCell expiryDate={row.original.expiry_date} />,
      },
      {
        accessorKey: 'claim_status',
        header: '算定可否',
        cell: ({ row }) => <ClaimStatusBadge status={row.original.claim_status} />,
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {/* Alert banner */}
      {(alertItems.length > 0 || standards.some((item) => item.claim_status === 'blocked')) && (
        <div className="flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">更新期限または要件未達の届出があります</p>
            <ul className="mt-1 list-inside list-disc text-orange-700">
              {standards
                .filter((item) => item.claim_status === 'blocked')
                .map((item) => (
                  <li key={`${item.id}:blocked`}>
                    {item.standard_type} — 要件未達のため加算算定不可
                  </li>
                ))}
              {alertItems.map((s) => {
                const days = differenceInDays(parseISO(s.expiry_date!), new Date());
                return (
                  <li key={s.id}>
                    {s.standard_type} — {days < 0 ? '期限切れ' : `残${days}日`}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">届出一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={standards}
            isLoading={isLoading}
            caption="施設基準届出一覧"
          />
        </CardContent>
      </Card>
    </div>
  );
}
