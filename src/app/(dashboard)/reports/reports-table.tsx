'use client';

import { type ReactNode, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  CHANNEL_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
} from '@/lib/constants/status-labels';

type DeliveryRecord = {
  id: string;
  channel: string;
  recipient_name: string;
  status: string;
  sent_at: string | null;
};

type CareReport = {
  id: string;
  patient_id: string;
  patient_name: string | null;
  report_type: string;
  status: string;
  created_at: string;
  latest_delivery_status: string | null;
  latest_delivery_recipient_name: string | null;
  latest_delivery_sent_at: string | null;
  failed_delivery_count: number;
  pending_delivery_count: number;
  delivery_records: DeliveryRecord[];
};

type CareReportsResponse = {
  data: CareReport[];
  deliverySummary: {
    pending_delivery_count: number;
    failed_delivery_count: number;
    by_status: Record<string, number>;
  };
};

const ALL_VALUE = '_all';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

function buildColumns(): ColumnDef<CareReport>[] {
  return [
    {
      accessorKey: 'report_type',
      header: '報告書',
      meta: {
        label: '報告書',
        exportValue: (row: CareReport) =>
          REPORT_TYPE_LABELS[row.report_type] ?? row.report_type,
      },
      cell: ({ row }) => (
        <Link
          href={`/reports/${row.original.id}`}
          className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {REPORT_TYPE_LABELS[row.original.report_type] ?? row.original.report_type}
        </Link>
      ),
    },
    {
      accessorKey: 'patient_name',
      header: '患者',
      meta: {
        label: '患者',
        exportValue: (row: CareReport) => row.patient_name ?? row.patient_id,
      },
      cell: ({ row }) => (
        <div className="space-y-1">
          <p>{row.original.patient_name ?? '患者名未設定'}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.original.patient_id}</p>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: '報告状態',
      meta: {
        label: '報告状態',
        exportValue: (row: CareReport) =>
          REPORT_STATUS_CONFIG[row.status]?.label ?? row.status,
      },
      cell: ({ row }) => {
        const cfg = REPORT_STATUS_CONFIG[row.original.status];
        return cfg ? <Badge variant={cfg.variant}>{cfg.label}</Badge> : row.original.status;
      },
    },
    {
      accessorKey: 'latest_delivery_status',
      header: '送達状態',
      meta: {
        label: '送達状態',
        exportValue: (row: CareReport) =>
          row.latest_delivery_status
            ? (REPORT_STATUS_CONFIG[row.latest_delivery_status]?.label ?? row.latest_delivery_status)
            : '—',
      },
      cell: ({ row }) => {
        if (!row.original.latest_delivery_status) {
          return <span className="text-muted-foreground">—</span>;
        }
        const cfg = REPORT_STATUS_CONFIG[row.original.latest_delivery_status];
        return cfg ? <Badge variant={cfg.variant}>{cfg.label}</Badge> : row.original.latest_delivery_status;
      },
    },
    {
      accessorKey: 'latest_delivery_recipient_name',
      header: '送付先',
      meta: {
        label: '送付先',
        tabletHidden: true,
      },
      cell: ({ row }) => row.original.latest_delivery_recipient_name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'latest_delivery_sent_at',
      header: '送付日',
      meta: {
        label: '送付日',
        exportValue: (row: CareReport) => formatDate(row.latest_delivery_sent_at),
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.latest_delivery_sent_at)}
        </span>
      ),
    },
    {
      id: 'channel',
      header: 'チャネル',
      meta: {
        label: 'チャネル',
        tabletHidden: true,
        exportValue: (row: CareReport) =>
          row.delivery_records[0]
            ? (CHANNEL_LABELS[row.delivery_records[0].channel] ?? row.delivery_records[0].channel)
            : '—',
      },
      cell: ({ row }) => {
        const latestDelivery = row.original.delivery_records[0];
        return latestDelivery ? (
          <Badge variant="outline">
            {CHANNEL_LABELS[latestDelivery.channel] ?? latestDelivery.channel}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: 'created_at',
      header: '作成日',
      meta: {
        label: '作成日',
        exportValue: (row: CareReport) => formatDate(row.created_at),
      },
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
  ];
}

function renderExpandedRow(row: Row<CareReport>) {
  if (row.original.delivery_records.length === 0) {
    return <p className="text-sm text-muted-foreground">送達履歴はまだありません。</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">失敗 {row.original.failed_delivery_count}件</Badge>
        <Badge variant="outline">返信待ち {row.original.pending_delivery_count}件</Badge>
      </div>
      <ol className="space-y-2">
        {row.original.delivery_records.map((record) => {
          const cfg = REPORT_STATUS_CONFIG[record.status];
          return (
            <li
              key={record.id}
              className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">{record.recipient_name}</p>
                <p className="text-xs text-muted-foreground">
                  {CHANNEL_LABELS[record.channel] ?? record.channel} / {formatDate(record.sent_at)}
                </p>
              </div>
              {cfg ? <Badge variant={cfg.variant}>{cfg.label}</Badge> : <Badge variant="outline">{record.status}</Badge>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ReportsTable() {
  const orgId = useOrgId();
  const columns = useMemo(() => buildColumns(), []);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE);
  const [reportTypeFilter, setReportTypeFilter] = useState<string>(ALL_VALUE);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>(ALL_VALUE);
  const [patientQuery, setPatientQuery] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sentFrom, setSentFrom] = useState('');
  const [sentTo, setSentTo] = useState('');

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (statusFilter !== ALL_VALUE) params.set('status', statusFilter);
    if (reportTypeFilter !== ALL_VALUE) params.set('report_type', reportTypeFilter);
    if (deliveryStatusFilter !== ALL_VALUE) params.set('delivery_status', deliveryStatusFilter);
    if (patientQuery.trim()) params.set('q', patientQuery.trim());
    if (recipientQuery.trim()) params.set('recipient', recipientQuery.trim());
    if (keywordQuery.trim()) params.set('keyword', keywordQuery.trim());
    if (createdFrom) params.set('date_from', createdFrom);
    if (createdTo) params.set('date_to', createdTo);
    if (sentFrom) params.set('sent_from', sentFrom);
    if (sentTo) params.set('sent_to', sentTo);
    return params.toString();
  }, [
    createdFrom,
    createdTo,
    deliveryStatusFilter,
    keywordQuery,
    patientQuery,
    recipientQuery,
    reportTypeFilter,
    sentFrom,
    sentTo,
    statusFilter,
  ]);

  const { data, isLoading } = useQuery({
    queryKey: ['care-reports', orgId, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/care-reports?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書一覧の取得に失敗しました');
      return res.json() as Promise<CareReportsResponse>;
    },
    enabled: !!orgId,
  });

  const activeFilterCount = [
    statusFilter !== ALL_VALUE ? statusFilter : '',
    reportTypeFilter !== ALL_VALUE ? reportTypeFilter : '',
    deliveryStatusFilter !== ALL_VALUE ? deliveryStatusFilter : '',
    patientQuery.trim(),
    recipientQuery.trim(),
    keywordQuery.trim(),
    createdFrom,
    createdTo,
    sentFrom,
    sentTo,
  ].filter(Boolean).length;

  function resetFilters() {
    setStatusFilter(ALL_VALUE);
    setReportTypeFilter(ALL_VALUE);
    setDeliveryStatusFilter(ALL_VALUE);
    setPatientQuery('');
    setRecipientQuery('');
    setKeywordQuery('');
    setCreatedFrom('');
    setCreatedTo('');
    setSentFrom('');
    setSentTo('');
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-border/70 bg-card/80 p-4 lg:grid-cols-5 xl:grid-cols-6">
        <div className="space-y-1.5 lg:col-span-2">
          <LabelText>患者名</LabelText>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={patientQuery}
              onChange={(event) => setPatientQuery(event.target.value)}
              placeholder="患者名 / フリガナ"
              className="pl-8"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <LabelText>送付先</LabelText>
          <Input
            value={recipientQuery}
            onChange={(event) => setRecipientQuery(event.target.value)}
            placeholder="主治医 / ケアマネ"
          />
        </div>
        <div className="space-y-1.5">
          <LabelText>キーワード</LabelText>
          <Input
            value={keywordQuery}
            onChange={(event) => setKeywordQuery(event.target.value)}
            placeholder="SOAP / 要点"
          />
        </div>
        <div className="space-y-1.5">
          <LabelText>報告状態</LabelText>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? ALL_VALUE)}>
            <SelectTrigger>
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              {Object.entries(REPORT_STATUS_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <LabelText>送達状態</LabelText>
          <Select
            value={deliveryStatusFilter}
            onValueChange={(value) => setDeliveryStatusFilter(value ?? ALL_VALUE)}
          >
            <SelectTrigger>
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              {Object.entries(REPORT_STATUS_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <LabelText>報告書種別</LabelText>
          <Select
            value={reportTypeFilter}
            onValueChange={(value) => setReportTypeFilter(value ?? ALL_VALUE)}
          >
            <SelectTrigger>
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <LabelText>作成日 From</LabelText>
          <Input type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <LabelText>作成日 To</LabelText>
          <Input type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <LabelText>送付日 From</LabelText>
          <Input type="date" value={sentFrom} onChange={(event) => setSentFrom(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <LabelText>送付日 To</LabelText>
          <Input type="date" value={sentTo} onChange={(event) => setSentTo(event.target.value)} />
        </div>
        <div className="flex items-end lg:col-span-2 xl:col-span-1">
          <Button type="button" variant="outline" className="w-full" onClick={resetFilters}>
            <RotateCcw className="mr-1.5 size-4" aria-hidden="true" />
            リセット
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">適用中フィルタ {activeFilterCount}件</Badge>
        <Badge variant="outline">返信待ち {data?.deliverySummary.pending_delivery_count ?? 0}件</Badge>
        <Badge variant="outline">失敗 {data?.deliverySummary.failed_delivery_count ?? 0}件</Badge>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        caption="報告書一覧"
        renderExpandedRow={renderExpandedRow}
        toolbar={{
          enableColumnVisibility: true,
          enableExport: true,
          exportFileName: 'care-reports-filtered.csv',
        }}
      />

      {!isLoading && (data?.data.length ?? 0) === 0 && (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border">
          <p className="text-sm text-muted-foreground">報告書がありません</p>
        </div>
      )}
    </div>
  );
}

function LabelText({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}
