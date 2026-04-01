'use client';

import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { QrCode, ArrowRight } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';

type QrDraftMedication = {
  name: string;
  [key: string]: unknown;
};

type QrDraftRow = {
  id: string;
  status: 'pending' | 'confirmed';
  created_at: string;
  scanned_by: string;
  scanned_by_name: string | null;
  patient_id: string | null;
  parsed_data: {
    patient?: {
      name?: string;
    };
    medications?: QrDraftMedication[];
  } | null;
};

const statusConfig: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  pending: { label: '未確認', variant: 'default' },
  confirmed: { label: '確認済', variant: 'secondary' },
};

const columns: ColumnDef<QrDraftRow>[] = [
  {
    id: 'scanned_by',
    header: 'スキャン者',
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.scanned_by_name ?? row.original.scanned_by}
      </span>
    ),
  },
  {
    id: 'patient_name',
    header: '患者名',
    cell: ({ row }) => {
      const name = row.original.parsed_data?.patient?.name;
      const hasPatient = !!row.original.patient_id;
      return (
        <span className={`text-sm ${!hasPatient ? 'text-muted-foreground italic' : ''}`}>
          {name ?? '未照合'}
        </span>
      );
    },
  },
  {
    id: 'medication_count',
    header: '薬剤数',
    cell: ({ row }) => {
      const count = row.original.parsed_data?.medications?.length ?? 0;
      return <span className="text-sm">{count} 品目</span>;
    },
  },
  {
    id: 'created_at',
    header: 'スキャン日時',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {format(parseISO(row.original.created_at), 'MM/dd HH:mm', { locale: ja })}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'ステータス',
    cell: ({ row }) => {
      const config = statusConfig[row.original.status] ?? statusConfig.pending;
      return (
        <Badge variant={config.variant} className="whitespace-nowrap">
          {config.label}
        </Badge>
      );
    },
  },
  {
    id: 'actions',
    header: '操作',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-primary"
        onClick={(e) => {
          e.stopPropagation();
          window.location.href = `/prescriptions/qr-drafts/${row.original.id}`;
        }}
      >
        確認
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Button>
    ),
  },
];

function QrDraftList() {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data, isLoading } = useRealtimeQuery({
    queryKey: ['qr-drafts', orgId],
    queryFn: async () => {
      const res = await fetch('/api/qr-scan-drafts', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('QRスキャン下書きの取得に失敗しました');
      return res.json() as Promise<{ data: QrDraftRow[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
    invalidateOn: ['qr_draft_created', 'qr_draft_confirmed'],
  });

  const drafts = useMemo(() => data?.data ?? [], [data]);

  const handleMoveUp = useCallback(() => {
    setSelectedIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleMoveDown = useCallback(() => {
    setSelectedIndex((prev) => Math.min(Math.max(0, drafts.length - 1), prev + 1));
  }, [drafts.length]);

  const handleSelect = useCallback(() => {
    const draft = drafts[selectedIndex];
    if (draft) router.push(`/prescriptions/qr-drafts/${draft.id}`);
  }, [drafts, selectedIndex, router]);

  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      { key: 'ArrowUp', handler: handleMoveUp, description: '前の行へ移動', scope: 'qr-drafts' },
      { key: 'ArrowDown', handler: handleMoveDown, description: '次の行へ移動', scope: 'qr-drafts' },
      { key: 'Enter', handler: handleSelect, description: '選択した行を開く', scope: 'qr-drafts' },
    ],
    [handleMoveUp, handleMoveDown, handleSelect],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <DataTable
      columns={columns}
      data={drafts}
      isLoading={isBootstrappingOrg || isLoading}
      caption="QRスキャン下書き一覧"
      selectedRowIndex={selectedIndex}
      onRowClick={(index) => {
        setSelectedIndex(index);
        const draft = drafts[index];
        if (draft) router.push(`/prescriptions/qr-drafts/${draft.id}`);
      }}
      emptyMessage="QRスキャンの下書きはありません"
    />
  );
}

export default function QrDraftsPage() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <QrCode className="size-6 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">QRスキャン下書き</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            スタッフがスキャンしたQR処方箋の下書き一覧です
          </p>
        </div>
      </div>

      <QrDraftList />
    </div>
  );
}
