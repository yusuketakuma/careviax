'use client';

import Link from 'next/link';
import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { QrCode, ArrowRight } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import {
  useKeyboardShortcuts,
  type ShortcutDefinition,
} from '@/components/features/keyboard/use-keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { PageScaffold } from '@/components/layout/page-scaffold';

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
      <span className="text-sm">{row.original.scanned_by_name ?? row.original.scanned_by}</span>
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
      <Link
        href={`/prescriptions/qr-drafts/${row.original.id}`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1 text-primary')}
        onClick={(event) => event.stopPropagation()}
      >
        確認
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    ),
  },
];

function QrDraftList() {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterMode, setFilterMode] = useState<'all' | 'unmatched'>('all');

  const { data: allData, isLoading: allLoading } = useRealtimeQuery({
    queryKey: ['qr-drafts', orgId, 'all'],
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

  const { data: unmatchedData } = useRealtimeQuery({
    queryKey: ['qr-drafts', orgId, 'unmatched'],
    queryFn: async () => {
      const res = await fetch('/api/qr-scan-drafts?unmatched=true', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('QRスキャン下書きの取得に失敗しました');
      return res.json() as Promise<{ data: QrDraftRow[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
    invalidateOn: ['qr_draft_created', 'qr_draft_confirmed'],
  });

  const isLoading = allLoading;
  const drafts = useMemo(
    () => (filterMode === 'unmatched' ? (unmatchedData?.data ?? []) : (allData?.data ?? [])),
    [filterMode, allData, unmatchedData],
  );
  const unmatchedCount = unmatchedData?.data.length ?? 0;

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
      {
        key: 'ArrowDown',
        handler: handleMoveDown,
        description: '次の行へ移動',
        scope: 'qr-drafts',
      },
      { key: 'Enter', handler: handleSelect, description: '選択した行を開く', scope: 'qr-drafts' },
    ],
    [handleMoveUp, handleMoveDown, handleSelect],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setFilterMode('all'); setSelectedIndex(0); }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            filterMode === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background text-foreground hover:bg-accent'
          }`}
        >
          全て
        </button>
        <button
          type="button"
          onClick={() => { setFilterMode('unmatched'); setSelectedIndex(0); }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            filterMode === 'unmatched'
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background text-foreground hover:bg-accent'
          }`}
        >
          未照合
          {unmatchedCount > 0 && (
            <span className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
              filterMode === 'unmatched' ? 'bg-primary-foreground text-primary' : 'bg-amber-100 text-amber-800'
            }`}>
              {unmatchedCount}
            </span>
          )}
        </button>
      </div>
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
        emptyMessage={filterMode === 'unmatched' ? '未照合の下書きはありません' : 'QRスキャンの下書きはありません'}
      />
    </div>
  );
}

export default function QrDraftsPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="QR Drafts"
        title="QRスキャン下書き"
        description="スタッフがスキャンしたQR処方箋の下書き一覧です"
        action={{
          href: '/qr-scan',
          label: 'QRスキャンへ',
          icon: <QrCode className="size-4" aria-hidden="true" />,
        }}
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              未確認の下書きを先に見つけ、患者照合と受付確定へつなげます。
            </p>
          </div>
        }
        mainWorkflowSteps={['prescriptions']}
        mainWorkflowDescription="QR 下書き一覧は処方登録工程の前段支援として扱い、受付確定へ戻る位置関係を固定表示します。"
      >
        <PageShortcutLinks
          links={[
            { href: '/prescriptions', label: '処方受付' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>

      <QrDraftList />
    </PageScaffold>
  );
}
