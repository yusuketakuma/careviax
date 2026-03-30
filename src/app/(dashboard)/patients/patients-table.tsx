'use client';

import { type ReactNode, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInYears, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Archive, RotateCcw, Search, SlidersHorizontal, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { usePatientListStore } from '@/lib/stores/patient-list-store';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_VARIANTS,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
} from '@/lib/constants/status-labels';

type PatientRow = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
  billing_support_flag: boolean;
  residences: Array<{
    address: string;
    building_id: string | null;
    unit_name: string | null;
  }>;
  latest_case: {
    id: string;
    status: string;
    updated_at: string;
    primary_pharmacist_id: string | null;
    primary_pharmacist_name: string | null;
  } | null;
  latest_visit: {
    id: string;
    visit_date: string;
    outcome_status: string;
    created_at: string;
  } | null;
  visit_schedules: Array<{
    id: string;
    scheduled_date: string;
    schedule_status: string;
    priority: string;
  }>;
  consent: {
    has_visit_medication_management: boolean;
  };
  risk_summary: {
    level: 'stable' | 'watch' | 'high';
    open_issues: number;
    open_tasks: number;
  };
  facility_mode: 'facility' | 'home';
};

type PatientsResponse = {
  data: PatientRow[];
  summary: {
    total: number;
    facility_count: number;
    missing_consent_count: number;
    by_risk: Record<'stable' | 'watch' | 'high', number>;
  };
};

const ALL_VALUE = '_all';
const caseStatuses = Object.keys(CASE_STATUS_LABELS);

const riskBadgeClassName: Record<PatientRow['risk_summary']['level'], string> = {
  stable: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  watch: 'border-amber-200 bg-amber-50 text-amber-900',
  high: 'border-rose-200 bg-rose-50 text-rose-800',
};

const riskLabel: Record<PatientRow['risk_summary']['level'], string> = {
  stable: '安定',
  watch: '要観察',
  high: '高リスク',
};

const genderLabel: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

function toggleFilter(values: string[], target: string) {
  return values.includes(target)
    ? values.filter((value) => value !== target)
    : [...values, target];
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

function buildPatientColumns(args: {
  favoritePatientIds: string[];
  onToggleFavorite: (patientId: string) => void;
  onMarkRecent: (patientId: string) => void;
}): ColumnDef<PatientRow>[] {
  return [
    {
      accessorKey: 'name',
      header: '氏名',
      meta: {
        label: '氏名',
        exportValue: (row: PatientRow) => row.name,
      },
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={args.favoritePatientIds.includes(row.original.id) ? 'お気に入りを解除' : 'お気に入りに追加'}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              args.onToggleFavorite(row.original.id);
            }}
          >
            <Star
              className={`size-4 ${
                args.favoritePatientIds.includes(row.original.id)
                  ? 'fill-amber-400 text-amber-500'
                  : 'text-muted-foreground'
              }`}
              aria-hidden="true"
            />
          </Button>
          <Link
            href={`/patients/${row.original.id}`}
            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => args.onMarkRecent(row.original.id)}
          >
            {row.original.name}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: 'name_kana',
      header: 'フリガナ',
      meta: {
        label: 'フリガナ',
        tabletHidden: true,
      },
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.name_kana}</span>
      ),
    },
    {
      accessorKey: 'birth_date',
      header: '年齢',
      meta: {
        label: '年齢',
        exportValue: (row: PatientRow) => {
          const date = parseISO(row.birth_date);
          return `${format(date, 'yyyy/MM/dd', { locale: ja })} (${differenceInYears(new Date(), date)}歳)`;
        },
      },
      cell: ({ row }) => {
        const date = parseISO(row.original.birth_date);
        const age = differenceInYears(new Date(), date);
        return (
          <span>
            {format(date, 'yyyy/MM/dd', { locale: ja })}
            <span className="ml-1.5 text-xs text-muted-foreground">({age}歳)</span>
          </span>
        );
      },
    },
    {
      accessorKey: 'gender',
      header: '性別',
      meta: {
        label: '性別',
        tabletHidden: true,
      },
      cell: ({ row }) => genderLabel[row.original.gender] ?? row.original.gender,
    },
    {
      id: 'caseStatus',
      header: 'ケース状態',
      meta: {
        label: 'ケース状態',
        exportValue: (row: PatientRow) =>
          row.latest_case ? (CASE_STATUS_LABELS[row.latest_case.status] ?? row.latest_case.status) : '—',
      },
      cell: ({ row }) => {
        const latestCase = row.original.latest_case;
        if (!latestCase) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant={CASE_STATUS_VARIANTS[latestCase.status] ?? 'outline'}>
            {CASE_STATUS_LABELS[latestCase.status] ?? latestCase.status}
          </Badge>
        );
      },
    },
    {
      id: 'pharmacist',
      header: '担当薬剤師',
      meta: {
        label: '担当薬剤師',
        tabletHidden: true,
        exportValue: (row: PatientRow) => row.latest_case?.primary_pharmacist_name ?? '—',
      },
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.latest_case?.primary_pharmacist_name ?? (
            <span className="text-muted-foreground">未割当</span>
          )}
        </span>
      ),
    },
    {
      id: 'risk',
      header: 'リスク',
      meta: {
        label: 'リスク',
        exportValue: (row: PatientRow) =>
          `${riskLabel[row.risk_summary.level]} / 課題${row.risk_summary.open_issues}件 / Task${row.risk_summary.open_tasks}件`,
      },
      cell: ({ row }) => (
        <div className="space-y-1">
          <Badge variant="outline" className={riskBadgeClassName[row.original.risk_summary.level]}>
            {riskLabel[row.original.risk_summary.level]}
          </Badge>
          <p className="text-xs text-muted-foreground">
            課題 {row.original.risk_summary.open_issues}件 / Task {row.original.risk_summary.open_tasks}件
          </p>
        </div>
      ),
    },
    {
      id: 'lastVisit',
      header: '最終訪問',
      meta: {
        label: '最終訪問',
        exportValue: (row: PatientRow) => formatDate(row.latest_visit?.visit_date),
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.latest_visit?.visit_date)}
        </span>
      ),
    },
    {
      id: 'nextVisit',
      header: '次回訪問',
      meta: {
        label: '次回訪問',
        exportValue: (row: PatientRow) =>
          row.visit_schedules[0]
            ? `${formatDate(row.visit_schedules[0].scheduled_date)} (${PRIORITY_LABELS[row.visit_schedules[0].priority] ?? row.visit_schedules[0].priority})`
            : '—',
      },
      cell: ({ row }) => {
        const nextVisit = row.original.visit_schedules[0];
        if (!nextVisit) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="space-y-1">
            <p className="text-sm">{formatDate(nextVisit.scheduled_date)}</p>
            <Badge variant={PRIORITY_VARIANTS[nextVisit.priority] ?? 'outline'}>
              {PRIORITY_LABELS[nextVisit.priority] ?? nextVisit.priority}
            </Badge>
          </div>
        );
      },
    },
    {
      id: 'billing',
      header: '請求支援',
      meta: {
        label: '請求支援',
        mobileHidden: true,
        exportValue: (row: PatientRow) => (row.billing_support_flag ? '要支援' : '通常'),
      },
      cell: ({ row }) =>
        row.original.billing_support_flag ? (
          <Badge variant="secondary">要支援</Badge>
        ) : (
          <span className="text-muted-foreground">通常</span>
        ),
    },
    {
      id: 'actions',
      header: 'アクション',
      enableHiding: false,
      meta: {
        label: 'アクション',
        mobileHidden: true,
        exportValue: () => '',
      },
      cell: ({ row }) => {
        const latestCase = row.original.latest_case;
        const prescriptionIntakeHref = latestCase
          ? `/prescriptions/new?patient_id=${row.original.id}&case_id=${latestCase.id}`
          : `/prescriptions/new?patient_id=${row.original.id}`;
        return (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/patients/${row.original.id}`}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              onClick={() => args.onMarkRecent(row.original.id)}
            >
              詳細
            </Link>
            <Link
              href={`/patients/${row.original.id}/prescriptions`}
              className={buttonVariants({ size: 'sm', variant: 'ghost' })}
              onClick={() => args.onMarkRecent(row.original.id)}
            >
              薬歴
            </Link>
            <Link
              href={prescriptionIntakeHref}
              className={buttonVariants({ size: 'sm', variant: 'ghost' })}
              onClick={() => args.onMarkRecent(row.original.id)}
            >
              処方受付
            </Link>
            {latestCase ? (
              <Link
                href={`/schedules/proposals?focus=patient&patient_id=${row.original.id}&case_id=${latestCase.id}`}
                className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                onClick={() => args.onMarkRecent(row.original.id)}
              >
                訪問候補
              </Link>
            ) : null}
          </div>
        );
      },
    },
  ];
}

export function PatientsTable() {
  const orgId = useOrgId();
  const favoritePatientIds = usePatientListStore((state) => state.favoritePatientIds);
  const recentPatientIds = usePatientListStore((state) => state.recentPatientIds);
  const toggleFavoritePatient = usePatientListStore((state) => state.toggleFavoritePatient);
  const markRecentPatient = usePatientListStore((state) => state.markRecentPatient);
  const columns = useMemo(
    () =>
      buildPatientColumns({
        favoritePatientIds,
        onToggleFavorite: toggleFavoritePatient,
        onMarkRecent: markRecentPatient,
      }),
    [favoritePatientIds, markRecentPatient, toggleFavoritePatient]
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPatients, setSelectedPatients] = useState<PatientRow[]>([]);
  const [caseStatusFilters, setCaseStatusFilters] = useState<string[]>([]);
  const [riskFilter, setRiskFilter] = useState<string>(ALL_VALUE);
  const [facilityFilter, setFacilityFilter] = useState<string>(ALL_VALUE);
  const [pharmacistFilter, setPharmacistFilter] = useState<string>(ALL_VALUE);
  const [consentFilter, setConsentFilter] = useState<string>(ALL_VALUE);
  const [billingSupportFilter, setBillingSupportFilter] = useState<string>(ALL_VALUE);
  const [payerFilter, setPayerFilter] = useState<string>(ALL_VALUE);
  const [lastVisitFrom, setLastVisitFrom] = useState('');
  const [lastVisitTo, setLastVisitTo] = useState('');
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (caseStatusFilters.length > 0) params.set('case_status', caseStatusFilters.join(','));
    if (riskFilter !== ALL_VALUE) params.set('risk_level', riskFilter);
    if (facilityFilter !== ALL_VALUE) {
      params.set(
        facilityFilter === 'facility' || facilityFilter === 'home' ? 'facility_mode' : 'building_id',
        facilityFilter
      );
    }
    if (pharmacistFilter !== ALL_VALUE) params.set('primary_pharmacist_id', pharmacistFilter);
    if (consentFilter !== ALL_VALUE) params.set('consent_status', consentFilter);
    if (billingSupportFilter !== ALL_VALUE) params.set('billing_support', billingSupportFilter);
    if (payerFilter !== ALL_VALUE) params.set('payer_basis', payerFilter);
    if (lastVisitFrom) params.set('last_visit_from', lastVisitFrom);
    if (lastVisitTo) params.set('last_visit_to', lastVisitTo);
    return params.toString();
  }, [
    billingSupportFilter,
    caseStatusFilters,
    consentFilter,
    facilityFilter,
    lastVisitFrom,
    lastVisitTo,
    payerFilter,
    pharmacistFilter,
    riskFilter,
    searchQuery,
  ]);

  const { data, isLoading } = useQuery({
    queryKey: ['patients', orgId, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/patients?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者一覧の取得に失敗しました');
      return res.json() as Promise<PatientsResponse>;
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
        throw new Error(payload?.message ?? '薬歴 PDF 一括出力のキュー登録に失敗しました');
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

  const activeFilterCount = [
    searchQuery.trim(),
    caseStatusFilters.length > 0 ? 'case' : '',
    riskFilter !== ALL_VALUE ? riskFilter : '',
    facilityFilter !== ALL_VALUE ? facilityFilter : '',
    pharmacistFilter !== ALL_VALUE ? pharmacistFilter : '',
    consentFilter !== ALL_VALUE ? consentFilter : '',
    billingSupportFilter !== ALL_VALUE ? billingSupportFilter : '',
    payerFilter !== ALL_VALUE ? payerFilter : '',
    lastVisitFrom,
    lastVisitTo,
  ].filter(Boolean).length;

  const buildingOptions = useMemo(() => {
    const values = new Set<string>();
    for (const patient of data?.data ?? []) {
      const buildingId = patient.residences[0]?.building_id;
      if (buildingId) values.add(buildingId);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [data]);

  const pharmacistOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const patient of data?.data ?? []) {
      const pharmacistId = patient.latest_case?.primary_pharmacist_id;
      const pharmacistName = patient.latest_case?.primary_pharmacist_name;
      if (pharmacistId && pharmacistName) {
        values.set(pharmacistId, pharmacistName);
      }
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [data]);
  const patientNameById = useMemo(
    () => new Map((data?.data ?? []).map((patient) => [patient.id, patient.name])),
    [data]
  );
  const favoritePatients = favoritePatientIds
    .map((patientId) => ({
      id: patientId,
      name: patientNameById.get(patientId) ?? null,
    }))
    .filter((patient) => patient.name);
  const recentPatients = recentPatientIds
    .map((patientId) => ({
      id: patientId,
      name: patientNameById.get(patientId) ?? null,
    }))
    .filter((patient) => patient.name);

  function resetFilters() {
    setSearchQuery('');
    setCaseStatusFilters([]);
    setRiskFilter(ALL_VALUE);
    setFacilityFilter(ALL_VALUE);
    setPharmacistFilter(ALL_VALUE);
    setConsentFilter(ALL_VALUE);
    setBillingSupportFilter(ALL_VALUE);
    setPayerFilter(ALL_VALUE);
    setLastVisitFrom('');
    setLastVisitTo('');
    setExportFeedback(null);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-border/70 bg-card/80 p-4 lg:grid-cols-[1.4fr_repeat(4,minmax(0,0.75fr))] xl:grid-cols-[1.4fr_repeat(5,minmax(0,0.72fr))]">
        <div className="space-y-1.5">
          <LabelText>患者検索</LabelText>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="氏名・フリガナ"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-8"
              aria-label="患者検索"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <LabelText>ケース状態</LabelText>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="w-full justify-between" />}>
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {caseStatusFilters.length > 0 ? `${caseStatusFilters.length}件選択` : 'すべて'}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start">
              <DropdownMenuLabel>表示するケース状態</DropdownMenuLabel>
              {caseStatuses.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={caseStatusFilters.includes(status)}
                  onCheckedChange={() =>
                    setCaseStatusFilters((current) => toggleFilter(current, status))
                  }
                >
                  {CASE_STATUS_LABELS[status]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1.5">
          <LabelText>リスク</LabelText>
          <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value ?? ALL_VALUE)}>
            <SelectTrigger aria-label="リスクフィルタ">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              <SelectItem value="high">高リスク</SelectItem>
              <SelectItem value="watch">要観察</SelectItem>
              <SelectItem value="stable">安定</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <LabelText>施設・建物</LabelText>
          <Select value={facilityFilter} onValueChange={(value) => setFacilityFilter(value ?? ALL_VALUE)}>
            <SelectTrigger aria-label="施設フィルタ">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              <SelectItem value="facility">施設患者</SelectItem>
              <SelectItem value="home">在宅患者</SelectItem>
              {buildingOptions.map((buildingId) => (
                <SelectItem key={buildingId} value={buildingId}>
                  建物: {buildingId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <LabelText>同意状態</LabelText>
          <Select value={consentFilter} onValueChange={(value) => setConsentFilter(value ?? ALL_VALUE)}>
            <SelectTrigger aria-label="同意状態フィルタ">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              <SelectItem value="complete">同意あり</SelectItem>
              <SelectItem value="missing">同意不足</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <LabelText>担当薬剤師</LabelText>
          <Select
            value={pharmacistFilter}
            onValueChange={(value) => setPharmacistFilter(value ?? ALL_VALUE)}
          >
            <SelectTrigger aria-label="担当薬剤師フィルタ">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              {pharmacistOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <LabelText>請求支援</LabelText>
          <Select
            value={billingSupportFilter}
            onValueChange={(value) => setBillingSupportFilter(value ?? ALL_VALUE)}
          >
            <SelectTrigger aria-label="請求支援フィルタ">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              <SelectItem value="true">要支援</SelectItem>
              <SelectItem value="false">通常</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <LabelText>保険種別</LabelText>
          <Select value={payerFilter} onValueChange={(value) => setPayerFilter(value ?? ALL_VALUE)}>
            <SelectTrigger aria-label="保険種別フィルタ">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>すべて</SelectItem>
              <SelectItem value="medical">医療</SelectItem>
              <SelectItem value="care">介護</SelectItem>
              <SelectItem value="self">自費</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <LabelText>最終訪問 From</LabelText>
          <Input type="date" value={lastVisitFrom} onChange={(event) => setLastVisitFrom(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <LabelText>最終訪問 To</LabelText>
          <Input type="date" value={lastVisitTo} onChange={(event) => setLastVisitTo(event.target.value)} />
        </div>

        <div className="flex items-end gap-2 lg:col-span-2 xl:col-span-1">
          <Button type="button" variant="outline" className="w-full" onClick={resetFilters}>
            <RotateCcw className="mr-1.5 size-4" aria-hidden="true" />
            リセット
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">適用中フィルタ {activeFilterCount}件</Badge>
          <Badge variant="outline">対象患者 {data?.summary.total ?? 0}名</Badge>
          <Badge variant="outline">施設 {data?.summary.facility_count ?? 0}名</Badge>
          <Badge variant="outline">同意不足 {data?.summary.missing_consent_count ?? 0}名</Badge>
          <Badge variant="outline">お気に入り {favoritePatientIds.length}名</Badge>
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

      {(favoritePatients.length > 0 || recentPatients.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-card/80 p-4">
            <p className="mb-2 text-sm font-medium text-foreground">お気に入り患者</p>
            <div className="flex flex-wrap gap-2">
              {favoritePatients.length === 0 ? (
                <span className="text-sm text-muted-foreground">お気に入りは未登録です</span>
              ) : (
                favoritePatients.map((patient) => (
                  <Link
                    key={patient.id}
                    href={`/patients/${patient.id}`}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    onClick={() => markRecentPatient(patient.id)}
                  >
                    {patient.name}
                  </Link>
                ))
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/80 p-4">
            <p className="mb-2 text-sm font-medium text-foreground">最近表示した患者</p>
            <div className="flex flex-wrap gap-2">
              {recentPatients.length === 0 ? (
                <span className="text-sm text-muted-foreground">最近表示した患者はありません</span>
              ) : (
                recentPatients.map((patient) => (
                  <Link
                    key={patient.id}
                    href={`/patients/${patient.id}`}
                    className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                    onClick={() => markRecentPatient(patient.id)}
                  >
                    {patient.name}
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        caption="患者一覧"
        enableRowSelection
        getRowId={(row) => row.id}
        onSelectionChange={(rows) => {
          setSelectedPatients(rows);
          setExportFeedback(null);
        }}
        toolbar={{
          enableColumnVisibility: true,
          enableExport: true,
          exportFileName: 'patients-filtered.csv',
        }}
      />
    </div>
  );
}

function LabelText({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}
