'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, differenceInYears } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Archive, Search } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PatientRow = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
  cases: Array<{
    id: string;
    status: string;
    updated_at: string;
  }>;
};

const caseStatusLabel: Record<string, string> = {
  referral_received: '紹介受領',
  assessment: 'アセスメント',
  active: '稼働中',
  on_hold: '保留',
  discharged: '終了',
  terminated: '解約',
};

const caseStatusVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  referral_received: 'secondary',
  assessment: 'secondary',
  active: 'default',
  on_hold: 'outline',
  discharged: 'outline',
  terminated: 'destructive',
};

const genderLabel: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

const columns: ColumnDef<PatientRow>[] = [
  {
    accessorKey: 'name',
    header: '氏名',
    cell: ({ row }) => (
      <Link
        href={`/patients/${row.original.id}`}
        className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: 'name_kana',
    header: 'フリガナ',
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.name_kana}</span>
    ),
  },
  {
    accessorKey: 'birth_date',
    header: '生年月日',
    cell: ({ row }) => {
      const date = parseISO(row.original.birth_date);
      const age = differenceInYears(new Date(), date);
      return (
        <span>
          {format(date, 'yyyy/MM/dd', { locale: ja })}
          <span className="ml-1.5 text-muted-foreground text-xs">({age}歳)</span>
        </span>
      );
    },
  },
  {
    accessorKey: 'gender',
    header: '性別',
    cell: ({ row }) => genderLabel[row.original.gender] ?? row.original.gender,
  },
  {
    id: 'caseStatus',
    header: 'ケース状態',
    cell: ({ row }) => {
      const latestCase = row.original.cases[0];
      if (!latestCase) return <span className="text-muted-foreground">—</span>;
      return (
        <Badge variant={caseStatusVariant[latestCase.status] ?? 'outline'}>
          {caseStatusLabel[latestCase.status] ?? latestCase.status}
        </Badge>
      );
    },
  },
  {
    id: 'lastVisit',
    header: '最終更新',
    cell: ({ row }) => {
      const latestCase = row.original.cases[0];
      if (!latestCase) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="text-muted-foreground text-sm">
          {format(parseISO(latestCase.updated_at), 'yyyy/MM/dd', { locale: ja })}
        </span>
      );
    },
  },
];

export function PatientsTable() {
  const orgId = useOrgId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPatients, setSelectedPatients] = useState<PatientRow[]>([]);
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['patients', orgId],
    queryFn: async () => {
      const res = await fetch('/api/patients?limit=500', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者一覧の取得に失敗しました');
      return res.json() as Promise<{ data: PatientRow[] }>;
    },
    enabled: !!orgId,
  });

  const bulkExportMutation = useMutation({
    mutationFn: async (patientIds: string[]) => {
      const res = await fetch('/api/patients/medications/bulk-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          patient_ids: patientIds,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          payload?.message ?? '薬歴 PDF 一括出力のキュー登録に失敗しました'
        );
      }
      return payload as {
        data: {
          jobId: string;
          queuePosition: number;
          patientCount: number;
          startedImmediately?: boolean;
        };
      };
    },
    onSuccess: (payload) => {
      setExportFeedback({
        type: 'success',
        message: payload.data.startedImmediately
          ? `${payload.data.patientCount}名分の薬歴 PDF 出力を開始しました。完了すると通知から ZIP を開けます。`
          : `${payload.data.patientCount}名分の薬歴 PDF をキュー登録しました。完了すると通知から ZIP を開けます。`,
      });
    },
    onError: (cause) => {
      setExportFeedback({
        type: 'error',
        message: cause instanceof Error ? cause.message : '一括出力に失敗しました',
      });
    },
  });

  const filtered = useMemo(() => {
    const patients = data?.data ?? [];
    if (!searchQuery.trim()) return patients;
    const q = searchQuery.trim().toLowerCase();
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.name_kana.toLowerCase().includes(q)
    );
  }, [data, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="氏名・フリガナで検索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
            aria-label="患者検索"
          />
        </div>
        <LoadingButton
          type="button"
          variant="outline"
          className="shrink-0"
          loading={bulkExportMutation.isPending}
          loadingLabel="ZIP生成をキュー登録中..."
          disabled={selectedPatients.length === 0}
          onClick={() => bulkExportMutation.mutate(selectedPatients.map((patient) => patient.id))}
        >
          <Archive className="size-4" aria-hidden="true" />
          薬歴PDFを一括出力
        </LoadingButton>
      </div>

      {exportFeedback ? (
        <div
          className={
            exportFeedback.type === 'success'
              ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'
              : 'rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive'
          }
        >
          {exportFeedback.message}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        caption="患者一覧"
        enableRowSelection
        getRowId={(row) => row.id}
        onSelectionChange={(rows) => {
          setSelectedPatients(rows);
          setExportFeedback(null);
        }}
      />
    </div>
  );
}
