'use client';

import { type ReactNode, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInYears, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Archive,
  CalendarPlus,
  CirclePause,
  Clock,
  FileWarning,
  Hospital,
  LogOut,
  PhoneOff,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import type { PatientStatusIcon } from '@/types/dashboard-home';
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
import { Label } from '@/components/ui/label';
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
import { SectionIntro } from '@/components/ui/section-intro';
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
  readiness: {
    has_emergency_contact: boolean;
    has_primary_physician: boolean;
    has_first_visit_document: boolean;
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

const genderLabel: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

const STATUS_ICONS: Record<PatientStatusIcon, typeof Star> = {
  stable: UserCheck,
  new: Sparkles,
  first_visit_soon: CalendarPlus,
  attention: Star,
  urgent: TriangleAlert,
  overdue_visit: Clock,
  report_pending: FileWarning,
  medication_change: RefreshCw,
  hospitalized: Hospital,
  discharged: LogOut,
  no_contact: PhoneOff,
  paused: CirclePause,
};

function deriveRowStatus(row: PatientRow): PatientStatusIcon {
  const risk = row.risk_summary;
  const caseStatus = row.latest_case?.status ?? null;
  const hasCompletedVisit = !!row.latest_visit;
  const hasNextVisit = row.visit_schedules.some((v) =>
    ['planned', 'in_preparation', 'ready'].includes(v.schedule_status),
  );
  const hasOverdueVisit = row.visit_schedules.some(
    (v) =>
      ['planned', 'in_preparation', 'ready'].includes(v.schedule_status) &&
      new Date(v.scheduled_date) < new Date(),
  );

  if (caseStatus === 'on_hold') return 'paused';
  if (risk.level === 'high') return 'urgent';
  if (hasOverdueVisit) return 'overdue_visit';
  if (!hasCompletedVisit && hasNextVisit) return 'first_visit_soon';
  if (!hasCompletedVisit) return 'new';
  if (risk.level === 'watch' || risk.open_tasks > 0) return 'attention';
  return 'stable';
}

function normalizeFilterValue(value: string | undefined) {
  return value && value.length > 0 ? value : ALL_VALUE;
}

const STATUS_FILTER_OPTIONS: Array<{ value: PatientStatusIcon; label: string }> = [
  { value: 'urgent', label: '要対応' },
  { value: 'overdue_visit', label: '訪問遅延' },
  { value: 'attention', label: '要確認' },
  { value: 'new', label: '新規' },
  { value: 'first_visit_soon', label: '初回予定' },
  { value: 'stable', label: '安定' },
  { value: 'paused', label: '休止中' },
];

function toggleFilter(values: string[], target: string) {
  return values.includes(target) ? values.filter((value) => value !== target) : [...values, target];
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
            aria-label={
              args.favoritePatientIds.includes(row.original.id)
                ? 'お気に入りを解除'
                : 'お気に入りに追加'
            }
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
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.name_kana}</span>,
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
          row.latest_case
            ? (CASE_STATUS_LABELS[row.latest_case.status] ?? row.latest_case.status)
            : '—',
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
      id: 'status',
      header: 'ステータス',
      meta: {
        label: 'ステータス',
        exportValue: (row: PatientRow) => {
          const s = deriveRowStatus(row);
          return STATUS_ICON_CONFIG[s].label;
        },
      },
      cell: ({ row }) => {
        const statusKey = deriveRowStatus(row.original);
        const cfg = STATUS_ICON_CONFIG[statusKey];
        const IconComponent = STATUS_ICONS[statusKey];
        return (
          <div className="flex items-center gap-1.5">
            <div className={`shrink-0 rounded-full p-1 ${cfg.color} ${cfg.bg}`} title={cfg.label}>
              <IconComponent className="size-3.5" aria-hidden="true" />
            </div>
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
        );
      },
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

export type InitialPatientFilters = {
  searchQuery?: string;
  caseStatusFilters?: string[];
  riskFilter?: string;
  facilityFilter?: string;
  pharmacistFilter?: string;
  consentFilter?: string;
  billingSupportFilter?: string;
  payerFilter?: string;
  lastVisitFrom?: string;
  lastVisitTo?: string;
  readinessIssueFilter?: string;
};

export function PatientsTable({
  initialFilters,
}: {
  initialFilters?: InitialPatientFilters;
}) {
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
    [favoritePatientIds, markRecentPatient, toggleFavoritePatient],
  );
  const [searchQuery, setSearchQuery] = useState(initialFilters?.searchQuery ?? '');
  const [selectedPatients, setSelectedPatients] = useState<PatientRow[]>([]);
  const [caseStatusFilters, setCaseStatusFilters] = useState<string[]>(
    initialFilters?.caseStatusFilters ?? []
  );
  const [riskFilter, setRiskFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.riskFilter)
  );
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE);
  const [facilityFilter, setFacilityFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.facilityFilter)
  );
  const [pharmacistFilter, setPharmacistFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.pharmacistFilter)
  );
  const [consentFilter, setConsentFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.consentFilter)
  );
  const [billingSupportFilter, setBillingSupportFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.billingSupportFilter)
  );
  const [payerFilter, setPayerFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.payerFilter)
  );
  const [lastVisitFrom, setLastVisitFrom] = useState(initialFilters?.lastVisitFrom ?? '');
  const [lastVisitTo, setLastVisitTo] = useState(initialFilters?.lastVisitTo ?? '');
  const [readinessIssueFilter, setReadinessIssueFilter] = useState<string>(
    normalizeFilterValue(initialFilters?.readinessIssueFilter)
  );
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
        facilityFilter === 'facility' || facilityFilter === 'home'
          ? 'facility_mode'
          : 'building_id',
        facilityFilter,
      );
    }
    if (pharmacistFilter !== ALL_VALUE) params.set('primary_pharmacist_id', pharmacistFilter);
    if (consentFilter !== ALL_VALUE) params.set('consent_status', consentFilter);
    if (billingSupportFilter !== ALL_VALUE) params.set('billing_support', billingSupportFilter);
    if (payerFilter !== ALL_VALUE) params.set('payer_basis', payerFilter);
    if (lastVisitFrom) params.set('last_visit_from', lastVisitFrom);
    if (lastVisitTo) params.set('last_visit_to', lastVisitTo);
    if (readinessIssueFilter !== ALL_VALUE) {
      params.set('readiness_issue', readinessIssueFilter);
    }
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
    readinessIssueFilter,
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
    statusFilter !== ALL_VALUE ? statusFilter : '',
    facilityFilter !== ALL_VALUE ? facilityFilter : '',
    pharmacistFilter !== ALL_VALUE ? pharmacistFilter : '',
    consentFilter !== ALL_VALUE ? consentFilter : '',
    billingSupportFilter !== ALL_VALUE ? billingSupportFilter : '',
    payerFilter !== ALL_VALUE ? payerFilter : '',
    lastVisitFrom,
    lastVisitTo,
    readinessIssueFilter !== ALL_VALUE ? readinessIssueFilter : '',
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
    [data],
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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  function resetFilters() {
    setSearchQuery('');
    setCaseStatusFilters([]);
    setRiskFilter(ALL_VALUE);
    setStatusFilter(ALL_VALUE);
    setFacilityFilter(ALL_VALUE);
    setPharmacistFilter(ALL_VALUE);
    setConsentFilter(ALL_VALUE);
    setBillingSupportFilter(ALL_VALUE);
    setPayerFilter(ALL_VALUE);
    setLastVisitFrom('');
    setLastVisitTo('');
    setReadinessIssueFilter(ALL_VALUE);
    setExportFeedback(null);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4">
        <SectionIntro
          title="優先確認"
          description="まず件数で優先度を掴み、その後に絞り込みと一覧確認へ進める構成にしています。"
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <OverviewMetricCard label="対象患者" value={`${data?.summary.total ?? 0}名`} />
          <OverviewMetricCard
            label="高リスク"
            value={`${data?.summary.by_risk.high ?? 0}名`}
            tone={(data?.summary.by_risk.high ?? 0) > 0 ? 'danger' : 'default'}
          />
          <OverviewMetricCard
            label="要観察"
            value={`${data?.summary.by_risk.watch ?? 0}名`}
            tone={(data?.summary.by_risk.watch ?? 0) > 0 ? 'warning' : 'default'}
          />
          <OverviewMetricCard
            label="同意不足"
            value={`${data?.summary.missing_consent_count ?? 0}名`}
            tone={(data?.summary.missing_consent_count ?? 0) > 0 ? 'warning' : 'default'}
          />
          <OverviewMetricCard label="施設患者" value={`${data?.summary.facility_count ?? 0}名`} />
        </div>
      </section>

      <section
        className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4"
        data-testid="patients-filter-panel"
        aria-labelledby="patients-filter-panel-heading"
      >
        <SectionIntro
          id="patients-filter-panel-heading"
          title="絞り込みと対象選定"
          description="今日優先して見る患者を先に絞り込み、対象を固めてから一覧へ進みます。"
        />
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_auto] xl:grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,0.72fr))_auto]">
          <div className="space-y-1.5">
            <LabelText>患者検索</LabelText>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder="氏名・ふりがなを検索"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 pl-8 sm:h-9"
                aria-label="患者検索"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <LabelText>ケース状態</LabelText>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" className="h-10 w-full justify-between sm:h-9" />}
              >
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
              <SelectTrigger aria-label="リスクフィルタ" className="h-10 sm:h-9">
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
            <LabelText>ステータス</LabelText>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value ?? ALL_VALUE)}
            >
              <SelectTrigger aria-label="ステータスフィルタ" className="h-10 sm:h-9">
                <SelectValue placeholder="すべて" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>すべて</SelectItem>
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
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
              <LabelText>施設・建物</LabelText>
              <Select
                value={facilityFilter}
                onValueChange={(value) => setFacilityFilter(value ?? ALL_VALUE)}
              >
                <SelectTrigger aria-label="施設フィルタ" className="h-10 sm:h-9">
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
              <Select
                value={consentFilter}
                onValueChange={(value) => setConsentFilter(value ?? ALL_VALUE)}
              >
                <SelectTrigger aria-label="同意状態フィルタ" className="h-10 sm:h-9">
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
                <SelectTrigger aria-label="担当薬剤師フィルタ" className="h-10 sm:h-9">
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
                <SelectTrigger aria-label="請求支援フィルタ" className="h-10 sm:h-9">
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
              <Select
                value={payerFilter}
                onValueChange={(value) => setPayerFilter(value ?? ALL_VALUE)}
              >
                <SelectTrigger aria-label="保険種別フィルタ" className="h-10 sm:h-9">
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
              <LabelText>readiness</LabelText>
              <Select
                value={readinessIssueFilter}
                onValueChange={(value) => setReadinessIssueFilter(value ?? ALL_VALUE)}
              >
                <SelectTrigger aria-label="readiness フィルタ" className="h-10 sm:h-9">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>すべて</SelectItem>
                  <SelectItem value="missing_visit_consent">訪問同意不足</SelectItem>
                  <SelectItem value="missing_management_plan">管理計画書不足</SelectItem>
                  <SelectItem value="missing_emergency_contact">緊急連絡先不足</SelectItem>
                  <SelectItem value="missing_primary_physician">主治医未登録</SelectItem>
                  <SelectItem value="missing_first_visit_doc">初回文書未交付</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="patients-last-visit-from"
                className="text-xs font-medium text-muted-foreground"
              >
                最終訪問 From
              </Label>
              <Input
                id="patients-last-visit-from"
                type="date"
                value={lastVisitFrom}
                onChange={(event) => setLastVisitFrom(event.target.value)}
                className="h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="patients-last-visit-to"
                className="text-xs font-medium text-muted-foreground"
              >
                最終訪問 To
              </Label>
              <Input
                id="patients-last-visit-to"
                type="date"
                value={lastVisitTo}
                onChange={(event) => setLastVisitTo(event.target.value)}
                className="h-10 sm:h-9"
              />
            </div>

            <div className="flex items-end gap-2 md:col-span-2 xl:col-span-1">
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <SectionIntro
            title="現在の状況"
            description="件数サマリーと一括操作を同じまとまりに置き、絞り込み結果の影響をすぐ確認できるようにしています。"
          />
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">適用中フィルタ {activeFilterCount}件</Badge>
          <Badge variant="outline">対象患者 {data?.summary.total ?? 0}名</Badge>
          <Badge variant="outline">施設 {data?.summary.facility_count ?? 0}名</Badge>
          <Badge variant="outline">同意不足 {data?.summary.missing_consent_count ?? 0}名</Badge>
          <Badge variant="outline">お気に入り {favoritePatientIds.length}名</Badge>
        </div>
      </section>

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

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4">
        <SectionIntro
          title="患者一覧"
          description="対象患者の詳細へ進み、薬歴、処方受付、訪問候補へそのまま遷移できます。"
        />
        <DataTable
          columns={columns}
          data={
            statusFilter !== ALL_VALUE
              ? (data?.data ?? []).filter((row) => deriveRowStatus(row) === statusFilter)
              : (data?.data ?? [])
          }
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
      </section>

      {(favoritePatients.length > 0 || recentPatients.length > 0) && (
        <section className="space-y-4 rounded-xl border border-border/70 bg-card/80 p-4">
          <SectionIntro
            title="補助導線"
            description="よく使う患者と最近見た患者を本文一覧から分離し、再訪問や再確認の導線を短くしています。"
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background p-4">
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
            <div className="rounded-lg border border-border/70 bg-background p-4">
              <p className="mb-2 text-sm font-medium text-foreground">最近表示した患者</p>
              <div className="flex flex-wrap gap-2">
                {recentPatients.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    最近表示した患者はありません
                  </span>
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
        </section>
      )}
    </div>
  );
}

function LabelText({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
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
