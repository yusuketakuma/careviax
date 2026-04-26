'use client';

import { type ReactNode, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
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
import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import {
  CHANNEL_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
} from '@/lib/constants/status-labels';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

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
  effective_revision_code: string | null;
  site_config_status: string | null;
  latest_delivery_status: string | null;
  latest_delivery_recipient_name: string | null;
  latest_delivery_sent_at: string | null;
  failed_delivery_count: number;
  pending_delivery_count: number;
  delivery_records: DeliveryRecord[];
};

type CareReportsResponse = {
  data: CareReport[];
  hasMore: boolean;
  nextCursor?: string;
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
        <div className="space-y-1">
          <Link
            href={`/reports/${row.original.id}`}
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${REPORT_TYPE_LABELS[row.original.report_type] ?? row.original.report_type}の詳細`}
          >
            {REPORT_TYPE_LABELS[row.original.report_type] ?? row.original.report_type}
          </Link>
          <p className="text-xs text-muted-foreground">
            {row.original.effective_revision_code
              ? `改定 ${row.original.effective_revision_code}`
              : '本文、送付先、送達履歴を確認'}
          </p>
          {row.original.site_config_status ? (
            <p className="text-xs text-muted-foreground">
              薬局設定 {row.original.site_config_status}
            </p>
          ) : null}
        </div>
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
          <Link
            href={`/patients/${row.original.patient_id}`}
            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.original.patient_name ?? '患者名未設定'}
          </Link>
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
    {
      id: 'actions',
      header: '操作',
      meta: {
        label: '操作',
        tabletHidden: true,
      },
      cell: ({ row }) => (
        <Link
          href={`/reports/${row.original.id}`}
          className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${row.original.patient_name ?? '患者未設定'} の報告詳細を開く`}
        >
          報告詳細
        </Link>
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

type ReportsTableProps = {
  initialDeliveryStatus?: string | null;
  initialContext?: string | null;
  initialPatientId?: string | null;
  initialVisitRecordId?: string | null;
};

export function ReportsTable({
  initialDeliveryStatus,
  initialContext,
  initialPatientId,
  initialVisitRecordId,
}: ReportsTableProps = {}) {
  const replaceReportsUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const columns = useMemo(() => buildColumns(), []);
  const [filters, setFilters] = useState({
    status: ALL_VALUE,
    reportType: ALL_VALUE,
    deliveryStatus: initialDeliveryStatus ?? ALL_VALUE,
    patientId: initialPatientId?.trim() ?? '',
    visitRecordId: initialVisitRecordId?.trim() ?? '',
    patient: '',
    recipient: '',
    keyword: '',
    createdFrom: '',
    createdTo: '',
    sentFrom: '',
    sentTo: '',
  });
  const updateFilter = (key: keyof typeof filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const updateFilterAndUrl = (key: keyof typeof filters, value: string) => {
    updateFilter(key, value);
    const paramKeyMap: Record<keyof typeof filters, string> = {
      status: 'status',
      reportType: 'report_type',
      deliveryStatus: 'delivery_status',
      patientId: 'patient_id',
      visitRecordId: 'visit_record_id',
      patient: 'q',
      recipient: 'recipient',
      keyword: 'keyword',
      createdFrom: 'date_from',
      createdTo: 'date_to',
      sentFrom: 'sent_from',
      sentTo: 'sent_to',
    };
    const paramKey = paramKeyMap[key];
    replaceReportsUrl({ [paramKey]: value === ALL_VALUE || value === '' ? null : value });
  };

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status !== ALL_VALUE) params.set('status', filters.status);
    if (filters.reportType !== ALL_VALUE) params.set('report_type', filters.reportType);
    if (filters.deliveryStatus !== ALL_VALUE) params.set('delivery_status', filters.deliveryStatus);
    if (filters.patientId.trim()) params.set('patient_id', filters.patientId.trim());
    if (filters.visitRecordId.trim()) params.set('visit_record_id', filters.visitRecordId.trim());
    if (filters.patient.trim()) params.set('q', filters.patient.trim());
    if (filters.recipient.trim()) params.set('recipient', filters.recipient.trim());
    if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
    if (filters.createdFrom) params.set('date_from', filters.createdFrom);
    if (filters.createdTo) params.set('date_to', filters.createdTo);
    if (filters.sentFrom) params.set('sent_from', filters.sentFrom);
    if (filters.sentTo) params.set('sent_to', filters.sentTo);
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery({
    queryKey: ['care-reports', orgId, queryParams],
    queryFn: async () => {
      return fetchAllCursorPages<CareReport, CareReportsResponse>({
        path: '/api/care-reports',
        params: new URLSearchParams(queryParams),
        init: {
          headers: { 'x-org-id': orgId },
        },
        errorMessage: '報告書一覧の取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });

  const activeFilterCount = [
    filters.status !== ALL_VALUE ? filters.status : '',
    filters.reportType !== ALL_VALUE ? filters.reportType : '',
    filters.deliveryStatus !== ALL_VALUE ? filters.deliveryStatus : '',
    filters.patientId.trim(),
    filters.visitRecordId.trim(),
    filters.patient.trim(),
    filters.recipient.trim(),
    filters.keyword.trim(),
    filters.createdFrom,
    filters.createdTo,
    filters.sentFrom,
    filters.sentTo,
  ].filter(Boolean).length;

  function resetFilters() {
    setFilters({
      status: ALL_VALUE,
      reportType: ALL_VALUE,
      deliveryStatus: initialDeliveryStatus ?? ALL_VALUE,
      patientId: initialPatientId?.trim() ?? '',
      visitRecordId: initialVisitRecordId?.trim() ?? '',
      patient: '',
      recipient: '',
      keyword: '',
      createdFrom: '',
      createdTo: '',
      sentFrom: '',
      sentTo: '',
    });
    replaceReportsUrl({
      status: null,
      report_type: null,
      delivery_status: initialDeliveryStatus ?? null,
      patient_id: initialPatientId?.trim() || null,
      visit_record_id: initialVisitRecordId?.trim() || null,
      q: null,
      recipient: null,
      keyword: null,
      date_from: null,
      date_to: null,
      sent_from: null,
      sent_to: null,
    });
  }

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const reportsWithDelivery = (data?.data ?? []).filter((report) => report.delivery_records.length > 0).length;

  return (
    <div className="space-y-6">
      {initialContext === 'dashboard_home' ? (
        <div
          className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
          data-testid="reports-table-context-banner"
        >
          ホーム起点の報告書フィルタを適用しています。
        </div>
      ) : null}
      {initialPatientId || initialVisitRecordId ? (
        <div
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
          data-testid="reports-linked-context-banner"
        >
          訪問・患者の文脈で報告書を絞り込んでいます。
          {initialPatientId ? ` 患者ID: ${initialPatientId}` : ''}
          {initialVisitRecordId ? ` / 訪問記録ID: ${initialVisitRecordId}` : ''}
        </div>
      ) : null}
      <section className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4">
        <SectionIntro
          title="優先確認"
          description="一覧に入る前に、送達で滞留している報告と追跡対象の件数を先に確認できます。"
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewMetricCard label="対象報告" value={`${data?.data.length ?? 0}件`} />
          <OverviewMetricCard
            label="返信待ち"
            value={`${data?.deliverySummary.pending_delivery_count ?? 0}件`}
            tone={(data?.deliverySummary.pending_delivery_count ?? 0) > 0 ? 'warning' : 'default'}
          />
          <OverviewMetricCard
            label="失敗"
            value={`${data?.deliverySummary.failed_delivery_count ?? 0}件`}
            tone={(data?.deliverySummary.failed_delivery_count ?? 0) > 0 ? 'danger' : 'default'}
          />
          <OverviewMetricCard label="送達履歴あり" value={`${reportsWithDelivery}件`} />
        </div>
      </section>

      <section
        className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4"
        data-testid="reports-filter-panel"
        aria-labelledby="reports-filter-panel-heading"
      >
        <SectionIntro
          id="reports-filter-panel-heading"
          title="絞り込みと対象選定"
          description="送付待ち、返信待ち、送付先を先に絞り込み、確認すべき報告書を先頭で固めます。"
        />
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_repeat(2,minmax(0,0.8fr))_auto]">
          <div className="space-y-1.5">
            <LabelText>患者名</LabelText>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.patient}
                onChange={(event) => updateFilterAndUrl('patient', event.target.value)}
                placeholder="患者名 / フリガナ"
                className="h-10 pl-8 sm:h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <LabelText>送付先</LabelText>
            <Input
              value={filters.recipient}
              onChange={(event) => updateFilterAndUrl('recipient', event.target.value)}
              placeholder="主治医 / ケアマネ"
              className="h-10 sm:h-9"
            />
          </div>

          <div className="space-y-1.5">
            <LabelText>報告状態</LabelText>
            <Select
              value={filters.status}
              onValueChange={(value) => updateFilterAndUrl('status', value ?? ALL_VALUE)}
            >
              <SelectTrigger className="h-10 sm:h-9">
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
              value={filters.deliveryStatus}
              onValueChange={(value) => updateFilterAndUrl('deliveryStatus', value ?? ALL_VALUE)}
            >
              <SelectTrigger className="h-10 sm:h-9">
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

          <div className="space-y-1.5 md:max-w-56">
            <LabelText>詳細フィルタ</LabelText>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full justify-between sm:h-9"
              onClick={() => setShowAdvancedFilters((current) => !current)}
            >
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {showAdvancedFilters ? '詳細を閉じる' : '詳細フィルタ'}
              </span>
              <span className="text-xs text-muted-foreground">{activeFilterCount}件</span>
            </Button>
          </div>
        </div>

        {showAdvancedFilters ? (
          <div className="grid gap-3 border-t border-border/70 pt-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <LabelText>キーワード</LabelText>
              <Input
                value={filters.keyword}
                onChange={(event) => updateFilterAndUrl('keyword', event.target.value)}
                placeholder="SOAP / 要点"
                className="h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <LabelText>報告書種別</LabelText>
              <Select
                value={filters.reportType}
                onValueChange={(value) => updateFilterAndUrl('reportType', value ?? ALL_VALUE)}
              >
                <SelectTrigger className="h-10 sm:h-9">
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
              <Input
                type="date"
                value={filters.createdFrom}
                onChange={(event) => updateFilterAndUrl('createdFrom', event.target.value)}
                className="h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <LabelText>作成日 To</LabelText>
              <Input
                type="date"
                value={filters.createdTo}
                onChange={(event) => updateFilterAndUrl('createdTo', event.target.value)}
                className="h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <LabelText>送付日 From</LabelText>
              <Input
                type="date"
                value={filters.sentFrom}
                onChange={(event) => updateFilterAndUrl('sentFrom', event.target.value)}
                className="h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <LabelText>送付日 To</LabelText>
              <Input
                type="date"
                value={filters.sentTo}
                onChange={(event) => updateFilterAndUrl('sentTo', event.target.value)}
                className="h-10 sm:h-9"
              />
            </div>

            <div className="flex items-end md:col-span-2 xl:col-span-1">
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full sm:h-9"
                onClick={resetFilters}
              >
                <RotateCcw className="mr-1.5 size-4" aria-hidden="true" />
                リセット
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4">
        <SectionIntro
          title="送達状況サマリー"
          description="一覧を開く前に、滞留や失敗件数をひと目で確認できる補助グループです。"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">適用中フィルタ {activeFilterCount}件</Badge>
          <Badge variant="outline">返信待ち {data?.deliverySummary.pending_delivery_count ?? 0}件</Badge>
          <Badge variant="outline">失敗 {data?.deliverySummary.failed_delivery_count ?? 0}件</Badge>
          <Badge variant="outline">報告書名か患者名から詳細へ移動</Badge>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4">
        <SectionIntro
          title="報告書一覧"
          description="報告書名または患者名から本文と送達履歴を確認し、必要に応じて個別フォローへ進みます。"
        />
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          isLoading={isBootstrappingOrg || isLoading}
          caption="報告書一覧"
          renderExpandedRow={renderExpandedRow}
          toolbar={{
            enableColumnVisibility: true,
            enableExport: true,
            exportFileName: 'care-reports-filtered.csv',
          }}
        />

        {!isBootstrappingOrg && !isLoading && (data?.data.length ?? 0) === 0 && (
          <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border">
            <p className="text-sm text-muted-foreground">報告書がありません</p>
          </div>
        )}
      </section>
    </div>
  );
}

function LabelText({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}

function SectionIntro({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-base font-semibold text-foreground">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function OverviewMetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const toneClassName =
    tone === 'danger'
      ? 'border-rose-200/80 bg-rose-50/80'
      : tone === 'warning'
        ? 'border-amber-200/80 bg-amber-50/80'
        : 'border-border/70 bg-background';

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClassName}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}
