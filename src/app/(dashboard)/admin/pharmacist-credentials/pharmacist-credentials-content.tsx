'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Bell, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type PharmacistCredential = {
  id: string;
  user_name: string;
  certification_type: string;
  certification_number: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  tenure_years: number | null;
  weekly_work_hours: number | null;
};

// --- Helpers ---

function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return <span className="text-xs text-muted-foreground">—</span>;

  const days = differenceInDays(parseISO(expiryDate), new Date());
  const formatted = format(parseISO(expiryDate), 'yyyy/MM/dd', { locale: ja });

  if (days < 0) {
    return (
      <Badge variant="outline" className="flex w-fit items-center gap-1 text-xs text-red-700 border-red-300 bg-red-50">
        <XCircle className="size-3" aria-hidden="true" />
        {formatted}（期限切れ）
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge variant="outline" className="flex w-fit items-center gap-1 text-xs text-red-700 border-red-300 bg-red-50">
        <Bell className="size-3" aria-hidden="true" />
        {formatted}（残{days}日）
      </Badge>
    );
  }
  if (days <= 90) {
    return (
      <Badge variant="outline" className="flex w-fit items-center gap-1 text-xs text-orange-700 border-orange-300 bg-orange-50">
        <Bell className="size-3" aria-hidden="true" />
        {formatted}（残{days}日）
      </Badge>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-green-700">
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      {formatted}
    </span>
  );
}

// --- Sample data ---

const SAMPLE_CREDENTIALS: PharmacistCredential[] = [
  {
    id: '1',
    user_name: '鈴木 一郎',
    certification_type: 'かかりつけ薬剤師研修認定',
    certification_number: 'R2024-001',
    issued_date: '2024-04-01',
    expiry_date: '2026-03-31',
    tenure_years: 3.5,
    weekly_work_hours: 32,
  },
  {
    id: '2',
    user_name: '田中 花子',
    certification_type: 'かかりつけ薬剤師研修認定',
    certification_number: 'R2023-042',
    issued_date: '2023-10-01',
    expiry_date: '2026-05-15',
    tenure_years: 5.2,
    weekly_work_hours: 40,
  },
  {
    id: '3',
    user_name: '山本 次郎',
    certification_type: 'かかりつけ薬剤師研修認定',
    certification_number: null,
    issued_date: null,
    expiry_date: null,
    tenure_years: 1.8,
    weekly_work_hours: 38,
  },
];

// --- Main ---

export function PharmacistCredentialsContent() {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacist-credentials', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/pharmacist-credentials', {
        headers: { 'x-org-id': orgId },
      });
      if (res.status === 404) return { data: SAMPLE_CREDENTIALS };
      if (!res.ok) throw new Error('薬剤師認定情報の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacistCredential[] }>;
    },
    enabled: !!orgId,
  });

  const credentials = data?.data ?? SAMPLE_CREDENTIALS;

  // Alert items
  const alertItems = credentials.filter((c) => {
    if (!c.expiry_date) return false;
    return differenceInDays(parseISO(c.expiry_date), new Date()) <= 90;
  });

  const columns = useMemo<ColumnDef<PharmacistCredential>[]>(
    () => [
      {
        accessorKey: 'user_name',
        header: '薬剤師名',
        cell: ({ row }) => (
          <span className="text-sm font-medium">{row.original.user_name}</span>
        ),
      },
      {
        accessorKey: 'certification_type',
        header: '研修認定種別',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.certification_type}</span>
        ),
      },
      {
        accessorKey: 'certification_number',
        header: '認定番号',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.certification_number ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'expiry_date',
        header: '有効期限',
        cell: ({ row }) => <ExpiryBadge expiryDate={row.original.expiry_date} />,
      },
      {
        accessorKey: 'tenure_years',
        header: '在籍年数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.tenure_years != null
              ? `${row.original.tenure_years.toFixed(1)}年`
              : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'weekly_work_hours',
        header: '週勤務時間',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.weekly_work_hours != null
              ? `${row.original.weekly_work_hours}時間`
              : '—'}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {alertItems.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">認定期限が近い薬剤師がいます</p>
            <ul className="mt-1 list-inside list-disc text-orange-700">
              {alertItems.map((c) => {
                const days = differenceInDays(parseISO(c.expiry_date!), new Date());
                return (
                  <li key={c.id}>
                    {c.user_name} — {days < 0 ? '期限切れ' : `残${days}日`}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">薬剤師一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={credentials}
            isLoading={isLoading}
            caption="薬剤師研修認定一覧"
          />
        </CardContent>
      </Card>
    </div>
  );
}
