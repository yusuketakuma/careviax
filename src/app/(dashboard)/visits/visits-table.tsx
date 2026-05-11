'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CheckCircle2, AlertCircle, Clock, XCircle, Package, AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PatientHistoryQuickLinks } from '@/components/features/patients/patient-history-quick-links';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { OUTCOME_LABELS, OUTCOME_VARIANTS } from '@/lib/constants/visit';

type VisitRecordRow = {
  id: string;
  patient_id: string;
  pharmacist_id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  schedule: {
    visit_type: string;
    scheduled_date: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string | null;
      };
    };
  } | null;
  patient_history_summary: {
    prescription_count: number;
    visit_count: number;
    latest_prescription: {
      id: string;
      prescribed_date: string;
      prescriber_name: string | null;
      drug_names: string[];
    } | null;
    previous_visit: {
      id: string;
      visit_date: string;
      outcome_status: string;
      next_visit_suggestion_date: string | null;
    } | null;
  } | null;
};

const OUTCOME_ICONS: Record<string, React.ElementType> = {
  completed: CheckCircle2,
  revisit_needed: AlertTriangle,
  postponed: Clock,
  cancelled: XCircle,
  delivery_only: Package,
  completed_with_issue: AlertCircle,
};

const visitTypeLabel: Record<string, string> = {
  initial: '初回',
  regular: '定期',
  temporary: '臨時',
  revisit: '再訪',
  delivery_only: '投薬のみ',
  emergency: '緊急',
  physician_co_visit: '医師同行',
};

function hasSoap(row: VisitRecordRow): boolean {
  return !!(row.soap_subjective || row.soap_objective || row.soap_assessment || row.soap_plan);
}

function getVisitPatient(row: VisitRecordRow) {
  return (
    row.schedule?.case_.patient ?? {
      id: row.patient_id,
      name: row.patient_id,
      name_kana: null,
    }
  );
}

function summarizeDrugNames(drugNames: string[]) {
  if (drugNames.length === 0) return '薬剤明細なし';
  const visible = drugNames.slice(0, 2);
  const rest = drugNames.length - visible.length;
  return `${visible.join('、')}${rest > 0 ? ` 他${rest}剤` : ''}`;
}

function VisitHistoryCell({ row }: { row: VisitRecordRow }) {
  const patient = getVisitPatient(row);
  const summary = row.patient_history_summary;
  const latestPrescription = summary?.latest_prescription ?? null;
  const previousVisit = summary?.previous_visit ?? null;

  return (
    <div className="min-w-[14rem] space-y-1.5">
      <PatientHistoryQuickLinks
        patientId={patient.id}
        patientName={patient.name}
        variant="inline"
        showTimeline={false}
      />
      <div className="space-y-0.5 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5 text-[11px] text-muted-foreground">
        {latestPrescription ? (
          <p className="line-clamp-1">
            直近処方:{' '}
            <Link
              href={`/prescriptions/${latestPrescription.id}`}
              className="inline-flex min-h-[44px] items-center text-primary hover:underline sm:min-h-0"
            >
              {format(parseISO(latestPrescription.prescribed_date), 'M/d', { locale: ja })}
            </Link>{' '}
            {summarizeDrugNames(latestPrescription.drug_names)}
          </p>
        ) : (
          <p>直近処方: なし</p>
        )}
        {previousVisit ? (
          <p className="line-clamp-1">
            前回訪問:{' '}
            <Link
              href={`/visits/${previousVisit.id}`}
              className="inline-flex min-h-[44px] items-center text-primary hover:underline sm:min-h-0"
            >
              {format(parseISO(previousVisit.visit_date), 'M/d', { locale: ja })}
            </Link>{' '}
            {OUTCOME_LABELS[previousVisit.outcome_status] ?? previousVisit.outcome_status}
          </p>
        ) : (
          <p>前回訪問: なし</p>
        )}
      </div>
    </div>
  );
}

const columns: ColumnDef<VisitRecordRow>[] = [
  {
    accessorKey: 'visit_date',
    header: '訪問日',
    cell: ({ row }) => (
      <Link
        href={`/visits/${row.original.id}`}
        className="inline-flex min-h-[44px] items-center font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
      >
        {format(parseISO(row.original.visit_date), 'yyyy/MM/dd', { locale: ja })}
      </Link>
    ),
  },
  {
    accessorKey: 'patient_id',
    header: '患者',
    cell: ({ row }) => {
      const patient = getVisitPatient(row.original);
      return (
        <div className="space-y-0.5">
          <Link
            href={`/patients/${patient.id}?tab=visits`}
            className="inline-flex min-h-11 items-center font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            {patient.name}
          </Link>
          <p className="text-xs text-muted-foreground">{patient.name_kana ?? patient.id}</p>
        </div>
      );
    },
  },
  {
    accessorKey: 'pharmacist_id',
    header: '薬剤師ID',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground font-mono">{row.original.pharmacist_id}</span>
    ),
  },
  {
    id: 'visitType',
    header: '訪問タイプ',
    cell: ({ row }) => {
      const type = row.original.schedule?.visit_type;
      return <span className="text-sm">{type ? (visitTypeLabel[type] ?? type) : '—'}</span>;
    },
  },
  {
    accessorKey: 'outcome_status',
    header: '訪問結果',
    cell: ({ row }) => {
      const status = row.original.outcome_status;
      const label = OUTCOME_LABELS[status];
      const variant = OUTCOME_VARIANTS[status];
      const Icon = OUTCOME_ICONS[status];
      if (!label) return <span className="text-muted-foreground">{status}</span>;
      return (
        <Badge variant={variant ?? 'outline'} className="gap-1">
          {Icon && <Icon className="size-3" aria-hidden="true" />}
          {label}
        </Badge>
      );
    },
  },
  {
    id: 'soapPresent',
    header: 'SOAP',
    cell: ({ row }) =>
      hasSoap(row.original) ? (
        <Badge variant="default" className="text-xs">
          あり
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">なし</span>
      ),
  },
  {
    id: 'history',
    header: '過去歴',
    cell: ({ row }) => <VisitHistoryCell row={row.original} />,
    enableSorting: false,
  },
];

export function VisitsTable() {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const queryParams = new URLSearchParams({
    limit: '50',
    include_history_summary: 'true',
  });
  if (dateFrom) queryParams.set('date_from', dateFrom);
  if (dateTo) queryParams.set('date_to', dateTo);

  const { data, isLoading } = useQuery({
    queryKey: ['visit-records', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/visit-records?${queryParams.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問記録の取得に失敗しました');
      return res.json() as Promise<{ data: VisitRecordRow[] }>;
    },
    enabled: !!orgId,
  });

  const records = useMemo(() => data?.data ?? [], [data]);

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="date-from" className="text-xs">
                開始日
              </Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-40 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-to" className="text-xs">
                終了日
              </Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-40 text-sm"
              />
            </div>
          </div>
          <div className="max-w-xl rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <h2 className="text-sm font-semibold text-foreground">患者ごとの過去歴確認</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              患者名から患者別の訪問履歴へ、過去歴列から処方歴・訪問歴へ進みます。訪問結果だけで判断せず、処方変更と訪問経過を同じ患者単位で確認します。
            </p>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={records}
        isLoading={isBootstrappingOrg || isLoading}
        caption="訪問記録一覧"
      />
    </div>
  );
}
