'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { memo, useEffect, useState } from 'react';
import { differenceInYears, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  FileQuestion,
  FileText,
  Link2,
  Pill,
  TriangleAlert,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import { LoadingButton } from '@/components/ui/loading-button';
import { SegmentError, SegmentLoading } from '@/components/ui/segment-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
import { ProcessChips } from '@/components/features/workspace/process-chips';
import { ListOpenCard } from '@/components/features/workspace/list-open-card';
import { PatientHeader } from '@/components/features/patients/patient-header';
import type { PatientHeaderSummary } from '@/server/services/patient-detail';
import {
  BlockedReasonsPanel,
  EvidencePanel,
  NextActionPanel,
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { formatDisplayEntityLabel } from '@/lib/display-id/display-labels';
import { downscaleImage } from '@/lib/files/downscale-image';
import { buildFileDownloadHref } from '@/lib/files/navigation';
import { encodePathSegment } from '@/lib/http/path-segment';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionIntakeApiPath } from '@/lib/prescriptions/api-paths';
import { usePresenceHeartbeat } from '@/lib/hooks/use-presence-heartbeat';
import { cn } from '@/lib/utils';
import { CASE_STATUS_LABELS } from '@/lib/constants/status-labels';
import {
  asepticPreparationNeedLabels,
  emergencyResponseLabels,
  formatOptionalDate,
  homeCareStatusLabels,
  homePharmacyAddOn2CandidateLabels,
  joinLabeledValues,
  labelOf,
  narcoticUseCategoryLabels,
  specialProcedureLabels,
  supportStatusLabels,
  triageRiskLabels,
  visitFrequencyLabels,
} from '@/lib/patient/home-visit-intake';
import type {
  PatientDocumentsSnapshot,
  PatientMovementTimelineSnapshot,
  PatientOverview,
  PatientWorkspaceActivity,
  PatientWorkspacePrescriptionLine,
  PatientWorkspaceTodayTask,
} from './patient-detail.types';
import type { CaseRiskCockpitResponse, CaseRiskNextAction } from '@/types/case-risk-cockpit';
import type { PatientMovementTimelineProps } from './patient-movement-timeline';
import {
  buildCaseRiskCommandPanelModel,
  buildPatientCommandCenterModel,
  formatActivityTime,
  type PatientCommandCaseRiskAction,
  type PatientCommandCaseRiskSummary,
  type PatientCommandRecentActivityItem,
} from './patient-command-center-model';
import {
  buildHomeOperationsItems,
  getPrimaryHomeVisitIntake,
  selectHomeOperationMetrics,
} from './patient-home-operations-model';
import type {
  PatientHomeOperationItem,
  PatientHomeOperationKey,
  PatientHomeOperationsSnapshot,
} from '@/types/patient-home-operations';

type FirstVisitDocumentsPanelProps = {
  cases: PatientOverview['cases'];
  documents: PatientDocumentsSnapshot['first_visit_documents'];
  documentStatuses?: PatientDocumentsSnapshot['document_statuses'];
  printReadiness?: PatientDocumentsSnapshot['print_readiness'];
  orgId?: string;
  patientId?: string;
};

type PatientContactsPanelProps = {
  patientId: string;
  orgId: string;
  initialContacts: PatientOverview['contacts'];
  initialExpectedUpdatedAt?: string | null;
};

type PatientIdPanelProps = {
  patientId: string;
};

type CaseRiskTaskSyncUiResult = {
  generated_at: string;
  case_id: string;
  patient_id: string;
  overall_status: string;
  taskable_finding_count: number;
  skipped_finding_count: number;
  upserted_task_count: number;
  resolved_stale_task_count: number;
};

type CaseRiskTaskResolutionUiResult = {
  task_id: string;
  display_id: string | null;
  case_id: string;
  resolution_state: 'waived';
  task_status: 'cancelled';
  updated_count: number;
  audit_logged: boolean;
};

type RiskTaskWaiverReasonCode = 'pharmacist_reviewed' | 'duplicate_or_stale' | 'not_applicable';

const RISK_TASK_WAIVER_REASON_OPTIONS: Array<{
  value: RiskTaskWaiverReasonCode;
  label: string;
}> = [
  { value: 'pharmacist_reviewed', label: '薬剤師判断で免除' },
  { value: 'duplicate_or_stale', label: '重複・古いタスク' },
  { value: 'not_applicable', label: '今回対象外' },
];

function buildCaseRiskTaskSyncPath(caseId: string) {
  return `/api/cases/${encodePathSegment(caseId)}/risk-cockpit/tasks`;
}

function buildCaseRiskCockpitPath(caseId: string) {
  return `/api/cases/${encodePathSegment(caseId)}/risk-cockpit`;
}

function buildCaseRiskTaskResolutionPath(caseId: string, taskId: string) {
  return `/api/cases/${encodePathSegment(caseId)}/risk-cockpit/tasks/${encodePathSegment(taskId)}/resolution`;
}

function selectLatestPatientCase(cases: PatientOverview['cases']) {
  return (
    [...cases].sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) ||
        b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id),
    )[0] ?? null
  );
}

function selectCommandCenterCase(cases: PatientOverview['cases']) {
  return cases.find((careCase) => careCase.status === 'active') ?? selectLatestPatientCase(cases);
}

function PatientDetailPanelLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="rounded-lg border border-border/70 bg-card p-4"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

const FirstVisitDocumentsPanel = dynamic<FirstVisitDocumentsPanelProps>(
  () => import('./patient-documents-panel').then((mod) => mod.FirstVisitDocumentsPanel),
  {
    loading: () => <PatientDetailPanelLoading label="初回訪問文書を読み込み中" />,
  },
);

const PatientContactsPanel = dynamic<PatientContactsPanelProps>(
  () => import('./patient-contacts-panel').then((mod) => mod.PatientContactsPanel),
  {
    loading: () => <PatientDetailPanelLoading label="連絡先を読み込み中" />,
  },
);

const PatientFieldRevisionTimeline = dynamic<PatientIdPanelProps>(
  () =>
    import('@/components/features/patients/patient-field-revision-timeline').then(
      (mod) => mod.PatientFieldRevisionTimeline,
    ),
  {
    loading: () => <PatientDetailPanelLoading label="変更履歴を読み込み中" />,
  },
);

const PatientStructuredCarePanel = dynamic<PatientIdPanelProps>(
  () =>
    import('@/components/features/patients/patient-structured-care-panel').then(
      (mod) => mod.PatientStructuredCarePanel,
    ),
  {
    loading: () => <PatientDetailPanelLoading label="構造化ケア情報を読み込み中" />,
  },
);

const PatientMovementTimelinePanel = dynamic<PatientMovementTimelineProps>(
  () => import('./patient-movement-timeline').then((mod) => mod.PatientMovementTimeline),
  {
    loading: () => <PatientDetailPanelLoading label="患者の動きを読み込み中" />,
  },
);

/**
 * design/images/new 06_card: カード = 1 処方サイクル(1 RX 番号)の作業台。
 * 患者識別と主要アクションは固定の上部領域に置き、詳細情報はタブで分割する。
 * 患者プロフィール情報はこのカード内に統合し、旧 profile 画面へ分岐しない。
 */

/** 直近の動き: 種別 → 行頭バッジ表示 */
const ACTIVITY_TYPE_LABELS: Record<PatientWorkspaceActivity['type'], string> = {
  transition: '工程',
  inquiry: '照会',
  intake: '取込',
};

// 直近の動き種別は state 軸（ラベル併記で識別。色は SSOT 6軸へ）。
// transition=info / inquiry=confirm(cycle inquiry_pending と整合) / intake=neutral。
const ACTIVITY_BADGE_CLASSES: Record<PatientWorkspaceActivity['type'], string> = {
  transition: 'border-transparent bg-tag-info/10 text-tag-info',
  inquiry: 'border-transparent bg-state-confirm/10 text-state-confirm',
  intake: 'border-border bg-muted text-muted-foreground',
};

/** このカードに紐づく今日: トーン → 時刻ピル配色(期限=止まる/順序待ち=中立/時刻確定=完了) */
const TODAY_TONE_CLASSES: Record<PatientWorkspaceTodayTask['tone'], string> = {
  deadline: 'border-transparent bg-state-blocked/10 text-state-blocked',
  waiting: 'border-border bg-muted text-muted-foreground',
  scheduled: 'border-transparent bg-state-done/10 text-state-done',
};

function buildPatientCompareHref(patientId: string) {
  return `/patients/compare?${new URLSearchParams({ patients: patientId }).toString()}`;
}

const SSR_PATIENT_OVERVIEW_STALE_TIME_MS = 30_000;
const PATIENT_TIMELINE_INITIAL_LIMIT = 5;
const PATIENT_TIMELINE_FULL_LIMIT = 40;

type PatientDetailTab =
  | 'command'
  | 'foundation'
  | 'medication'
  | 'movement'
  | 'sharing'
  | 'billing'
  | 'history';

const PATIENT_DETAIL_TABS: Array<{ value: PatientDetailTab; label: string; description: string }> =
  [
    {
      value: 'command',
      label: 'Command',
      description: '次のアクション、ブロッカー、今日のタスク',
    },
    {
      value: 'foundation',
      label: '正本・在宅運用',
      description: '正本確認、プロフィール、連絡先',
    },
    {
      value: 'medication',
      label: '薬剤・訪問',
      description: '今回の処方、訪問前確認、直近の動き',
    },
    {
      value: 'movement',
      label: '患者の動き',
      description: '訪問、処方、文書登録、連絡を時系列で確認',
    },
    {
      value: 'sharing',
      label: '共有・文書',
      description: '薬局間共有、初回訪問文書、外部連携',
    },
    {
      value: 'billing',
      label: '請求・会議',
      description: '請求、集金、会議要点、報告連携',
    },
    {
      value: 'history',
      label: '履歴・構造化',
      description: '変更履歴、在宅医療処置・麻薬',
    },
  ];

const PATIENT_DETAIL_HASH_TABS: Record<string, PatientDetailTab> = {
  'patient-foundation': 'foundation',
  'patient-profile-summary': 'foundation',
  'patient-contacts': 'foundation',
  'patient-home-operations': 'billing',
  'patient-billing': 'billing',
  'patient-conference': 'billing',
  'card-prescription-section': 'medication',
  'patient-visit-preparation': 'medication',
  'patient-movement': 'movement',
  'inbound-communications': 'movement',
  'inbound-signals': 'movement',
  'medication-stock-events': 'movement',
  'patient-share-case': 'sharing',
  'patient-documents': 'sharing',
  'patient-field-revisions': 'history',
  'patient-structured-care': 'history',
};

function resolvePatientDetailTabFromHash(hash: string): PatientDetailTab | null {
  const normalized = hash.replace(/^#/, '');
  return PATIENT_DETAIL_HASH_TABS[normalized] ?? null;
}

function resolveInitialPatientDetailTab(): PatientDetailTab {
  if (typeof window === 'undefined') return 'command';
  return resolvePatientDetailTabFromHash(window.location.hash) ?? 'command';
}

type PharmacyPartnershipOption = {
  id: string;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  base_site: { id: string; name: string };
  partner_pharmacy: { id: string; name: string; status: string };
};

type PharmacyPartnershipListResponse = {
  data: PharmacyPartnershipOption[];
};

type PatientShareScopeKey =
  | 'prescription_history'
  | 'medication_profile'
  | 'care_reports'
  | 'attachments'
  | 'print'
  | 'pdf_output'
  | 'download';

type PatientShareScopeForm = Record<PatientShareScopeKey, boolean>;

type PatientShareCaseCreateForm = {
  partnershipId: string;
  caseId: string;
  startsAt: string;
  endsAt: string;
  managementPlanId: string;
  shareScope: PatientShareScopeForm;
};

type PatientShareCaseCreateInput = {
  partnership_id: string;
  base_patient_id: string;
  base_case_id?: string;
  starts_at?: string;
  ends_at?: string;
  shared_management_plan_id?: string;
  shared_management_plan_version?: number;
  share_scope: PatientShareScopeForm;
};

type PatientShareCaseCreateResponse = {
  data: {
    id: string;
    status: string;
  };
};

type ManagementPlanOption = {
  id: string;
  case_id: string;
  title: string;
  version: number;
  status: 'draft' | 'approved' | 'superseded' | 'archived';
  effective_from: string | null;
  updated_at: string;
};

type ManagementPlanListResponse = {
  data: ManagementPlanOption[];
};

const PATIENT_SHARE_SCOPE_OPTIONS: Array<{
  key: PatientShareScopeKey;
  label: string;
  description: string;
}> = [
  {
    key: 'prescription_history',
    label: '処方歴',
    description: '処方・服薬履歴の閲覧を許可',
  },
  {
    key: 'medication_profile',
    label: '薬歴',
    description: '服薬状況・薬学的管理情報の閲覧を許可',
  },
  {
    key: 'care_reports',
    label: '報告書',
    description: '服薬指導報告書の閲覧を許可',
  },
  {
    key: 'attachments',
    label: '添付閲覧',
    description: '同意添付などの閲覧を許可',
  },
  {
    key: 'print',
    label: '印刷',
    description: '共有情報の印刷を許可',
  },
  {
    key: 'pdf_output',
    label: 'PDF出力',
    description: 'PDF出力を許可',
  },
  {
    key: 'download',
    label: 'ダウンロード',
    description: 'ファイルダウンロードを許可',
  },
];

const DEFAULT_PATIENT_SHARE_SCOPE_FORM: PatientShareScopeForm = {
  prescription_history: true,
  medication_profile: true,
  care_reports: true,
  attachments: false,
  print: false,
  pdf_output: false,
  download: false,
};

function formatQuantityLabel(line: {
  quantity: number | null;
  unit: string | null;
  days: number;
}): string {
  if (line.quantity != null) {
    return `${line.quantity}${line.unit ?? ''}`;
  }
  return `${line.days}日分`;
}

const prescriptionWorkspaceLineColumns: ColumnDef<PatientWorkspacePrescriptionLine>[] = [
  {
    accessorKey: 'drug_name',
    header: '薬剤',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">{row.original.drug_name}</span>
    ),
  },
  {
    accessorKey: 'frequency',
    header: '用法',
    cell: ({ row }) => (
      <span>
        {row.original.frequency} {row.original.dose}
      </span>
    ),
  },
  {
    id: 'quantity',
    header: '数量',
    accessorFn: (row) => formatQuantityLabel(row),
  },
  {
    id: 'safety',
    header: '安全',
    cell: ({ row }) => {
      const tags = row.original.packaging_instruction_tags;
      if (tags.length === 0) return null;
      return (
        <span className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                getHandlingTagBadgeClass(tag),
              )}
            >
              {getHandlingTagLabel(tag)}
            </span>
          ))}
        </span>
      );
    },
  },
];

function SectionCard({ children, className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('rounded-lg border border-border/70 bg-card p-4', className)} {...props}>
      {children}
    </section>
  );
}

function PatientCardDocumentsLoadingState() {
  return (
    <div className="space-y-4" role="status" aria-label="初回訪問文書・交付記録を読み込み中">
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">初回訪問文書・交付記録</h3>
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}

function PatientCardWorkspaceLoadingState() {
  return (
    <div
      className="space-y-6"
      data-testid="card-workspace-loading"
      role="status"
      aria-label="処方カード作業台を読み込み中"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-xl font-bold leading-snug text-foreground">処方カード作業台</h1>
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-36 max-sm:hidden" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <SectionCard>
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <div className="grid gap-3 md:grid-cols-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            </div>
          </SectionCard>
          <SectionCard>
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </SectionCard>
        </div>
        <SectionCard className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </SectionCard>
      </div>
    </div>
  );
}

function formatGenderLabel(gender: string): string {
  if (gender === 'male') return '男性';
  if (gender === 'female') return '女性';
  return 'その他';
}

function formatResidenceLabel(patient: PatientOverview): string {
  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;
  if (!primaryResidence) return '住所未設定';
  const residenceType = primaryResidence.facility_id ? '施設' : '自宅';
  return primaryResidence.unit_name
    ? `${residenceType} / ${primaryResidence.unit_name}`
    : residenceType;
}

function formatParkingLabel(patient: PatientOverview): string {
  const parking = patient.scheduling_preference?.parking_available;
  if (parking === true) return '駐車場あり';
  if (parking === false) return '駐車場なし';
  return '未確認';
}

function formatPreferredContact(patient: PatientOverview): string {
  const preference = patient.scheduling_preference;
  if (preference?.preferred_contact_name) return preference.preferred_contact_name;
  if (preference?.preferred_contact_phone) return preference.preferred_contact_phone;
  if (patient.phone) return patient.phone;
  return '未設定';
}

function formatVisitDate(value: string | null | undefined) {
  if (!value) return '未設定';
  return formatOptionalDate(value.slice(0, 10));
}

function formatPatientShareCaseOption(careCase: PatientOverview['cases'][number]) {
  const displayLabel = careCase.display_id?.trim()
    ? formatDisplayEntityLabel(careCase, { fallbackLength: 6 })
    : `#${formatDisplayEntityLabel(careCase, { fallbackLength: 6 }).toUpperCase()}`;
  const status = CASE_STATUS_LABELS[careCase.status] ?? careCase.status;
  return `ケース ${displayLabel} / ${status}`;
}

async function readPatientShareApiJson<T>(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | { message?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.message ?? fallbackMessage);
  }
  return payload as T;
}

function buildPatientShareCaseCreateInput(args: {
  patientId: string;
  form: PatientShareCaseCreateForm;
  partnershipId: string;
  caseId: string;
  selectedPlan: ManagementPlanOption | null;
}): PatientShareCaseCreateInput {
  return {
    partnership_id: args.partnershipId,
    base_patient_id: args.patientId,
    ...(args.caseId ? { base_case_id: args.caseId } : {}),
    ...(args.form.startsAt ? { starts_at: args.form.startsAt } : {}),
    ...(args.form.endsAt ? { ends_at: args.form.endsAt } : {}),
    ...(args.selectedPlan
      ? {
          shared_management_plan_id: args.selectedPlan.id,
          shared_management_plan_version: args.selectedPlan.version,
        }
      : {}),
    share_scope: args.form.shareScope,
  };
}

function buildVisitScheduleLabel(patient: PatientOverview) {
  const now = new Date();
  const schedules = patient.visit_schedules
    .map((schedule) => ({
      ...schedule,
      date: parseISO(schedule.scheduled_date),
    }))
    .filter((schedule) => !Number.isNaN(schedule.date.getTime()));
  const latest = schedules.find((schedule) => schedule.visit_record) ?? schedules[0] ?? null;
  const next =
    [...schedules].reverse().find((schedule) => schedule.date >= now && !schedule.visit_record) ??
    null;
  // time_window_start は @db.Time の UTC parts 由来で "1970-01-01THH:MM:SS.sssZ" 形式の
  // ISO 文字列として届く。壁時計表示のため TZ シフトを避けて UTC の HH:MM 部分のみ取り出す。
  const formatWallClock = (value: string) =>
    value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
  return {
    latest: latest ? format(latest.date, 'M/d', { locale: ja }) : '未設定',
    next: next
      ? `${format(next.date, 'M/d', { locale: ja })}${
          next.time_window_start ? ` ${formatWallClock(next.time_window_start)}` : ''
        }`
      : '未設定',
  };
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'risk';
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-border/60 bg-muted/30 p-3',
        tone === 'warn' && 'border-l-4 border-l-state-confirm',
        tone === 'risk' && 'border-l-4 border-l-state-blocked',
      )}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 flex items-center gap-1 font-semibold tabular-nums',
          tone === 'risk'
            ? 'text-state-blocked'
            : tone === 'warn'
              ? 'text-state-confirm'
              : 'text-foreground',
        )}
      >
        {tone ? (
          <TriangleAlert
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              tone === 'risk' ? 'text-state-blocked' : 'text-state-confirm',
            )}
          />
        ) : null}
        {value}
      </dd>
    </div>
  );
}

type HomeOpsItem = PatientHomeOperationItem & { icon: typeof FileText };

const HOME_OPS_TONE_CLASSES: Record<HomeOpsItem['tone'], string> = {
  ok: 'border-transparent bg-state-done/10 text-state-done',
  attention: 'border-transparent bg-state-confirm/10 text-state-confirm',
  neutral: 'border-border/70 bg-muted/20 text-foreground',
};

const FOUNDATION_STATUS_CLASSES: Record<
  PatientOverview['foundation']['summary']['status'],
  string
> = {
  ready: 'border-transparent bg-state-done/10 text-state-done',
  needs_confirmation: 'border-transparent bg-state-confirm/10 text-state-confirm',
  missing: 'border-transparent bg-state-blocked/10 text-state-blocked',
};

// A2: 各項目タイルは全面塗りを引き算し、左ボーダー + ステータスラベルのみに状態色を限定する
// (アラート色は 4 段階アラートへ温存。SSOT L406-410)。
const FOUNDATION_STATUS_ACCENT: Record<PatientOverview['foundation']['summary']['status'], string> =
  {
    ready: 'border-l-state-done',
    needs_confirmation: 'border-l-state-confirm',
    missing: 'border-l-state-blocked',
  };

const FOUNDATION_STATUS_TEXT: Record<PatientOverview['foundation']['summary']['status'], string> = {
  ready: 'text-state-done',
  needs_confirmation: 'text-state-confirm',
  missing: 'text-state-blocked',
};

const FOUNDATION_STATUS_LABELS: Record<PatientOverview['foundation']['summary']['status'], string> =
  {
    ready: '確認済',
    needs_confirmation: '要確認',
    missing: '停止中',
  };

const HOME_OPS_ICONS: Record<PatientHomeOperationKey, typeof FileText> = {
  documents: FileText,
  mcs: Link2,
  prescription: Pill,
  billing: CircleDollarSign,
  conference: CalendarDays,
};

const HOME_OPS_ALERT_LIMIT = 6;

function withHomeOperationIcon(item: PatientHomeOperationItem): HomeOpsItem {
  return {
    ...item,
    icon: HOME_OPS_ICONS[item.key],
  };
}

function PatientHomeOperationsPanel({
  patient,
  operations,
  operationsError = false,
  onRetryOperations,
  markingFaxOriginalIntakeId,
  savingPrescriptionDocumentIntakeId,
  recordingPrescriptionOriginalManagementIntakeId,
  recordingBillingPaymentProfilePatientId,
  recordingBillingCandidateId,
  recordingConferenceScopeId,
  recordingMcsCheckPatientId,
  onMarkFaxOriginalCollected,
  onSavePrescriptionDocument,
  onUploadPrescriptionDocument,
  onRecordPrescriptionOriginalManagement,
  onRecordBillingPaymentProfile,
  onRecordBillingCollection,
  onRecordConferenceNote,
  onRecordMcsCheckLog,
  visibleKeys,
  panelId = 'patient-home-operations',
}: {
  patient: PatientOverview;
  operations?: PatientHomeOperationsSnapshot | null;
  /** サーバー集計の取得失敗。true のときは近似表示である旨を明示し、全クリア表示を出さない。 */
  operationsError?: boolean;
  onRetryOperations?: () => void;
  markingFaxOriginalIntakeId?: string | null;
  savingPrescriptionDocumentIntakeId?: string | null;
  recordingPrescriptionOriginalManagementIntakeId?: string | null;
  recordingBillingPaymentProfilePatientId?: string | null;
  recordingBillingCandidateId?: string | null;
  recordingConferenceScopeId?: string | null;
  recordingMcsCheckPatientId?: string | null;
  onMarkFaxOriginalCollected?: (intakeId: string) => void;
  onSavePrescriptionDocument?: (input: PrescriptionDocumentFormInput) => void;
  onUploadPrescriptionDocument?: (file: File) => Promise<string>;
  onRecordPrescriptionOriginalManagement?: (input: PrescriptionOriginalManagementFormInput) => void;
  onRecordBillingPaymentProfile?: (input: BillingPaymentProfileFormInput) => void;
  onRecordBillingCollection?: (input: BillingCollectionFormInput) => void;
  onRecordConferenceNote?: (input: ConferenceNoteFormInput) => void;
  onRecordMcsCheckLog?: (input: McsCheckLogFormInput) => void;
  visibleKeys?: PatientHomeOperationKey[];
  panelId?: string;
}) {
  const visibleKeySet = visibleKeys ? new Set<PatientHomeOperationKey>(visibleKeys) : null;
  const items = (operations?.items ?? buildHomeOperationsItems(patient))
    .filter((item) => !visibleKeySet || visibleKeySet.has(item.key))
    .map(withHomeOperationIcon);
  const attentionCount = items.filter((item) => item.tone === 'attention').length;
  const topAlerts =
    operations?.top_alerts ??
    items.flatMap((item) =>
      item.alerts.map((message, index) => ({
        id: `${item.key}:${index}:${message}`,
        key: item.key,
        label: item.label,
        message,
        href: item.href,
        action_label: item.action_label,
      })),
    );
  const filteredTopAlerts = visibleKeySet
    ? topAlerts.filter((alert) => visibleKeySet.has(alert.key))
    : topAlerts;
  const [expandedMetricKeys, setExpandedMetricKeys] = useState<Set<PatientHomeOperationKey>>(
    () => new Set(),
  );

  const toggleMetricExpansion = (key: PatientHomeOperationKey) => {
    setExpandedMetricKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <SectionCard id={panelId} aria-label="在宅運用管理" data-testid="patient-home-operations-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">在宅運用管理</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            契約、外部連携、処方せん、集金、会議を患者単位で確認し、既存の詳細画面へ移ります。
          </p>
        </div>
        <span
          className={cn(
            'inline-flex min-h-8 items-center rounded-full border border-transparent px-3 text-xs font-medium',
            operationsError
              ? 'bg-state-blocked/10 text-state-blocked'
              : attentionCount > 0
                ? 'bg-state-confirm/10 text-state-confirm'
                : 'bg-state-done/10 text-state-done',
          )}
        >
          {operationsError
            ? 'サーバー集計 取得失敗'
            : attentionCount > 0
              ? `要確認 ${attentionCount}件`
              : '主要項目 確認済み'}
        </span>
      </div>
      {operationsError ? (
        // 取得失敗を全クリア表示に潰さない(false-empty禁止)。近似表示である旨と欠けうる情報を明示し、
        // 再試行導線を付ける(SSOT 6.3: 原因+次の行動+再試行)。
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border/70 border-l-4 border-l-state-blocked bg-card p-3"
          data-testid="patient-home-operations-error"
        >
          <p className="min-w-0 flex-1 text-sm leading-6 text-foreground">
            在宅運用管理のサーバー集計を取得できませんでした。以下は端末側の近似表示で、FAX原本の回収期限や未収金などサーバー算出のアラートが欠けている可能性があります。再読み込みしても直らない場合は時間をおいて再試行してください。
          </p>
          {onRetryOperations ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetryOperations}>
              再試行
            </Button>
          ) : null}
        </div>
      ) : null}
      {filteredTopAlerts.length > 0 ? (
        <div
          className="mt-4 rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-3"
          data-testid="patient-home-operation-alerts"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-state-confirm">未処理アラート</h4>
            <span className="text-xs font-medium text-state-confirm">
              {filteredTopAlerts.length}件を上から確認
            </span>
          </div>
          <ul className="mt-2 divide-y divide-state-confirm/20" role="list">
            {filteredTopAlerts.slice(0, HOME_OPS_ALERT_LIMIT).map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="rounded-full border border-state-confirm/30 bg-background/70 px-2 py-0.5 text-xs font-medium text-state-confirm">
                  {alert.label}
                </span>
                <span className="min-w-0 flex-1 text-sm text-foreground">{alert.message}</span>
                <Link
                  href={alert.href}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                    className: 'min-h-8 shrink-0 bg-background/80',
                  })}
                >
                  {alert.action_label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const priorityMetrics = selectHomeOperationMetrics(item);
          const isMetricExpanded = expandedMetricKeys.has(item.key);
          const visibleMetrics = isMetricExpanded ? item.metrics : priorityMetrics;
          const hiddenMetricCount = item.metrics.length - priorityMetrics.length;
          return (
            <div
              key={item.key}
              className={cn('rounded-lg border p-3', HOME_OPS_TONE_CLASSES[item.tone])}
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{item.label}</h4>
                    <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
                  {item.metrics.length > 0 ? (
                    <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
                      {visibleMetrics.map((metric) => (
                        <div key={metric.label} className="flex justify-between gap-2">
                          <dt>{metric.label}</dt>
                          <dd className="font-medium text-foreground">{metric.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {hiddenMetricCount > 0 ? (
                    <button
                      type="button"
                      className="mt-2 inline-flex min-h-8 items-center text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-expanded={isMetricExpanded}
                      onClick={() => toggleMetricExpansion(item.key)}
                    >
                      {isMetricExpanded
                        ? '主要4項目に戻す'
                        : `全指標を表示（残り${hiddenMetricCount}件）`}
                    </button>
                  ) : null}
                  {item.alerts.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-xs text-state-confirm">
                      {item.alerts.slice(0, 2).map((alert) => (
                        <li key={alert}>{alert}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              {item.quick_actions?.map((action) => {
                if (action.key === 'record_billing_payment_profile') {
                  return (
                    <BillingPaymentProfileQuickForm
                      key={action.key}
                      actionLabel={action.label}
                      patientId={action.resource_id}
                      item={item}
                      isPending={recordingBillingPaymentProfilePatientId === action.resource_id}
                      onSubmit={onRecordBillingPaymentProfile}
                    />
                  );
                }
                if (action.key === 'record_billing_collection') {
                  return (
                    <BillingCollectionQuickForm
                      key={action.key}
                      actionLabel={action.label}
                      candidateId={action.resource_id}
                      item={item}
                      isPending={recordingBillingCandidateId === action.resource_id}
                      onSubmit={onRecordBillingCollection}
                    />
                  );
                }
                if (action.key === 'save_prescription_document') {
                  return (
                    <PrescriptionDocumentQuickForm
                      key={action.key}
                      actionLabel={action.label}
                      intakeId={action.resource_id}
                      isPending={savingPrescriptionDocumentIntakeId === action.resource_id}
                      onSubmit={onSavePrescriptionDocument}
                      onUpload={onUploadPrescriptionDocument}
                    />
                  );
                }
                if (action.key === 'record_prescription_original_management') {
                  return (
                    <PrescriptionOriginalManagementQuickForm
                      key={action.key}
                      actionLabel={action.label}
                      intakeId={action.resource_id}
                      isPending={
                        recordingPrescriptionOriginalManagementIntakeId === action.resource_id
                      }
                      onSubmit={onRecordPrescriptionOriginalManagement}
                    />
                  );
                }
                if (action.key === 'record_conference_note') {
                  const caseId = queryParamValue(item.href, 'case_id');
                  const scopeId = caseId ? `case:${caseId}` : `patient:${patient.id}`;
                  return (
                    <ConferenceNoteQuickForm
                      key={action.key}
                      actionLabel={action.label}
                      patientName={patient.name}
                      patientId={patient.id}
                      caseId={caseId}
                      isPending={recordingConferenceScopeId === scopeId}
                      onSubmit={onRecordConferenceNote}
                    />
                  );
                }
                if (action.key === 'open_visit_proposal') {
                  const caseId = queryParamValue(item.href, 'case_id');
                  const href = `/schedules/proposals?${new URLSearchParams({
                    workspace: 'dashboard',
                    patient_id: patient.id,
                    ...(caseId ? { case_id: caseId } : {}),
                    focus: 'patient',
                    detail: action.resource_id,
                  }).toString()}`;
                  return (
                    <Link
                      key={action.key}
                      href={href}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'mt-3 min-h-10 w-full justify-center bg-background/80',
                      })}
                    >
                      <CalendarDays className="mr-1.5 size-4" aria-hidden="true" />
                      {action.label}
                    </Link>
                  );
                }
                if (action.key === 'record_mcs_check_log') {
                  return (
                    <McsCheckLogQuickForm
                      key={action.key}
                      actionLabel={action.label}
                      patientId={action.resource_id}
                      isPending={recordingMcsCheckPatientId === action.resource_id}
                      onSubmit={onRecordMcsCheckLog}
                    />
                  );
                }
                if (action.key !== 'mark_fax_original_collected') return null;
                const pending = markingFaxOriginalIntakeId === action.resource_id;
                return (
                  <Button
                    key={action.key}
                    type="button"
                    size="sm"
                    className="mt-3 min-h-10 w-full justify-center"
                    disabled={pending}
                    onClick={() => onMarkFaxOriginalCollected?.(action.resource_id)}
                  >
                    <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                    {pending ? '記録中' : action.label}
                  </Button>
                );
              })}
              {item.external_href ? (
                <Link
                  href={item.external_href}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                    className: 'mt-3 min-h-10 w-full justify-center bg-background/80',
                  })}
                >
                  <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
                  {item.external_action_label ?? '外部サービスを開く'}
                </Link>
              ) : null}
              <Link
                href={item.href}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'mt-3 min-h-10 w-full justify-center bg-background/80',
                })}
              >
                <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
                {item.action_label}
              </Link>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function PatientShareCaseCreatePanel({
  patient,
  orgId,
}: {
  patient: PatientOverview;
  orgId: string;
}) {
  const queryClient = useQueryClient();
  const initialCaseId =
    patient.cases.find((careCase) => careCase.status === 'active')?.id ??
    patient.cases[0]?.id ??
    '';
  const [form, setForm] = useState<PatientShareCaseCreateForm>(() => ({
    partnershipId: '',
    caseId: initialCaseId,
    startsAt: '',
    endsAt: '',
    managementPlanId: '',
    shareScope: { ...DEFAULT_PATIENT_SHARE_SCOPE_FORM },
  }));
  const [createError, setCreateError] = useState<string | null>(null);

  const partnershipsQuery = useQuery<PharmacyPartnershipListResponse>({
    queryKey: ['pharmacy-partnerships', 'active', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-partnerships?status=active&limit=20', {
        headers: buildOrgHeaders(orgId),
      });
      return readPatientShareApiJson<PharmacyPartnershipListResponse>(
        response,
        '薬局間連携を取得できませんでした',
      );
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });

  const partnerships = partnershipsQuery.data?.data ?? [];
  const effectivePartnershipId = partnerships.some((row) => row.id === form.partnershipId)
    ? form.partnershipId
    : (partnerships[0]?.id ?? '');
  const selectedPartnership = partnerships.find((row) => row.id === effectivePartnershipId) ?? null;
  const effectiveCaseId = patient.cases.some((careCase) => careCase.id === form.caseId)
    ? form.caseId
    : initialCaseId;

  const managementPlansQuery = useQuery<ManagementPlanListResponse>({
    queryKey: ['management-plans', effectiveCaseId, orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ case_id: effectiveCaseId });
      const response = await fetch(`/api/management-plans?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readPatientShareApiJson<ManagementPlanListResponse>(
        response,
        '管理計画書を取得できませんでした',
      );
    },
    enabled: Boolean(orgId && effectiveCaseId),
    staleTime: 30_000,
  });

  const approvedPlans = (managementPlansQuery.data?.data ?? []).filter(
    (plan) => plan.status === 'approved',
  );
  const managementPlansFailed = managementPlansQuery.isError;
  const selectedPlan = managementPlansFailed
    ? null
    : (approvedPlans.find((plan) => plan.id === form.managementPlanId) ?? null);
  const hasInvalidDateWindow =
    form.startsAt.length > 0 && form.endsAt.length > 0 && form.endsAt < form.startsAt;
  const isArchived = Boolean(patient.archived_at);

  const createMutation = useMutation({
    mutationFn: async (input: PatientShareCaseCreateInput) => {
      const response = await fetch('/api/patient-share-cases', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(input),
      });
      return readPatientShareApiJson<PatientShareCaseCreateResponse>(
        response,
        '患者共有ケースの作成に失敗しました',
      );
    },
    onSuccess: async () => {
      toast.success('患者共有ケースを下書き作成しました');
      setCreateError(null);
      setForm((current) => ({
        ...current,
        startsAt: '',
        endsAt: '',
        managementPlanId: '',
        shareScope: { ...DEFAULT_PATIENT_SHARE_SCOPE_FORM },
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patient.id, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-share-cases', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['patient-share-cases', patient.id, orgId] }),
      ]);
    },
    onError: (error: Error) => {
      const message = error.message || '患者共有ケースの作成に失敗しました';
      setCreateError(message);
      toast.error(message);
    },
  });

  const canCreate =
    Boolean(effectivePartnershipId) &&
    !hasInvalidDateWindow &&
    !isArchived &&
    !partnershipsQuery.isLoading &&
    !createMutation.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || !effectivePartnershipId) return;
    setCreateError(null);
    createMutation.mutate(
      buildPatientShareCaseCreateInput({
        patientId: patient.id,
        form,
        partnershipId: effectivePartnershipId,
        caseId: effectiveCaseId,
        selectedPlan,
      }),
    );
  }

  return (
    <SectionCard
      id="patient-share-case"
      aria-label="薬局間共有ケース"
      data-testid="patient-share-case-create-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">薬局間共有ケース</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            この患者を協力薬局へ共有する下書きを作成します。共有開始は同意と患者リンク確認後に行います。
          </p>
        </div>
        <Link
          href="/workflow/pharmacy-cooperation"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          共有ワークフローへ
        </Link>
      </div>

      <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-3 rounded-md border border-border/60 bg-muted/30 p-3 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="patient-share-partnership">共有先の協力薬局</Label>
            <select
              id="patient-share-partnership"
              value={effectivePartnershipId}
              onChange={(event) =>
                setForm((current) => ({ ...current, partnershipId: event.target.value }))
              }
              disabled={partnershipsQuery.isLoading || partnerships.length === 0 || isArchived}
              aria-label="共有ケース作成の連携先"
              className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {partnerships.length === 0 ? <option value="">有効な連携なし</option> : null}
              {partnerships.map((partnership) => (
                <option key={partnership.id} value={partnership.id}>
                  {partnership.base_site.name} / {partnership.partner_pharmacy.name}
                </option>
              ))}
            </select>
            {selectedPartnership ? (
              <p className="text-xs text-muted-foreground">
                連携 {selectedPartnership.id} / 状態 {selectedPartnership.status}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="patient-share-case">対象ケース（任意）</Label>
            <select
              id="patient-share-case"
              value={effectiveCaseId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  caseId: event.target.value,
                  managementPlanId: '',
                }))
              }
              disabled={patient.cases.length === 0 || isArchived}
              aria-label="共有ケース作成の対象ケース"
              className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {patient.cases.length === 0 ? <option value="">ケースなし</option> : null}
              {patient.cases.map((careCase) => (
                <option key={careCase.id} value={careCase.id}>
                  {formatPatientShareCaseOption(careCase)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="patient-share-start">共有開始日</Label>
            <Input
              id="patient-share-start"
              type="date"
              value={form.startsAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, startsAt: event.target.value }))
              }
              disabled={isArchived}
              aria-label="共有ケース作成の共有開始日"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="patient-share-end">共有終了日</Label>
            <Input
              id="patient-share-end"
              type="date"
              value={form.endsAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, endsAt: event.target.value }))
              }
              disabled={isArchived}
              aria-label="共有ケース作成の共有終了日"
              aria-invalid={hasInvalidDateWindow ? true : undefined}
            />
            {hasInvalidDateWindow ? (
              <p className="text-xs text-destructive">終了日は開始日以降を指定してください。</p>
            ) : null}
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="patient-share-management-plan">対象の管理計画版（任意）</Label>
            <select
              id="patient-share-management-plan"
              value={selectedPlan?.id ?? ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, managementPlanId: event.target.value }))
              }
              disabled={
                !effectiveCaseId ||
                approvedPlans.length === 0 ||
                managementPlansQuery.isLoading ||
                managementPlansFailed ||
                isArchived
              }
              aria-label="共有ケース作成の管理計画版"
              className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">
                {managementPlansQuery.isLoading
                  ? '管理計画を取得中'
                  : managementPlansFailed
                    ? '管理計画を取得できませんでした'
                    : approvedPlans.length === 0
                      ? '承認済み計画なし'
                      : '選択しない'}
              </option>
              {managementPlansFailed
                ? null
                : approvedPlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      計画 {plan.id} / v{plan.version}
                    </option>
                  ))}
            </select>
            {managementPlansFailed ? (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
              >
                <p>
                  管理計画書を取得できませんでした。対象計画を付ける場合は再試行してください。共有ケースは計画を付けずに作成できます。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void managementPlansQuery.refetch()}
                  disabled={managementPlansQuery.isRefetching}
                >
                  再試行
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <fieldset className="rounded-md border border-border/60 bg-background p-3">
          <legend className="px-1 text-sm font-medium text-foreground">共有範囲</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PATIENT_SHARE_SCOPE_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="flex min-h-11 items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={form.shareScope[option.key]}
                  disabled={isArchived}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      shareScope: {
                        ...current.shareScope,
                        [option.key]: event.target.checked,
                      },
                    }))
                  }
                  aria-label={`共有範囲 ${option.label}`}
                  className="mt-1 size-4"
                />
                <span>
                  <span className="block font-medium text-foreground">{option.label}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {partnershipsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            有効な薬局間連携を取得できませんでした。
          </p>
        ) : null}
        {partnerships.length === 0 && !partnershipsQuery.isLoading ? (
          <div className="rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card p-3 text-sm text-state-confirm">
            有効な薬局間連携がありません。協力薬局設定で連携を有効化してから作成してください。
          </div>
        ) : null}
        {isArchived ? (
          <p role="alert" className="text-sm text-destructive">
            アーカイブ中の患者では共有ケースを作成できません。
          </p>
        ) : null}
        {createError ? (
          <p role="alert" className="text-sm text-destructive">
            {createError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canCreate} className="min-h-11">
            <Link2 className="size-4" aria-hidden="true" />
            {createMutation.isPending ? '作成中...' : '共有ケースを作成'}
          </Button>
          <p className="text-xs text-muted-foreground">
            作成後は共有ワークフローで同意、患者リンク、共有開始を順に確認します。
          </p>
        </div>
      </form>
    </SectionCard>
  );
}

function PatientCardDocumentsPanel({
  patient,
  orgId,
}: {
  patient: PatientOverview;
  orgId: string | null;
}) {
  const documentsQuery = useQuery<PatientDocumentsSnapshot>({
    queryKey: ['patient-documents', patient.id, orgId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${encodePathSegment(patient.id)}/documents`, {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      const payload = await readApiJson<{ data: PatientDocumentsSnapshot }>(response, {
        fallbackMessage: '文書情報の取得に失敗しました',
      });
      return payload.data;
    },
    enabled: Boolean(orgId && patient.id),
  });

  if (!orgId || documentsQuery.isLoading) {
    return (
      <SectionCard id="patient-documents" data-testid="patient-card-documents-panel">
        <PatientCardDocumentsLoadingState />
      </SectionCard>
    );
  }

  if (documentsQuery.error instanceof Error || !documentsQuery.data) {
    return (
      <SectionCard id="patient-documents" data-testid="patient-card-documents-panel">
        <h3 className="text-base font-semibold text-foreground">初回訪問文書・交付記録</h3>
        <p className="mt-2 text-sm text-destructive">
          {documentsQuery.error instanceof Error
            ? documentsQuery.error.message
            : '文書情報の取得に失敗しました'}
        </p>
      </SectionCard>
    );
  }

  return (
    <div id="patient-documents" data-testid="patient-card-documents-panel">
      <FirstVisitDocumentsPanel
        cases={patient.cases}
        documents={documentsQuery.data.first_visit_documents}
        documentStatuses={documentsQuery.data.document_statuses}
        printReadiness={documentsQuery.data.print_readiness}
        orgId={orgId}
        patientId={patient.id}
      />
    </div>
  );
}

type BillingCollectionFormInput = {
  candidateId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  status: string;
  billedAmount: number | null;
  collectedAmount: number | null;
  payerName: string | null;
  paymentMethod: string | null;
  scheduledCollectionAt: string | null;
  receiptNumber: string | null;
  receiptIssueStatus: 'not_required' | 'not_issued' | 'issued';
  invoiceIssueStatus: 'not_required' | 'not_issued' | 'issued';
  saveReceiptCopy: boolean;
  saveInvoiceCopy: boolean;
};

function createBillingCollectionIdempotencyKey() {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `billing-collection:${random}`.slice(0, 128);
}

type BillingPaymentProfileFormInput = {
  patientId: string;
  payerType: string;
  payerName: string | null;
  payerRelation: string | null;
  billingAddressMode: string;
  billingAddress: string | null;
  paymentMethod: string;
  collectionTiming: string;
  receiptIssue: string;
  invoiceIssue: string;
  unpaidTolerance: string;
  note: string | null;
};

type PrescriptionDocumentFormInput = {
  intakeId: string;
  documentUrl: string;
};

type PrescriptionOriginalManagementFormInput = {
  intakeId: string;
  originalCollectedAt: string;
  reconciliationResult: 'not_checked' | 'matched' | 'discrepancy';
  discrepancyNote: string | null;
  storageLocation: 'not_stored' | 'store' | 'headquarters' | 'electronic' | 'patient_copy_only';
  ePrescriptionExchangeNumber: string | null;
  ePrescriptionAcquiredStatus: 'not_applicable' | 'pending' | 'acquired';
  dispensingResultRegistration: 'not_applicable' | 'pending' | 'registered';
  note: string | null;
};

type ConferenceNoteFormInput = {
  patientId: string;
  caseId: string | null;
  noteType: 'pre_discharge' | 'service_manager' | 'care_team' | 'emergency' | 'death_conference';
  title: string;
  conferenceDate: string;
  conferenceFormat: 'in_person' | 'phone' | 'web' | 'mcs' | 'written';
  location: string;
  organizer:
    | 'hospital'
    | 'care_manager'
    | 'visiting_nurse'
    | 'physician'
    | 'pharmacy'
    | 'family'
    | 'facility'
    | 'other';
  reportType:
    | 'physician_report'
    | 'care_manager_report'
    | 'facility_handoff'
    | 'nurse_share'
    | 'family_share'
    | 'internal_record';
  followUpDate: string;
  followUpCompleted: boolean;
  agenda: string;
  content: string;
  participantsRaw: string;
  pharmacyParticipantsRaw: string;
  visitScheduleChange: string;
  targetDischargeDate: string;
  actionItemsRaw: string;
};

type McsCheckLogFormInput = {
  patientId: string;
  contentType: string;
  summary: string;
  nextAction: string | null;
};

type ConferenceStructuredSectionInput = {
  key: string;
  label: string;
  body: string;
};

const conferenceNoteTypeLabels: Record<ConferenceNoteFormInput['noteType'], string> = {
  pre_discharge: '退院前',
  service_manager: '担当者会議',
  care_team: '担当者ミーティング',
  emergency: '緊急',
  death_conference: 'デスカンファ',
};

const conferenceFormatLabels: Record<ConferenceNoteFormInput['conferenceFormat'], string> = {
  in_person: '対面',
  phone: '電話',
  web: 'Web',
  mcs: 'MCS',
  written: '書面',
};

const conferenceOrganizerLabels: Record<ConferenceNoteFormInput['organizer'], string> = {
  hospital: '病院',
  care_manager: 'CM',
  visiting_nurse: '訪看',
  physician: '医師',
  pharmacy: '薬局',
  family: '家族',
  facility: '施設',
  other: 'その他',
};

const conferenceReportTypeLabels: Record<ConferenceNoteFormInput['reportType'], string> = {
  physician_report: '医師向け報告書',
  care_manager_report: 'ケアマネ向け報告書',
  facility_handoff: '施設申し送り',
  nurse_share: '訪看共有',
  family_share: '家族共有',
  internal_record: '薬局内記録',
};

function defaultConferenceReportType(
  noteType: ConferenceNoteFormInput['noteType'],
): ConferenceNoteFormInput['reportType'] {
  if (noteType === 'pre_discharge' || noteType === 'emergency') return 'physician_report';
  if (noteType === 'service_manager') return 'care_manager_report';
  return 'internal_record';
}

const prescriptionReconciliationLabels: Record<
  PrescriptionOriginalManagementFormInput['reconciliationResult'],
  string
> = {
  matched: '一致',
  discrepancy: '差異あり',
  not_checked: '未照合',
};

const prescriptionStorageLabels: Record<
  PrescriptionOriginalManagementFormInput['storageLocation'],
  string
> = {
  store: '店舗保管',
  headquarters: '本部保管',
  electronic: '電子保管',
  patient_copy_only: '患者控えのみ',
  not_stored: '未保管',
};

const ePrescriptionAcquiredLabels: Record<
  PrescriptionOriginalManagementFormInput['ePrescriptionAcquiredStatus'],
  string
> = {
  not_applicable: '対象外',
  pending: '取得待ち',
  acquired: '取得済み',
};

const dispensingResultRegistrationLabels: Record<
  PrescriptionOriginalManagementFormInput['dispensingResultRegistration'],
  string
> = {
  not_applicable: '対象外',
  pending: '登録待ち',
  registered: '登録済み',
};

function queryParamValue(href: string, key: string) {
  const query = href.split('?')[1];
  if (!query) return null;
  return new URLSearchParams(query).get(key);
}

function parseCurrencyMetric(item: PatientHomeOperationItem, label: string) {
  const raw = item.metrics.find((metric) => metric.label === label)?.value;
  if (!raw || raw === '未記録') return '';
  const numeric = Number(raw.replace(/[^\d]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : '';
}

function metricValue(item: PatientHomeOperationItem, label: string) {
  const value = item.metrics.find((metric) => metric.label === label)?.value;
  return value && !['未記録', '未発行/未記録', '未発行', '不要'].includes(value) ? value : '';
}

function toLocalDateTimeInputValue(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function metricDateTimeValue(item: PatientHomeOperationItem, label: string) {
  const value = metricValue(item, label);
  if (!value || value === '未設定') return '';
  const date = new Date(value.replaceAll('/', '-'));
  if (Number.isNaN(date.getTime())) return '';
  return toLocalDateTimeInputValue(date);
}

function McsCheckLogQuickForm({
  actionLabel,
  patientId,
  isPending,
  onSubmit,
}: {
  actionLabel: string;
  patientId: string;
  isPending: boolean;
  onSubmit?: (input: McsCheckLogFormInput) => void;
}) {
  const [contentType, setContentType] = useState('report');
  const [summary, setSummary] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = `mcs-check-error-${patientId}`;

  return (
    <form
      className="mt-3 rounded-lg border border-current/20 bg-background/80 p-2"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedSummary = summary.trim();
        const trimmedNextAction = nextAction.trim();
        if (!trimmedSummary) {
          setError('MCS確認内容を入力してください。');
          return;
        }
        setError(null);
        onSubmit?.({
          patientId,
          contentType,
          summary: trimmedSummary,
          nextAction: trimmedNextAction || null,
        });
      }}
    >
      <div className="grid gap-2">
        <div className="space-y-1">
          <Label htmlFor={`mcs-check-type-${patientId}`} className="text-xs">
            区分
          </Label>
          <select
            id={`mcs-check-type-${patientId}`}
            value={contentType}
            onChange={(event) => setContentType(event.target.value)}
            className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
          >
            <option value="report">報告</option>
            <option value="consultation">相談</option>
            <option value="instruction_check">指示確認</option>
            <option value="photo_review">写真確認</option>
            <option value="urgent">緊急</option>
            <option value="other">その他</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`mcs-check-summary-${patientId}`} className="text-xs">
            MCS確認内容
          </Label>
          <Textarea
            id={`mcs-check-summary-${patientId}`}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className="min-h-16 text-xs"
            aria-invalid={error?.includes('MCS確認内容') ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="確認した投稿、相談内容、指示内容"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`mcs-check-next-action-${patientId}`} className="text-xs">
            次アクション
          </Label>
          <Input
            id={`mcs-check-next-action-${patientId}`}
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
            className="min-h-9 text-xs"
            placeholder="医師へ確認、訪看へ返信"
          />
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {isPending ? (
          <p role="status" aria-label="MCS確認ログを保存中" className="sr-only">
            MCS確認ログを保存中です。
          </p>
        ) : null}
        <LoadingButton
          type="submit"
          size="sm"
          className="h-auto min-h-11 w-full sm:h-auto sm:min-h-11"
          loading={isPending}
          loadingLabel="保存中"
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {actionLabel}
        </LoadingButton>
      </div>
    </form>
  );
}

function parseConferenceActionItems(raw: string) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [titleValue, assignee] = line.split('/').map((part) => part.trim());
      return {
        title: titleValue || line,
        ...(assignee ? { assignee } : {}),
      };
    });
}

export function parseConferenceParticipants(raw: string) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [nameValue, role, organizationName] = line.split('/').map((part) => part.trim());
      return {
        name: nameValue || line,
        role: role ?? '',
        ...(organizationName ? { organization_name: organizationName } : {}),
        attended: true,
      };
    });
}

function parseConferenceNameList(raw: string) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function countConferenceActionItems(raw: string) {
  return parseConferenceActionItems(raw).length;
}

export function buildConferenceStructuredContent(input: ConferenceNoteFormInput) {
  const content = input.content.trim();
  const agenda = input.agenda.trim();
  const location = input.location.trim();
  const visitScheduleChange = input.visitScheduleChange.trim();
  const targetDischargeDate = input.targetDischargeDate.trim();
  const sections: ConferenceStructuredSectionInput[] = [];

  if (input.noteType === 'service_manager') {
    sections.push({ key: 'meeting_purpose', label: '会議目的', body: content });
    if (agenda) {
      sections.push({ key: 'agenda', label: '議題', body: agenda });
    }
    if (location) {
      sections.push({ key: 'location', label: '開催場所', body: location });
    }
    if (visitScheduleChange) {
      sections.push({
        key: 'service_adjustments',
        label: 'サービス調整',
        body: `訪問頻度を${visitScheduleChange}へ変更`,
      });
    }
  } else if (input.noteType === 'pre_discharge') {
    sections.push({ key: 'discharge_background', label: '退院背景', body: content });
    if (agenda) {
      sections.push({ key: 'agenda', label: '議題', body: agenda });
    }
    if (location) {
      sections.push({ key: 'location', label: '開催場所', body: location });
    }
    if (targetDischargeDate) {
      sections.push({
        key: 'target_discharge_date',
        label: '退院予定日',
        body: targetDischargeDate,
      });
      if (visitScheduleChange) {
        sections.push({
          key: 'next_visit_plan',
          label: '初回訪問計画',
          body: `退院後の初回訪問を${visitScheduleChange}で調整`,
        });
      }
    }
  } else if (input.noteType === 'death_conference') {
    sections.push({ key: 'billing_confirmation', label: '算定根拠確認', body: content });
    if (agenda) {
      sections.push({ key: 'agenda', label: '議題', body: agenda });
    }
    if (location) {
      sections.push({ key: 'location', label: '開催場所', body: location });
    }
  } else if (input.noteType === 'emergency') {
    sections.push({ key: 'emergency_context', label: '緊急背景', body: content });
    if (agenda) {
      sections.push({ key: 'agenda', label: '議題', body: agenda });
    }
    if (location) {
      sections.push({ key: 'location', label: '開催場所', body: location });
    }
  } else {
    sections.push({ key: 'discussion_summary', label: '議論要約', body: content });
    if (agenda) {
      sections.push({ key: 'agenda', label: '議題', body: agenda });
    }
    if (location) {
      sections.push({ key: 'location', label: '開催場所', body: location });
    }
  }

  const populatedSections = sections.filter((section) => section.body.trim().length > 0);
  if (populatedSections.length === 0) return undefined;

  return {
    template: input.noteType,
    sections: populatedSections,
  };
}

function metricValueOrDefault(item: PatientHomeOperationItem, label: string, fallback: string) {
  return metricValue(item, label) || fallback;
}

function BillingPaymentProfileQuickForm({
  actionLabel,
  patientId,
  item,
  isPending,
  onSubmit,
}: {
  actionLabel: string;
  patientId: string;
  item: PatientHomeOperationItem;
  isPending: boolean;
  onSubmit?: (input: BillingPaymentProfileFormInput) => void;
}) {
  const [payerType, setPayerType] = useState(() =>
    metricValueOrDefault(item, '支払者区分コード', 'family'),
  );
  const [payerName, setPayerName] = useState(() => metricValue(item, '支払者'));
  const [payerRelation, setPayerRelation] = useState(() => metricValue(item, '続柄'));
  const [billingAddressMode, setBillingAddressMode] = useState(() =>
    metricValueOrDefault(item, '請求先住所区分コード', 'same_as_patient'),
  );
  const [billingAddress, setBillingAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(() =>
    metricValueOrDefault(item, '支払方法コード', 'cash'),
  );
  const [collectionTiming, setCollectionTiming] = useState(() =>
    metricValueOrDefault(item, '集金タイミングコード', 'month_end'),
  );
  const [receiptIssue, setReceiptIssue] = useState(() =>
    metricValueOrDefault(item, '領収証発行コード', 'paper'),
  );
  const [invoiceIssue, setInvoiceIssue] = useState(() =>
    metricValueOrDefault(item, '請求書発行コード', 'yes'),
  );
  const [unpaidTolerance, setUnpaidTolerance] = useState(() =>
    metricValueOrDefault(item, '未収許容コード', 'none'),
  );
  const [note, setNote] = useState(() => metricValue(item, '備考'));
  const [error, setError] = useState<string | null>(null);
  const errorId = `billing-payment-profile-error-${patientId}`;

  return (
    <form
      className="mt-3 rounded-lg border border-current/20 bg-background/80 p-2"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedPayerName = payerName.trim();
        const trimmedPayerRelation = payerRelation.trim();
        const trimmedBillingAddress = billingAddress.trim();
        const trimmedNote = note.trim();
        if (payerType !== 'self' && !trimmedPayerName) {
          setError('本人以外の支払者では支払者氏名を入力してください。');
          return;
        }
        if (['family', 'guardian', 'other'].includes(payerType) && !trimmedPayerRelation) {
          setError('家族・後見人・その他の支払者では続柄を入力してください。');
          return;
        }
        if (billingAddressMode !== 'same_as_patient' && !trimmedBillingAddress) {
          setError('患者住所と異なる請求先では請求先住所を入力してください。');
          return;
        }
        if (unpaidTolerance === 'custom' && !trimmedNote) {
          setError('個別対応の未収許容条件は備考に入力してください。');
          return;
        }
        setError(null);
        onSubmit?.({
          patientId,
          payerType,
          payerName: trimmedPayerName || null,
          payerRelation: trimmedPayerRelation || null,
          billingAddressMode,
          billingAddress: trimmedBillingAddress || null,
          paymentMethod,
          collectionTiming,
          receiptIssue,
          invoiceIssue,
          unpaidTolerance,
          note: trimmedNote || null,
        });
      }}
    >
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-payer-type-${patientId}`} className="text-xs">
              支払者
            </Label>
            <select
              id={`billing-payer-type-${patientId}`}
              value={payerType}
              onChange={(event) => setPayerType(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="self">本人</option>
              <option value="family">家族</option>
              <option value="guardian">後見人</option>
              <option value="facility">施設</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-payment-method-${patientId}`} className="text-xs">
              支払方法
            </Label>
            <select
              id={`billing-payment-method-${patientId}`}
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="cash">現金</option>
              <option value="bank_transfer">振込</option>
              <option value="bank_debit">口座振替</option>
              <option value="credit_card">クレカ</option>
              <option value="facility_billing">施設請求</option>
              <option value="corporate_billing">法人請求</option>
              <option value="other">その他</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-profile-payer-name-${patientId}`} className="text-xs">
              支払者氏名
            </Label>
            <Input
              id={`billing-profile-payer-name-${patientId}`}
              value={payerName}
              onChange={(event) => setPayerName(event.target.value)}
              className="min-h-9 text-xs"
              aria-invalid={error?.includes('支払者氏名') ? true : undefined}
              aria-describedby={error?.includes('支払者氏名') ? errorId : undefined}
              placeholder="長女 山田花子"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-payer-relation-${patientId}`} className="text-xs">
              続柄
            </Label>
            <Input
              id={`billing-payer-relation-${patientId}`}
              value={payerRelation}
              onChange={(event) => setPayerRelation(event.target.value)}
              className="min-h-9 text-xs"
              aria-invalid={error?.includes('続柄') ? true : undefined}
              aria-describedby={error?.includes('続柄') ? errorId : undefined}
              placeholder="長女"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`billing-address-mode-${patientId}`} className="text-xs">
            請求先住所区分
          </Label>
          <select
            id={`billing-address-mode-${patientId}`}
            value={billingAddressMode}
            onChange={(event) => setBillingAddressMode(event.target.value)}
            className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
          >
            <option value="same_as_patient">患者住所と同じ</option>
            <option value="different">別住所</option>
            <option value="facility">施設宛</option>
          </select>
        </div>
        {billingAddressMode !== 'same_as_patient' ? (
          <div className="space-y-1">
            <Label htmlFor={`billing-address-${patientId}`} className="text-xs">
              請求先住所
            </Label>
            <Textarea
              id={`billing-address-${patientId}`}
              value={billingAddress}
              onChange={(event) => setBillingAddress(event.target.value)}
              className="min-h-16 text-xs"
              aria-invalid={error?.includes('請求先住所') ? true : undefined}
              aria-describedby={error?.includes('請求先住所') ? errorId : undefined}
              placeholder="請求書・領収証の送付先"
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-collection-timing-${patientId}`} className="text-xs">
              集金タイミング
            </Label>
            <select
              id={`billing-collection-timing-${patientId}`}
              value={collectionTiming}
              onChange={(event) => setCollectionTiming(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="per_visit">毎回</option>
              <option value="month_end">月末</option>
              <option value="next_month">翌月</option>
              <option value="facility_batch">施設一括</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-unpaid-tolerance-${patientId}`} className="text-xs">
              未収許容
            </Label>
            <select
              id={`billing-unpaid-tolerance-${patientId}`}
              value={unpaidTolerance}
              onChange={(event) => setUnpaidTolerance(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="none">なし</option>
              <option value="one_month">1か月</option>
              <option value="custom">個別対応</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-receipt-issue-${patientId}`} className="text-xs">
              領収証発行
            </Label>
            <select
              id={`billing-receipt-issue-${patientId}`}
              value={receiptIssue}
              onChange={(event) => setReceiptIssue(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="paper">紙</option>
              <option value="pdf">PDF</option>
              <option value="none">不要</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-invoice-issue-${patientId}`} className="text-xs">
              請求書発行
            </Label>
            <select
              id={`billing-invoice-issue-${patientId}`}
              value={invoiceIssue}
              onChange={(event) => setInvoiceIssue(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="yes">あり</option>
              <option value="no">なし</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`billing-profile-note-${patientId}`} className="text-xs">
            備考
          </Label>
          <Textarea
            id={`billing-profile-note-${patientId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-16 text-xs"
            aria-invalid={error?.includes('備考') ? true : undefined}
            aria-describedby={error?.includes('備考') ? errorId : undefined}
            placeholder="月末に長女へ請求"
          />
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {isPending ? (
          <p role="status" aria-label="支払設定を保存中" className="sr-only">
            支払設定を保存中です。
          </p>
        ) : null}
        <LoadingButton
          type="submit"
          size="sm"
          className="h-auto min-h-11 w-full sm:h-auto sm:min-h-11"
          loading={isPending}
          loadingLabel="保存中"
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {actionLabel}
        </LoadingButton>
      </div>
    </form>
  );
}

function BillingCollectionQuickForm({
  actionLabel,
  candidateId,
  item,
  isPending,
  onSubmit,
}: {
  actionLabel: string;
  candidateId: string;
  item: PatientHomeOperationItem;
  isPending: boolean;
  onSubmit?: (input: BillingCollectionFormInput) => void;
}) {
  const [status, setStatus] = useState('collected');
  const [billedAmount, setBilledAmount] = useState(() => parseCurrencyMetric(item, '今月請求額'));
  const [collectedAmount, setCollectedAmount] = useState(() =>
    parseCurrencyMetric(item, '今月請求額'),
  );
  const [payerName, setPayerName] = useState(() => metricValue(item, '支払者'));
  const [receiptNumber, setReceiptNumber] = useState(() => metricValue(item, '領収証'));
  const [receiptIssueStatus, setReceiptIssueStatus] = useState<
    BillingCollectionFormInput['receiptIssueStatus']
  >(() => {
    const savedStatus = metricValue(item, '領収証状態コード');
    if (
      savedStatus === 'issued' ||
      savedStatus === 'not_issued' ||
      savedStatus === 'not_required'
    ) {
      return savedStatus;
    }
    return metricValueOrDefault(item, '領収証発行コード', 'paper') === 'none'
      ? 'not_required'
      : 'issued';
  });
  const [invoiceIssueStatus, setInvoiceIssueStatus] = useState<
    BillingCollectionFormInput['invoiceIssueStatus']
  >(() => {
    const savedStatus = metricValue(item, '請求書状態コード');
    if (
      savedStatus === 'issued' ||
      savedStatus === 'not_issued' ||
      savedStatus === 'not_required'
    ) {
      return savedStatus;
    }
    return metricValueOrDefault(item, '請求書発行コード', 'yes') === 'no'
      ? 'not_required'
      : 'not_issued';
  });
  const [saveReceiptCopy, setSaveReceiptCopy] = useState(
    () => metricValue(item, '領収証控えコード') === 'yes',
  );
  const [saveInvoiceCopy, setSaveInvoiceCopy] = useState(
    () =>
      metricValue(item, '請求書控えコード') === 'yes' ||
      Boolean(metricValue(item, '請求書控えURL')),
  );
  const [scheduledCollectionAt, setScheduledCollectionAt] = useState(() =>
    metricDateTimeValue(item, '次回集金予定'),
  );
  const [error, setError] = useState<string | null>(null);
  const receiptIssueCode = metricValueOrDefault(item, '領収証発行コード', 'paper');
  const invoiceIssueCode = metricValueOrDefault(item, '請求書発行コード', 'yes');
  const receiptCopyUrl = metricValue(item, '領収証控えURL');
  const invoiceCopyUrl = metricValue(item, '請求書控えURL');
  const errorId = `billing-collection-error-${candidateId}`;
  const receiptRequired = receiptIssueCode !== 'none';
  const receiptRequiredForStatus = receiptRequired && ['collected', 'partial'].includes(status);
  const invoiceRequiredForStatus =
    invoiceIssueCode === 'yes' &&
    ['billed', 'collected', 'partial', 'unpaid', 'dunning'].includes(status);
  const collectionStatusLabel =
    {
      billed: '請求済',
      scheduled: '集金予定',
      collected: '集金済',
      partial: '一部入金',
      unpaid: '未収',
      dunning: '督促中',
      waived: '免除・公費',
    }[status] ?? status;

  return (
    <form
      className="mt-3 rounded-lg border border-current/20 bg-background/80 p-2"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const billed = billedAmount ? Number(billedAmount) : null;
        const collected = collectedAmount ? Number(collectedAmount) : null;
        if (
          ['billed', 'scheduled', 'collected', 'partial', 'unpaid', 'dunning'].includes(status) &&
          billed == null
        ) {
          setError('請求額を入力してください。');
          return;
        }
        if (status === 'scheduled' && !scheduledCollectionAt) {
          setError('集金予定では次回集金予定を入力してください。');
          return;
        }
        if (
          status === 'collected' &&
          (billed == null || collected == null || collected !== billed)
        ) {
          setError('集金済では入金額を請求額と一致させてください。');
          return;
        }
        if (
          status === 'partial' &&
          (billed == null || collected == null || collected <= 0 || collected >= billed)
        ) {
          setError('一部入金では請求額未満の入金額を入力してください。');
          return;
        }
        if (
          ['billed', 'scheduled', 'unpaid', 'dunning'].includes(status) &&
          collected != null &&
          collected > 0
        ) {
          setError('入金額がある場合は一部入金または集金済を選択してください。');
          return;
        }
        if (receiptRequiredForStatus && !receiptNumber.trim()) {
          setError('領収証発行が必要な集金では領収証番号を入力してください。');
          return;
        }
        if (receiptRequiredForStatus && receiptIssueStatus !== 'issued') {
          setError('領収証発行が必要な集金では発行状態を発行済みにしてください。');
          return;
        }
        if (invoiceRequiredForStatus && invoiceIssueStatus !== 'issued') {
          setError('請求書発行が必要な請求・集金では発行状態を発行済みにしてください。');
          return;
        }
        if (!item.updated_at) {
          setError('請求候補の最新版を取得してから集金記録を保存してください。');
          return;
        }
        setError(null);
        onSubmit?.({
          candidateId,
          expectedUpdatedAt: item.updated_at,
          idempotencyKey: createBillingCollectionIdempotencyKey(),
          status,
          billedAmount: billed,
          collectedAmount: collected,
          payerName: payerName.trim() || null,
          paymentMethod: 'cash',
          scheduledCollectionAt: scheduledCollectionAt
            ? new Date(scheduledCollectionAt).toISOString()
            : null,
          receiptNumber: receiptNumber.trim() || null,
          receiptIssueStatus,
          invoiceIssueStatus,
          saveReceiptCopy,
          saveInvoiceCopy,
        });
      }}
    >
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-status-${candidateId}`} className="text-xs">
              状態
            </Label>
            <select
              id={`billing-status-${candidateId}`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="billed">請求済</option>
              <option value="scheduled">集金予定</option>
              <option value="collected">集金済</option>
              <option value="partial">一部入金</option>
              <option value="unpaid">未収</option>
              <option value="dunning">督促中</option>
              <option value="waived">免除・公費</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-receipt-${candidateId}`} className="text-xs">
              領収証番号
            </Label>
            <Input
              id={`billing-receipt-${candidateId}`}
              value={receiptNumber}
              onChange={(event) => setReceiptNumber(event.target.value)}
              className="min-h-9 text-xs"
              placeholder="R202606..."
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-billed-${candidateId}`} className="text-xs">
              請求額
            </Label>
            <Input
              id={`billing-billed-${candidateId}`}
              inputMode="numeric"
              value={billedAmount}
              onChange={(event) => setBilledAmount(event.target.value.replace(/[^\d]/g, ''))}
              className="min-h-9 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-collected-${candidateId}`} className="text-xs">
              入金額
            </Label>
            <Input
              id={`billing-collected-${candidateId}`}
              inputMode="numeric"
              value={collectedAmount}
              onChange={(event) => setCollectedAmount(event.target.value.replace(/[^\d]/g, ''))}
              className="min-h-9 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-payer-${candidateId}`} className="text-xs">
              支払者
            </Label>
            <Input
              id={`billing-payer-${candidateId}`}
              value={payerName}
              onChange={(event) => setPayerName(event.target.value)}
              className="min-h-9 text-xs"
              placeholder="本人/家族"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`billing-scheduled-${candidateId}`} className="text-xs">
            次回集金予定
          </Label>
          <Input
            id={`billing-scheduled-${candidateId}`}
            type="datetime-local"
            value={scheduledCollectionAt}
            onChange={(event) => setScheduledCollectionAt(event.target.value)}
            className="min-h-9 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`billing-receipt-status-${candidateId}`} className="text-xs">
              領収証状態
            </Label>
            <select
              id={`billing-receipt-status-${candidateId}`}
              value={receiptIssueStatus}
              onChange={(event) =>
                setReceiptIssueStatus(
                  event.target.value as BillingCollectionFormInput['receiptIssueStatus'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="issued">発行済み</option>
              <option value="not_issued">未発行</option>
              <option value="not_required">発行不要</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-invoice-status-${candidateId}`} className="text-xs">
              請求書状態
            </Label>
            <select
              id={`billing-invoice-status-${candidateId}`}
              value={invoiceIssueStatus}
              onChange={(event) =>
                setInvoiceIssueStatus(
                  event.target.value as BillingCollectionFormInput['invoiceIssueStatus'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="not_issued">未発行</option>
              <option value="issued">発行済み</option>
              <option value="not_required">発行不要</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="inline-flex min-h-9 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveReceiptCopy}
              onChange={(event) => setSaveReceiptCopy(event.target.checked)}
              className="size-4"
            />
            領収証控えを保存する
          </label>
          <label className="inline-flex min-h-9 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveInvoiceCopy}
              onChange={(event) => setSaveInvoiceCopy(event.target.checked)}
              className="size-4"
            />
            請求書控えを保存する
          </label>
        </div>
        <div className="rounded-lg border border-current/15 bg-muted/20 p-2 text-xs">
          <p className="font-medium text-foreground">保存される集金履歴</p>
          <dl className="mt-2 grid gap-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">状態</dt>
              <dd className="font-medium text-foreground">{collectionStatusLabel}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">入金</dt>
              <dd className="font-medium text-foreground">
                {collectedAmount
                  ? `${Number(collectedAmount).toLocaleString('ja-JP')}円`
                  : '未記録'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">領収証</dt>
              <dd className="font-medium text-foreground">
                {receiptRequired ? receiptNumber.trim() || '番号未入力' : '発行不要'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">発行状態</dt>
              <dd className="font-medium text-foreground">
                領収証{' '}
                {receiptIssueStatus === 'issued'
                  ? '発行済み'
                  : receiptIssueStatus === 'not_required'
                    ? '不要'
                    : '未発行'}{' '}
                / 請求書{' '}
                {invoiceIssueStatus === 'issued'
                  ? '発行済み'
                  : invoiceIssueStatus === 'not_required'
                    ? '不要'
                    : '未発行'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">控え保存</dt>
              <dd className="font-medium text-foreground">
                領収証 {saveReceiptCopy ? '保存する' : '保存しない'} / 請求書{' '}
                {saveInvoiceCopy ? '保存する' : '保存しない'}
              </dd>
            </div>
          </dl>
          {receiptCopyUrl || invoiceCopyUrl ? (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-current/15 pt-2">
              {receiptCopyUrl ? (
                <Link
                  href={receiptCopyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-current/20 px-2 text-xs font-medium text-foreground hover:bg-muted/50"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  領収証PDF
                </Link>
              ) : null}
              {invoiceCopyUrl ? (
                <Link
                  href={invoiceCopyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-current/20 px-2 text-xs font-medium text-foreground hover:bg-muted/50"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  請求書PDF
                </Link>
              ) : null}
            </div>
          ) : null}
          {receiptRequiredForStatus ? (
            <p className="mt-2 text-muted-foreground">
              支払設定では領収証発行が必要です。番号を入れてから保存してください。
            </p>
          ) : null}
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {isPending ? (
          <p role="status" aria-label="集金記録を保存中" className="sr-only">
            集金記録を保存中です。
          </p>
        ) : null}
        <LoadingButton
          type="submit"
          size="sm"
          className="h-auto min-h-11 w-full sm:h-auto sm:min-h-11"
          loading={isPending}
          loadingLabel="保存中"
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {actionLabel}
        </LoadingButton>
      </div>
    </form>
  );
}

function PrescriptionDocumentQuickForm({
  actionLabel,
  intakeId,
  isPending,
  onSubmit,
  onUpload,
}: {
  actionLabel: string;
  intakeId: string;
  isPending: boolean;
  onSubmit?: (input: PrescriptionDocumentFormInput) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const [documentUrl, setDocumentUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorId = `prescription-document-error-${intakeId}`;
  const isBusy = isPending || uploading;

  return (
    <form
      className="mt-3 rounded-lg border border-current/20 bg-background/80 p-2"
      aria-busy={isBusy}
      onSubmit={async (event) => {
        event.preventDefault();
        setLocalError(null);
        let nextDocumentUrl = documentUrl.trim();
        if (file) {
          if (!onUpload) {
            setLocalError('ファイルアップロードを利用できません');
            return;
          }
          setUploading(true);
          try {
            nextDocumentUrl = await onUpload(file);
            setDocumentUrl(nextDocumentUrl);
          } catch (error) {
            setLocalError(
              error instanceof Error
                ? error.message
                : '処方せん画像/PDFのアップロードに失敗しました',
            );
            return;
          } finally {
            setUploading(false);
          }
        }
        onSubmit?.({
          intakeId,
          documentUrl: nextDocumentUrl,
        });
      }}
    >
      <div className="grid gap-2">
        <div className="space-y-1">
          <Label htmlFor={`prescription-document-file-${intakeId}`} className="text-xs">
            ファイル
          </Label>
          <Input
            id={`prescription-document-file-${intakeId}`}
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="min-h-9 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`prescription-document-${intakeId}`} className="text-xs">
            画像/PDF URL
          </Label>
          <Input
            id={`prescription-document-${intakeId}`}
            type="url"
            value={documentUrl}
            onChange={(event) => setDocumentUrl(event.target.value)}
            className="min-h-9 text-xs"
            aria-invalid={localError ? true : undefined}
            aria-describedby={localError ? errorId : undefined}
            placeholder="https://..."
          />
        </div>
        {localError ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {localError}
          </p>
        ) : null}
        {isBusy ? (
          <p
            role="status"
            aria-label={uploading ? '処方せん画像/PDFをアップロード中' : '処方せん画像/PDFを保存中'}
            className="sr-only"
          >
            {uploading
              ? '処方せん画像/PDFをアップロード中です。'
              : '処方せん画像/PDFを保存中です。'}
          </p>
        ) : null}
        <LoadingButton
          type="submit"
          size="sm"
          className="h-auto min-h-11 w-full sm:h-auto sm:min-h-11"
          loading={isBusy}
          loadingLabel={uploading ? 'アップロード中' : '保存中'}
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {actionLabel}
        </LoadingButton>
      </div>
    </form>
  );
}

function PrescriptionOriginalManagementQuickForm({
  actionLabel,
  intakeId,
  isPending,
  onSubmit,
}: {
  actionLabel: string;
  intakeId: string;
  isPending: boolean;
  onSubmit?: (input: PrescriptionOriginalManagementFormInput) => void;
}) {
  const [originalCollectedAt, setOriginalCollectedAt] = useState(() =>
    toLocalDateTimeInputValue(new Date()),
  );
  const [reconciliationResult, setReconciliationResult] =
    useState<PrescriptionOriginalManagementFormInput['reconciliationResult']>('matched');
  const [discrepancyNote, setDiscrepancyNote] = useState('');
  const [storageLocation, setStorageLocation] =
    useState<PrescriptionOriginalManagementFormInput['storageLocation']>('store');
  const [ePrescriptionExchangeNumber, setEPrescriptionExchangeNumber] = useState('');
  const [ePrescriptionAcquiredStatus, setEPrescriptionAcquiredStatus] =
    useState<PrescriptionOriginalManagementFormInput['ePrescriptionAcquiredStatus']>(
      'not_applicable',
    );
  const [dispensingResultRegistration, setDispensingResultRegistration] =
    useState<PrescriptionOriginalManagementFormInput['dispensingResultRegistration']>('registered');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ePrescriptionRequiresExchangeNumber = ePrescriptionAcquiredStatus !== 'not_applicable';
  const trimmedExchangeNumber = ePrescriptionExchangeNumber.trim();

  return (
    <form
      className="mt-3 rounded-lg border border-current/20 bg-background/80 p-2"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedDiscrepancyNote = discrepancyNote.trim();
        const trimmedNote = note.trim();
        if (!originalCollectedAt) {
          setError('原本到着日時を入力してください。');
          return;
        }
        if (reconciliationResult === 'discrepancy' && !trimmedDiscrepancyNote) {
          setError('差異ありの場合は差異内容を入力してください。');
          return;
        }
        if (ePrescriptionRequiresExchangeNumber && !trimmedExchangeNumber) {
          setError('電子処方せん対象では引換番号を入力してください。');
          return;
        }
        if (
          ePrescriptionAcquiredStatus === 'pending' &&
          dispensingResultRegistration === 'registered'
        ) {
          setError('電子処方せん取得待ちでは調剤結果登録済みにできません。');
          return;
        }
        if (
          storageLocation === 'not_stored' &&
          (reconciliationResult !== 'not_checked' || dispensingResultRegistration === 'registered')
        ) {
          setError('照合済みまたは調剤結果登録済みでは保管場所を記録してください。');
          return;
        }
        setError(null);
        onSubmit?.({
          intakeId,
          originalCollectedAt: new Date(originalCollectedAt).toISOString(),
          reconciliationResult,
          discrepancyNote: trimmedDiscrepancyNote || null,
          storageLocation,
          ePrescriptionExchangeNumber: trimmedExchangeNumber || null,
          ePrescriptionAcquiredStatus,
          dispensingResultRegistration,
          note: trimmedNote || null,
        });
      }}
    >
      <div className="grid gap-2">
        <div className="space-y-1">
          <Label htmlFor={`prescription-original-collected-${intakeId}`} className="text-xs">
            原本到着日時
          </Label>
          <Input
            id={`prescription-original-collected-${intakeId}`}
            type="datetime-local"
            value={originalCollectedAt}
            onChange={(event) => setOriginalCollectedAt(event.target.value)}
            className="min-h-9 text-xs"
            aria-invalid={error?.includes('原本到着日時') ? true : undefined}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`prescription-reconcile-${intakeId}`} className="text-xs">
              照合結果
            </Label>
            <select
              id={`prescription-reconcile-${intakeId}`}
              value={reconciliationResult}
              onChange={(event) =>
                setReconciliationResult(
                  event.target
                    .value as PrescriptionOriginalManagementFormInput['reconciliationResult'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="matched">一致</option>
              <option value="discrepancy">差異あり</option>
              <option value="not_checked">未照合</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`prescription-storage-${intakeId}`} className="text-xs">
              保管場所
            </Label>
            <select
              id={`prescription-storage-${intakeId}`}
              value={storageLocation}
              onChange={(event) =>
                setStorageLocation(
                  event.target.value as PrescriptionOriginalManagementFormInput['storageLocation'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="store">店舗保管</option>
              <option value="headquarters">本部保管</option>
              <option value="electronic">電子保管</option>
              <option value="patient_copy_only">患者控えのみ</option>
              <option value="not_stored">未保管</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`prescription-discrepancy-${intakeId}`} className="text-xs">
            差異内容
          </Label>
          <Textarea
            id={`prescription-discrepancy-${intakeId}`}
            value={discrepancyNote}
            onChange={(event) => setDiscrepancyNote(event.target.value)}
            className="min-h-16 text-xs"
            aria-invalid={error?.includes('差異内容') ? true : undefined}
            placeholder="差異ありの場合は内容を入力"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`prescription-e-status-${intakeId}`} className="text-xs">
              電子処方せん
            </Label>
            <select
              id={`prescription-e-status-${intakeId}`}
              value={ePrescriptionAcquiredStatus}
              onChange={(event) =>
                setEPrescriptionAcquiredStatus(
                  event.target
                    .value as PrescriptionOriginalManagementFormInput['ePrescriptionAcquiredStatus'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="not_applicable">対象外</option>
              <option value="pending">取得待ち</option>
              <option value="acquired">取得済み</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`prescription-result-${intakeId}`} className="text-xs">
              結果登録
            </Label>
            <select
              id={`prescription-result-${intakeId}`}
              value={dispensingResultRegistration}
              onChange={(event) =>
                setDispensingResultRegistration(
                  event.target
                    .value as PrescriptionOriginalManagementFormInput['dispensingResultRegistration'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="registered">登録済み</option>
              <option value="pending">登録待ち</option>
              <option value="not_applicable">対象外</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`prescription-e-number-${intakeId}`} className="text-xs">
            引換番号
          </Label>
          <Input
            id={`prescription-e-number-${intakeId}`}
            value={ePrescriptionExchangeNumber}
            onChange={(event) => setEPrescriptionExchangeNumber(event.target.value)}
            className="min-h-9 text-xs"
            aria-invalid={error?.includes('引換番号') ? true : undefined}
            placeholder="電子処方せん対象時"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`prescription-management-note-${intakeId}`} className="text-xs">
            備考
          </Label>
          <Textarea
            id={`prescription-management-note-${intakeId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-14 text-xs"
          />
        </div>
        <div className="rounded-lg border border-current/15 bg-muted/20 p-2 text-xs">
          <p className="font-medium text-foreground">保存される原本管理</p>
          <dl className="mt-2 grid gap-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">到着</dt>
              <dd className="font-medium text-foreground">
                {originalCollectedAt
                  ? format(new Date(originalCollectedAt), 'yyyy/MM/dd HH:mm')
                  : '未入力'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">照合</dt>
              <dd className="font-medium text-foreground">
                {prescriptionReconciliationLabels[reconciliationResult]}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">保管</dt>
              <dd className="font-medium text-foreground">
                {prescriptionStorageLabels[storageLocation]}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">電子処方せん</dt>
              <dd className="font-medium text-foreground">
                {ePrescriptionAcquiredLabels[ePrescriptionAcquiredStatus]}
                {ePrescriptionRequiresExchangeNumber
                  ? ` / ${trimmedExchangeNumber || '引換番号未入力'}`
                  : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">調剤結果</dt>
              <dd className="font-medium text-foreground">
                {dispensingResultRegistrationLabels[dispensingResultRegistration]}
              </dd>
            </div>
          </dl>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {isPending ? (
          <p role="status" aria-label="処方せん原本管理を保存中" className="sr-only">
            処方せん原本管理を保存中です。
          </p>
        ) : null}
        <LoadingButton
          type="submit"
          size="sm"
          className="h-auto min-h-11 w-full sm:h-auto sm:min-h-11"
          loading={isPending}
          loadingLabel="保存中"
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {actionLabel}
        </LoadingButton>
      </div>
    </form>
  );
}

function ConferenceNoteQuickForm({
  actionLabel,
  patientName,
  patientId,
  caseId,
  isPending,
  onSubmit,
}: {
  actionLabel: string;
  patientName: string;
  patientId: string;
  caseId: string | null;
  isPending: boolean;
  onSubmit?: (input: ConferenceNoteFormInput) => void;
}) {
  const [noteType, setNoteType] = useState<ConferenceNoteFormInput['noteType']>('service_manager');
  const [conferenceDate, setConferenceDate] = useState(() => toLocalDateTimeInputValue(new Date()));
  const [conferenceFormat, setConferenceFormat] =
    useState<ConferenceNoteFormInput['conferenceFormat']>('in_person');
  const [location, setLocation] = useState('');
  const [organizer, setOrganizer] = useState<ConferenceNoteFormInput['organizer']>('care_manager');
  const [reportType, setReportType] = useState<ConferenceNoteFormInput['reportType']>(() =>
    defaultConferenceReportType('service_manager'),
  );
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpCompleted, setFollowUpCompleted] = useState(false);
  const [title, setTitle] = useState(() => `${patientName}様 サービス担当者会議`);
  const [agenda, setAgenda] = useState('');
  const [content, setContent] = useState('');
  const [participantsRaw, setParticipantsRaw] = useState('');
  const [pharmacyParticipantsRaw, setPharmacyParticipantsRaw] = useState('');
  const [visitScheduleChange, setVisitScheduleChange] = useState('');
  const [targetDischargeDate, setTargetDischargeDate] = useState('');
  const [actionItemsRaw, setActionItemsRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const actionItemCount = countConferenceActionItems(actionItemsRaw);
  const participantCount = parseConferenceParticipants(participantsRaw).length;
  const pharmacyParticipantCount = parseConferenceNameList(pharmacyParticipantsRaw).length;
  const requiresDischargeDate = noteType === 'pre_discharge';

  return (
    <form
      className="mt-3 rounded-lg border border-current/20 bg-background/80 p-2"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedTitle = title.trim();
        const trimmedLocation = location.trim();
        const trimmedAgenda = agenda.trim();
        const trimmedContent = content.trim();
        const trimmedParticipantsRaw = participantsRaw.trim();
        const trimmedPharmacyParticipantsRaw = pharmacyParticipantsRaw.trim();
        const trimmedVisitScheduleChange = visitScheduleChange.trim();
        const trimmedTargetDischargeDate = targetDischargeDate.trim();
        const trimmedFollowUpDate = followUpDate.trim();
        const trimmedActionItemsRaw = actionItemsRaw.trim();
        if (!trimmedTitle || !conferenceDate || !trimmedContent) {
          setError('会議名・開催日時・会議要点を入力してください。');
          return;
        }
        if (requiresDischargeDate && !trimmedTargetDischargeDate) {
          setError('退院前カンファレンスでは退院予定日を入力してください。');
          return;
        }
        if (countConferenceActionItems(trimmedActionItemsRaw) === 0) {
          setError('会議後の薬局タスクを1件以上入力してください。');
          return;
        }
        setError(null);
        onSubmit?.({
          patientId,
          caseId,
          noteType,
          title: trimmedTitle,
          conferenceDate,
          conferenceFormat,
          location: trimmedLocation,
          organizer,
          reportType,
          followUpDate: trimmedFollowUpDate,
          followUpCompleted,
          agenda: trimmedAgenda,
          content: trimmedContent,
          participantsRaw: trimmedParticipantsRaw,
          pharmacyParticipantsRaw: trimmedPharmacyParticipantsRaw,
          visitScheduleChange: trimmedVisitScheduleChange,
          targetDischargeDate: trimmedTargetDischargeDate,
          actionItemsRaw: trimmedActionItemsRaw,
        });
      }}
    >
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`conference-type-${patientId}`} className="text-xs">
              会議種別
            </Label>
            <select
              id={`conference-type-${patientId}`}
              value={noteType}
              onChange={(event) => {
                const nextType = event.target.value as ConferenceNoteFormInput['noteType'];
                setNoteType(nextType);
                setReportType(defaultConferenceReportType(nextType));
              }}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="pre_discharge">退院前</option>
              <option value="service_manager">担当者会議</option>
              <option value="care_team">担当者ミーティング</option>
              <option value="emergency">緊急</option>
              <option value="death_conference">デスカンファ</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`conference-date-${patientId}`} className="text-xs">
              開催日時
            </Label>
            <Input
              id={`conference-date-${patientId}`}
              type="datetime-local"
              value={conferenceDate}
              onChange={(event) => setConferenceDate(event.target.value)}
              className="min-h-9 text-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`conference-format-${patientId}`} className="text-xs">
              開催形式
            </Label>
            <select
              id={`conference-format-${patientId}`}
              value={conferenceFormat}
              onChange={(event) =>
                setConferenceFormat(
                  event.target.value as ConferenceNoteFormInput['conferenceFormat'],
                )
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="in_person">対面</option>
              <option value="phone">電話</option>
              <option value="web">Web</option>
              <option value="mcs">MCS</option>
              <option value="written">書面</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`conference-organizer-${patientId}`} className="text-xs">
              主催者
            </Label>
            <select
              id={`conference-organizer-${patientId}`}
              value={organizer}
              onChange={(event) =>
                setOrganizer(event.target.value as ConferenceNoteFormInput['organizer'])
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="hospital">病院</option>
              <option value="care_manager">CM</option>
              <option value="visiting_nurse">訪看</option>
              <option value="physician">医師</option>
              <option value="pharmacy">薬局</option>
              <option value="family">家族</option>
              <option value="facility">施設</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`conference-report-type-${patientId}`} className="text-xs">
              報告書用途
            </Label>
            <select
              id={`conference-report-type-${patientId}`}
              value={reportType}
              onChange={(event) =>
                setReportType(event.target.value as ConferenceNoteFormInput['reportType'])
              }
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="physician_report">医師向け</option>
              <option value="care_manager_report">ケアマネ向け</option>
              <option value="facility_handoff">施設申し送り</option>
              <option value="nurse_share">訪看共有</option>
              <option value="family_share">家族共有</option>
              <option value="internal_record">薬局内記録</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`conference-title-${patientId}`} className="text-xs">
            会議名
          </Label>
          <Input
            id={`conference-title-${patientId}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-h-9 text-xs"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`conference-location-${patientId}`} className="text-xs">
              開催場所
            </Label>
            <Input
              id={`conference-location-${patientId}`}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              className="min-h-9 text-xs"
              placeholder="病院会議室、MCS、施設名"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`conference-agenda-${patientId}`} className="text-xs">
              議題
            </Label>
            <Input
              id={`conference-agenda-${patientId}`}
              value={agenda}
              onChange={(event) => setAgenda(event.target.value)}
              className="min-h-9 text-xs"
              placeholder="退院後支援、訪問頻度、残薬対応"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`conference-content-${patientId}`} className="text-xs">
            会議要点
          </Label>
          <Textarea
            id={`conference-content-${patientId}`}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-20 text-xs"
            aria-invalid={error?.includes('会議要点') ? true : undefined}
            placeholder="決定事項、薬局確認事項、報告書に残す要点"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`conference-participants-${patientId}`} className="text-xs">
              参加者
            </Label>
            <Textarea
              id={`conference-participants-${patientId}`}
              value={participantsRaw}
              onChange={(event) => setParticipantsRaw(event.target.value)}
              className="min-h-16 text-xs"
              placeholder="1行1名。例: 佐藤CM / ケアマネ / あおぞら居宅"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`conference-pharmacy-participants-${patientId}`} className="text-xs">
              薬局参加者
            </Label>
            <Textarea
              id={`conference-pharmacy-participants-${patientId}`}
              value={pharmacyParticipantsRaw}
              onChange={(event) => setPharmacyParticipantsRaw(event.target.value)}
              className="min-h-16 text-xs"
              placeholder="1行1名。例: 鈴木薬剤師"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`conference-visit-schedule-change-${patientId}`} className="text-xs">
              訪問頻度変更
            </Label>
            <select
              id={`conference-visit-schedule-change-${patientId}`}
              value={visitScheduleChange}
              onChange={(event) => setVisitScheduleChange(event.target.value)}
              className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="">変更なし</option>
              <option value="月1回">月1回</option>
              <option value="月2回">月2回</option>
              <option value="週1回">週1回</option>
              <option value="週2回">週2回</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`conference-target-discharge-${patientId}`} className="text-xs">
              退院予定日
            </Label>
            <Input
              id={`conference-target-discharge-${patientId}`}
              type="date"
              value={targetDischargeDate}
              onChange={(event) => setTargetDischargeDate(event.target.value)}
              className="min-h-9 text-xs"
              disabled={noteType !== 'pre_discharge'}
              aria-invalid={error?.includes('退院予定日') ? true : undefined}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`conference-follow-up-date-${patientId}`} className="text-xs">
              フォロー期限
            </Label>
            <Input
              id={`conference-follow-up-date-${patientId}`}
              type="datetime-local"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
              className="min-h-9 text-xs"
            />
          </div>
          <label
            htmlFor={`conference-follow-up-completed-${patientId}`}
            className="flex min-h-9 items-center gap-2 self-end rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
          >
            <input
              id={`conference-follow-up-completed-${patientId}`}
              type="checkbox"
              checked={followUpCompleted}
              onChange={(event) => setFollowUpCompleted(event.target.checked)}
              className="size-4 rounded border-input"
            />
            フォロー完了
          </label>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`conference-actions-${patientId}`} className="text-xs">
            薬局タスク
          </Label>
          <Textarea
            id={`conference-actions-${patientId}`}
            value={actionItemsRaw}
            onChange={(event) => setActionItemsRaw(event.target.value)}
            className="min-h-16 text-xs"
            aria-invalid={error?.includes('薬局タスク') ? true : undefined}
            placeholder="1行1件。例: 報告書作成 / 薬剤師"
          />
        </div>
        <div className="rounded-md border border-border/70 bg-muted/30 p-2 text-xs">
          <p className="font-medium text-foreground">保存される会議連動</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <dt>会議種別</dt>
            <dd className="text-foreground">{conferenceNoteTypeLabels[noteType]}</dd>
            <dt>形式/主催</dt>
            <dd className="text-foreground">
              {conferenceFormatLabels[conferenceFormat]} / {conferenceOrganizerLabels[organizer]}
            </dd>
            <dt>報告書用途</dt>
            <dd className="text-foreground">{conferenceReportTypeLabels[reportType]}</dd>
            <dt>場所/議題</dt>
            <dd className="text-foreground">
              {location || '未入力'} / {agenda || '未入力'}
            </dd>
            <dt>参加者</dt>
            <dd className="text-foreground">
              {participantCount > 0 ? `外部 ${participantCount}名` : '外部未入力'} /{' '}
              {pharmacyParticipantCount > 0 ? `薬局 ${pharmacyParticipantCount}名` : '薬局未入力'}
            </dd>
            <dt>報告書・薬局タスク</dt>
            <dd className="text-foreground">
              {actionItemCount > 0 ? `タスク ${actionItemCount}件` : '未入力'}
            </dd>
            <dt>フォロー</dt>
            <dd className="text-foreground">
              {followUpDate
                ? `${followUpDate.replace('T', ' ')} / ${followUpCompleted ? '完了' : '未完了'}`
                : followUpCompleted
                  ? '完了'
                  : '期限未設定'}
            </dd>
            <dt>訪問頻度</dt>
            <dd className="text-foreground">{visitScheduleChange || '変更なし'}</dd>
            <dt>退院予定</dt>
            <dd className="text-foreground">
              {noteType === 'pre_discharge' ? targetDischargeDate || '未入力' : '対象外'}
            </dd>
          </dl>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {isPending ? (
          <p role="status" aria-label="会議要点を保存中" className="sr-only">
            会議要点を保存中です。
          </p>
        ) : null}
        <LoadingButton
          type="submit"
          size="sm"
          className="h-auto min-h-11 w-full sm:h-auto sm:min-h-11"
          loading={isPending}
          loadingLabel="保存中"
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {actionLabel}
        </LoadingButton>
      </div>
    </form>
  );
}

function VisitPrepRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border/60 py-2.5 text-sm last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{value || '未設定'}</dd>
    </div>
  );
}

function PatientProfilePanel({ patient }: { patient: PatientOverview }) {
  const age = differenceInYears(new Date(), new Date(patient.birth_date));
  const genderLabel = formatGenderLabel(patient.gender);
  const residenceLabel = formatResidenceLabel(patient);
  const preference = patient.scheduling_preference;
  const intake = getPrimaryHomeVisitIntake(patient);
  const addOn2 = intake?.home_pharmacy_add_on_2;
  const visitSchedule = buildVisitScheduleLabel(patient);
  const swallowing =
    preference?.swallowing_route ?? patient.workspace?.safety.swallowing ?? '未確認';
  const homeStatus = labelOf(intake?.home_care_status, homeCareStatusLabels);
  const emergencyResponse = labelOf(intake?.emergency_response, emergencyResponseLabels);
  const careLevel = preference?.care_level ?? intake?.care_level ?? '未設定';
  const notes = patient.notes?.trim();
  const latestCondition =
    patient.conditions.find((condition) => condition.is_primary && condition.is_active) ??
    patient.conditions.find((condition) => condition.is_active) ??
    null;

  return (
    <SectionCard
      id="patient-profile-summary"
      aria-label="患者プロフィール"
      data-testid="patient-profile-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">患者プロフィール</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            訪問・服薬支援で毎回確認する基本条件を、このカード内で確認します。
          </p>
        </div>
        <Link
          href={buildPatientHref(patient.id, '/edit')}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-11' })}
        >
          基本情報を編集
        </Link>
      </div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
        <SummaryTile label="状態" value={homeStatus === '—' ? '未設定' : homeStatus} />
        <SummaryTile
          label="次回 / 最終"
          value={`${visitSchedule.next} / ${visitSchedule.latest}`}
        />
        <SummaryTile
          label="緊急"
          value={emergencyResponse === '—' ? '未確認' : emergencyResponse}
          tone={
            intake?.emergency_response === 'unavailable'
              ? 'risk'
              : intake?.emergency_response
                ? undefined
                : 'warn'
          }
        />
        <SummaryTile label="主連絡" value={formatPreferredContact(patient)} />
        <SummaryTile label="現地" value={`${residenceLabel} / ${formatParkingLabel(patient)}`} />
        <SummaryTile
          label="薬学リスク"
          value={[
            addOn2?.candidate ? labelOf(addOn2.candidate, homePharmacyAddOn2CandidateLabels) : null,
            swallowing,
            careLevel,
          ]
            .filter(Boolean)
            .join(' / ')}
        />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground tabular-nums">
        {age}歳 / {genderLabel} / {latestCondition?.name ?? '主病名未設定'}
      </p>
      {notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{notes}</p> : null}
    </SectionCard>
  );
}

function PatientFoundationPanel({ patient }: { patient: PatientOverview }) {
  const foundation = patient.foundation;
  const changedItems = foundation.changes_since_last_visit;
  const labItems = foundation.latest_labs.slice(0, 4);
  const insuranceItems = foundation.insurances.slice(0, 3);
  const queryClient = useQueryClient();
  const [creatingTaskKey, setCreatingTaskKey] = useState<string | null>(null);
  const actionableItems = foundation.items.filter((item) => item.status !== 'ready');

  async function createFoundationTask(item: (typeof foundation.items)[number]) {
    setCreatingTaskKey(item.key);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_type: 'patient_foundation_review',
          title: `正本確認: ${item.label}`,
          description: item.detail,
          priority: item.status === 'missing' ? 'high' : 'normal',
          dedupe_key: `patient-foundation-review:${patient.id}:${item.key}`,
          related_entity_type: 'patient',
          related_entity_id: patient.id,
          metadata: {
            source: 'patient_foundation',
            patient_id: patient.id,
            item_key: item.key,
            item_label: item.label,
            foundation_status: item.status,
            action_href: item.action_href,
            action_label: item.action_label,
          },
        }),
      });
      const payload = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        throw new Error(payload?.message ?? '正本確認タスクの作成に失敗しました');
      }
      toast.success('正本確認タスクを作成しました');
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      toast.error(messageFromError(error, '正本確認タスクの作成に失敗しました'));
    } finally {
      setCreatingTaskKey(null);
    }
  }

  return (
    <SectionCard
      id="patient-foundation"
      aria-label="正本確認"
      data-testid="patient-foundation-panel"
      className={cn(
        'border-l-4',
        foundation.summary.status === 'ready' && 'border-l-state-done',
        foundation.summary.status === 'needs_confirmation' && 'border-l-state-confirm',
        foundation.summary.status === 'missing' && 'border-l-state-blocked',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">正本確認</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            患者カードで見つけた未確認を、現在値・根拠・履歴に分けて確認します。
          </p>
        </div>
        <span
          className={cn(
            'inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold',
            FOUNDATION_STATUS_CLASSES[foundation.summary.status],
          )}
        >
          {foundation.summary.label}
        </span>
      </div>

      {!foundation.archive.archived && actionableItems.length > 0 ? (
        <div className="mt-4 rounded-md border border-border/70 bg-muted/10 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground">未確認を作業化</p>
              <p className="mt-1 text-xs text-muted-foreground">
                正本の未整備項目を既存の運用タスクに起票します。
              </p>
            </div>
            <Link
              href="/tasks?task_type=patient_foundation_review&status=pending"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold underline-offset-4 hover:bg-muted hover:underline"
            >
              正本確認タスクへ
            </Link>
          </div>
        </div>
      ) : null}

      {foundation.archive.archived ? (
        <div className="mt-4 rounded-md border-l-4 border-border/70 border-l-state-blocked bg-card p-3 text-sm text-state-blocked">
          <p className="font-semibold">アーカイブ中の患者です</p>
          <p className="mt-1 text-xs">
            {foundation.archive.archived_at ?? '日時未記録'}
            {foundation.archive.archived_by_name ? ` / ${foundation.archive.archived_by_name}` : ''}
            。閲覧用の正本として扱い、復元するまで新規作業に使わないでください。
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {foundation.items.map((item) => (
          <div
            key={item.key}
            className={cn(
              'rounded-md border border-l-4 bg-card p-3 text-sm text-foreground',
              FOUNDATION_STATUS_ACCENT[item.status],
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{item.label}</p>
              <span className={cn('text-xs font-medium', FOUNDATION_STATUS_TEXT[item.status])}>
                {FOUNDATION_STATUS_LABELS[item.status]}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 opacity-85">{item.detail}</p>
            {item.meta ? (
              <div className="mt-2 space-y-1 border-t border-current/15 pt-2 text-xs leading-4 opacity-85">
                <p>
                  最終更新 {item.meta.updated_at} / {item.meta.updated_by_name ?? '更新者不明'} /{' '}
                  {item.meta.source}
                </p>
                <p>
                  {item.meta.confirmed_at
                    ? `確認 ${item.meta.confirmed_at} / ${item.meta.confirmed_by_name ?? '確認者不明'}`
                    : '確認者未設定'}
                  {item.meta.confirmation_status !== 'confirmed'
                    ? ` / ${item.meta.confirmation_detail}`
                    : ''}
                </p>
              </div>
            ) : null}
            <Link
              href={item.action_href}
              className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold underline-offset-4 hover:bg-background/60 hover:underline"
            >
              {item.action_label}
            </Link>
            {!foundation.archive.archived && item.status !== 'ready' ? (
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-auto min-h-11 px-3 py-2 text-xs"
                disabled={creatingTaskKey === item.key}
                onClick={() => void createFoundationTask(item)}
              >
                {creatingTaskKey === item.key ? '起票中...' : 'タスク化'}
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-muted/10 p-3">
          <h4 className="text-sm font-semibold text-foreground">前回訪問後の変更</h4>
          {changedItems.length > 0 ? (
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              {changedItems.map((item) => (
                <li key={item.id} className="rounded border border-border/60 bg-card p-2">
                  <p className="font-semibold text-foreground">
                    {item.field_label ?? item.field_key}
                  </p>
                  <p>
                    {formatActivityTime(item.created_at)} / {item.updated_by_name ?? '更新者不明'} /{' '}
                    {item.source}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              前回訪問以降に表示対象の正本変更はありません。
            </p>
          )}
        </div>

        <div className="rounded-md border border-border/70 bg-muted/10 p-3">
          <h4 className="text-sm font-semibold text-foreground">最新検査値</h4>
          {labItems.length > 0 ? (
            <ul className="mt-2 space-y-2 text-xs">
              {labItems.map((lab) => (
                <li key={lab.analyte_code} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-semibold text-foreground">{lab.analyte_code}</span>{' '}
                    {lab.value_label}
                    <span className="block text-muted-foreground">{lab.measured_at}</span>
                  </span>
                  {lab.abnormal || lab.stale ? (
                    <span className="rounded-full border border-transparent bg-state-confirm/10 px-2 py-0.5 text-xs font-semibold text-state-confirm">
                      {[lab.abnormal ? '異常' : null, lab.stale ? '古い' : null]
                        .filter(Boolean)
                        .join('・')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">主要検査値は未登録です。</p>
          )}
        </div>

        <div className="rounded-md border border-border/70 bg-muted/10 p-3">
          <h4 className="text-sm font-semibold text-foreground">保険・公費</h4>
          {insuranceItems.length > 0 ? (
            <ul className="mt-2 space-y-2 text-xs">
              {insuranceItems.map((insurance) => (
                <li
                  key={`${insurance.insurance_type}-${insurance.period_label}`}
                  className="rounded border border-border/60 bg-card p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-foreground">
                      {insurance.insurance_type}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border border-transparent px-2 py-0.5 text-xs font-semibold',
                        insurance.expires_soon
                          ? 'bg-state-confirm/10 text-state-confirm'
                          : 'bg-state-done/10 text-state-done',
                      )}
                    >
                      {insurance.status_label}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {insurance.period_label}
                    {insurance.copay_label ? ` / ${insurance.copay_label}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">有効な保険・公費は未登録です。</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function PatientVisitPreparationPanel({ patient }: { patient: PatientOverview }) {
  const intake = getPrimaryHomeVisitIntake(patient);
  if (!intake) return null;
  const addOn2 = intake.home_pharmacy_add_on_2;
  const specialProcedures = joinLabeledValues(
    intake.special_medical_procedures,
    specialProcedureLabels,
  );
  const narcotics = joinLabeledValues(addOn2?.narcotic_use_categories, narcoticUseCategoryLabels);
  const openTaskLabels = patient.summary_metrics.open_tasks_count
    ? `${patient.summary_metrics.open_tasks_count}件`
    : 'なし';

  return (
    <SectionCard aria-label="訪問前確認" data-testid="patient-visit-prep-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">訪問前確認</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            緊急、書類、調製・材料、次回確認、連携の迷いをここで潰します。
          </p>
        </div>
        <Link
          href={buildPatientHref(patient.id, '/edit')}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-11' })}
        >
          訪問情報を編集
        </Link>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <dl className="rounded-lg border border-border/70 bg-muted/10 px-3">
          <VisitPrepRow
            label="緊急・初動"
            value={[
              labelOf(intake.emergency_response, emergencyResponseLabels),
              intake.emergency_policy_note,
            ]
              .filter((value) => value && value !== '—')
              .join(' / ')}
          />
          <VisitPrepRow label="書類・期限" value={intake.document_status_note ?? '未設定'} />
          <VisitPrepRow label="報告先" value={intake.report_destination_note ?? '未設定'} />
          <VisitPrepRow
            label="現地・受渡"
            value={[
              labelOf(intake.visit_frequency, visitFrequencyLabels),
              intake.regular_visit_slot,
              intake.medication_handover_place,
            ]
              .filter(Boolean)
              .join(' / ')}
          />
          <VisitPrepRow
            label="薬剤保管"
            value={[intake.medication_storage_location, intake.collection_method]
              .filter(Boolean)
              .join(' / ')}
          />
        </dl>
        <dl className="rounded-lg border border-border/70 bg-muted/10 px-3">
          <VisitPrepRow
            label="調製・材料"
            value={[
              specialProcedures.join(' / '),
              labelOf(addOn2?.aseptic_preparation_need, asepticPreparationNeedLabels),
              intake.medical_material_supplier,
              intake.material_exchange_due_note,
            ]
              .filter((value) => value && value !== '—')
              .join(' / ')}
          />
          <VisitPrepRow
            label="麻薬・疼痛"
            value={[
              narcotics.join(' / '),
              intake.pain_score ? `NRS ${intake.pain_score}` : null,
              intake.rescue_use_count_recent,
            ]
              .filter(Boolean)
              .join(' / ')}
          />
          <VisitPrepRow
            label="残薬・副作用"
            value={[
              intake.residual_medication_pattern,
              formatVisitDate(intake.residual_medication_checked_on),
              labelOf(intake.residual_adjustment_status, supportStatusLabels),
              intake.adverse_monitoring_items?.join(' / '),
            ]
              .filter((value) => value && value !== '—')
              .join(' / ')}
          />
          <VisitPrepRow
            label="検査・転倒"
            value={[
              intake.egfr_value ? `eGFR ${intake.egfr_value}` : null,
              intake.weight_kg,
              labelOf(intake.fall_risk, triageRiskLabels),
            ]
              .filter((value) => value && value !== '—')
              .join(' / ')}
          />
          <VisitPrepRow
            label="連携タスク"
            value={[openTaskLabels, intake.interprofessional_action_note]
              .filter(Boolean)
              .join(' / ')}
          />
        </dl>
      </div>
    </SectionCard>
  );
}

function CardTodayPanel({ tasks }: { tasks: PatientWorkspaceTodayTask[] }) {
  return (
    <SectionCard aria-label="このカードに紐づく今日" data-testid="card-today-panel">
      <h3 className="text-sm font-semibold text-foreground">このカードに紐づく今日</h3>
      {tasks.length > 0 ? (
        <ul className="mt-3 divide-y divide-border/60" role="list">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <span
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                  TODAY_TONE_CLASSES[task.tone],
                )}
              >
                {task.time_label}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {task.label}
              </span>
              <Link
                href={task.href}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'shrink-0',
                })}
              >
                → {task.action_label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">今日このカードでやることはありません。</p>
      )}
    </SectionCard>
  );
}

function PatientCommandCenterPanel({
  nextAction,
  blockedReasons,
  evidence,
  recentActivities,
  timelineExcerpt,
  evidenceOpenLabel,
  caseRisk,
  riskTaskSync,
  riskTaskResolution,
}: {
  nextAction?: NextActionPanelProps;
  blockedReasons: BlockedReason[];
  evidence: EvidenceItem[];
  recentActivities: PatientCommandRecentActivityItem[];
  timelineExcerpt: {
    events: PatientMovementTimelineSnapshot['movement_events'];
    isLoading: boolean;
    error: boolean;
    onRetry: () => void;
  };
  evidenceOpenLabel?: string;
  caseRisk: {
    caseId: string | null;
    caseLabel: string | null;
    summary: PatientCommandCaseRiskSummary | null;
    actions: PatientCommandCaseRiskAction[];
    isLoading: boolean;
    isFetching: boolean;
    error: Error | null;
    onRetry: () => void;
  };
  riskTaskSync: {
    caseId: string | null;
    caseLabel: string | null;
    disabledReason?: string;
    isPending: boolean;
    result: CaseRiskTaskSyncUiResult | null;
    error: Error | null;
    onSync: (caseId: string) => void;
  };
  riskTaskResolution: {
    caseId: string | null;
    caseLabel: string | null;
    actions: CaseRiskNextAction[];
    isLoading: boolean;
    isFetching: boolean;
    error: Error | null;
    onRetry: () => void;
    isPending: boolean;
    pendingTaskId: string | null;
    mutationError: Error | null;
    drafts: Record<string, string>;
    reasonCodes: Record<string, RiskTaskWaiverReasonCode>;
    onDraftChange: (taskId: string, value: string) => void;
    onReasonCodeChange: (taskId: string, value: RiskTaskWaiverReasonCode) => void;
    onWaive: (input: {
      caseId: string;
      taskId: string;
      waiverReason: string;
      reasonCode: RiskTaskWaiverReasonCode;
    }) => void;
  };
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <div className="space-y-4">
        {nextAction ? (
          <NextActionPanel {...nextAction} />
        ) : (
          <SectionCard aria-label="次にやること" data-testid="next-action-panel">
            <h3 className="text-sm font-semibold text-foreground">次にやること</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              進行中の処方カードがないため、正本・共有・患者の動きで患者情報を確認してください。
            </p>
          </SectionCard>
        )}
        <CaseRiskActionsPanel {...caseRisk} />
        <BlockedReasonsPanel reasons={blockedReasons} emptyLabel="止まっている作業はありません" />
        <CommandRecentActivitiesPanel activities={recentActivities} />
        <CommandTimelineExcerptPanel {...timelineExcerpt} />
      </div>
      <div className="space-y-4">
        <EvidencePanel items={evidence} openLabel={evidenceOpenLabel} />
        <RiskTaskSyncPanel {...riskTaskSync} />
        <RiskTaskResolutionPanel {...riskTaskResolution} />
      </div>
    </div>
  );
}

function CommandTimelineExcerptPanel({
  events,
  isLoading,
  error,
  onRetry,
}: {
  events: PatientMovementTimelineSnapshot['movement_events'];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const excerpt = events.slice(0, 3);
  return (
    <SectionCard aria-label="Command 履歴抜粋" data-testid="command-timeline-excerpt-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">履歴抜粋</h3>
          <p className="text-sm text-muted-foreground">
            訪問、報告、請求、共有の直近履歴を最大5件だけ確認します。
          </p>
        </div>
        <Link
          href="#patient-movement"
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: 'min-h-11 shrink-0',
          })}
        >
          患者の動きへ
        </Link>
      </div>

      {isLoading ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          履歴抜粋を確認しています。
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-state-blocked/40 bg-state-blocked/10 p-3 text-sm text-state-blocked"
        >
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden className="size-4" />
            履歴抜粋を表示できません
          </div>
          <p className="mt-1">患者履歴の取得に失敗しました。</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 min-h-11"
            onClick={onRetry}
          >
            再試行
          </Button>
        </div>
      ) : null}

      {!isLoading && !error && excerpt.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">履歴抜粋はまだありません。</p>
      ) : null}

      {excerpt.length > 0 ? (
        <ul className="mt-3 divide-y divide-border/60" role="list">
          {excerpt.map((event) => (
            <li key={event.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{event.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatActivityTime(event.occurred_at)}
                  {event.status_label ? ` / ${event.status_label}` : ''}
                </p>
              </div>
              <Link
                href={event.href}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'min-h-11 shrink-0',
                })}
              >
                {event.action_label || '開く'}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

function CommandRecentActivitiesPanel({
  activities,
}: {
  activities: PatientCommandRecentActivityItem[];
}) {
  return (
    <SectionCard aria-label="Command 直近の動き" data-testid="command-recent-activities-panel">
      <h3 className="text-sm font-semibold text-foreground">直近の動き</h3>
      {activities.length > 0 ? (
        <ul className="mt-3 divide-y divide-border/60" role="list">
          {activities.map((activity) => (
            <li key={activity.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <span
                className={cn(
                  'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                  ACTIVITY_BADGE_CLASSES[activity.type],
                )}
              >
                {ACTIVITY_TYPE_LABELS[activity.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{activity.label}</p>
                <p className="text-xs text-muted-foreground">{activity.meta}</p>
              </div>
              <Link
                href={activity.href}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'min-h-11 shrink-0',
                })}
              >
                開く
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">直近の動きはまだありません。</p>
      )}
    </SectionCard>
  );
}

function CaseRiskActionsPanel({
  caseId,
  caseLabel,
  summary,
  actions,
  isLoading,
  isFetching,
  error,
  onRetry,
}: {
  caseId: string | null;
  caseLabel: string | null;
  summary: PatientCommandCaseRiskSummary | null;
  actions: PatientCommandCaseRiskAction[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <SectionCard aria-label="横断リスクの次アクション" data-testid="case-risk-actions-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">横断リスクの次アクション</h3>
          <p className="text-sm text-muted-foreground">
            同意、訪問準備、報告、請求、共有などの止まっている理由をまとめます。
          </p>
          {caseLabel ? (
            <p className="text-xs text-muted-foreground" data-testid="case-risk-actions-case">
              対象: {caseLabel}
            </p>
          ) : null}
        </div>
        {summary ? (
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-xs font-medium',
              summary.status === 'blocked'
                ? 'border-state-blocked/40 bg-state-blocked/10 text-state-blocked'
                : summary.status === 'attention'
                  ? 'border-state-confirm/40 bg-state-confirm/10 text-state-confirm'
                  : 'border-state-done/40 bg-state-done/10 text-state-done',
            )}
          >
            {summary.statusLabel}
          </div>
        ) : null}
      </div>

      {!caseId ? (
        <p className="mt-3 text-sm font-medium text-muted-foreground">対象ケースがありません。</p>
      ) : null}

      {isLoading ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          横断リスクを確認しています。
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-state-blocked/40 bg-state-blocked/10 p-3 text-sm text-state-blocked"
        >
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden className="size-4" />
            Case Risk Cockpit を表示できません
          </div>
          <p className="mt-1">{messageFromError(error, 'リスク状態の取得に失敗しました')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 min-h-11"
            onClick={onRetry}
          >
            再試行
          </Button>
        </div>
      ) : null}

      {caseId && !isLoading && !error && summary ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="rounded-md border border-border/60 bg-background/60 p-2">
            <dt>停止</dt>
            <dd className="font-semibold tabular-nums text-foreground">
              {summary.blockingCount}件
            </dd>
          </div>
          <div className="rounded-md border border-border/60 bg-background/60 p-2">
            <dt>至急</dt>
            <dd className="font-semibold tabular-nums text-foreground">{summary.urgentCount}件</dd>
          </div>
          <div className="rounded-md border border-border/60 bg-background/60 p-2">
            <dt>確認</dt>
            <dd className="font-semibold tabular-nums text-foreground">{summary.warningCount}件</dd>
          </div>
        </dl>
      ) : null}

      {caseId && !isLoading && !error && !summary ? (
        <p className="mt-3 text-sm text-muted-foreground">
          横断リスクをまだ取得できていません。表示されない場合は再試行してください。
        </p>
      ) : null}

      {caseId && !isLoading && !error && summary && actions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">横断リスクの次アクションはありません。</p>
      ) : null}

      {actions.length > 0 ? (
        <ul className="mt-3 space-y-2" role="list">
          {actions.map((action) => (
            <li
              key={action.id}
              className="rounded-lg border border-border/70 bg-background/60 p-3"
              data-testid="case-risk-command-action"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-semibold text-foreground">
                    {action.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    優先度: {formatCaseRiskPriority(action.priority)}
                    {action.dueAt
                      ? ` / 期限: ${formatOptionalDate(action.dueAt.slice(0, 10))}`
                      : ''}
                    {action.taskId ? ' / タスク化済み' : ''}
                  </p>
                </div>
                <Link
                  href={action.actionHref}
                  className={buttonVariants({
                    variant: action.priority === 'urgent' ? 'default' : 'outline',
                    size: 'sm',
                    className: 'min-h-11 shrink-0',
                  })}
                >
                  対応する
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {isFetching && !isLoading ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          最新の横断リスクを再確認しています。
        </p>
      ) : null}
    </SectionCard>
  );
}

function RiskTaskSyncPanel({
  caseId,
  caseLabel,
  disabledReason,
  isPending,
  result,
  error,
  onSync,
}: {
  caseId: string | null;
  caseLabel: string | null;
  disabledReason?: string;
  isPending: boolean;
  result: CaseRiskTaskSyncUiResult | null;
  error: Error | null;
  onSync: (caseId: string) => void;
}) {
  const descriptionId = 'case-risk-task-sync-description';
  const disabledReasonId = 'case-risk-task-sync-disabled-reason';
  const isDisabled = !caseId || Boolean(disabledReason);

  return (
    <SectionCard aria-label="リスクタスク同期" data-testid="case-risk-task-sync-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">未解決リスクをタスクへ同期</h3>
          <p id={descriptionId} className="text-sm text-muted-foreground">
            Case Risk Cockpit の blocking / urgent だけを運用タスクへ反映します。
          </p>
          {caseLabel ? (
            <p className="text-xs text-muted-foreground" data-testid="case-risk-task-sync-case">
              対象: {caseLabel}
            </p>
          ) : null}
        </div>
        <LoadingButton
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          loading={isPending}
          loadingLabel="同期中"
          disabled={isDisabled}
          aria-describedby={`${descriptionId}${disabledReason ? ` ${disabledReasonId}` : ''}`}
          onClick={() => {
            if (caseId) onSync(caseId);
          }}
        >
          同期する
        </LoadingButton>
      </div>
      {disabledReason ? (
        <p id={disabledReasonId} className="mt-3 text-sm font-medium text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      {isPending ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          リスク状態を確認し、必要なタスクだけを更新しています。
        </p>
      ) : null}
      {result ? (
        <div
          role="status"
          data-testid="case-risk-task-sync-result"
          className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-background/60 p-3 text-sm"
        >
          <div className="flex items-center gap-2 font-medium text-foreground">
            <CheckCircle2 aria-hidden className="size-4 text-state-done" />
            同期済み
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div>
              <dt>作成/更新</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {result.upserted_task_count}件
              </dd>
            </div>
            <div>
              <dt>解決</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {result.resolved_stale_task_count}件
              </dd>
            </div>
            <div>
              <dt>対象外</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {result.skipped_finding_count}件
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 flex items-center gap-2 text-sm font-medium text-state-blocked"
        >
          <TriangleAlert aria-hidden className="size-4" />
          {messageFromError(error, 'リスクタスク同期に失敗しました')}
        </p>
      ) : null}
    </SectionCard>
  );
}

function RiskTaskResolutionPanel({
  caseId,
  caseLabel,
  actions,
  isLoading,
  isFetching,
  error,
  onRetry,
  isPending,
  pendingTaskId,
  mutationError,
  drafts,
  reasonCodes,
  onDraftChange,
  onReasonCodeChange,
  onWaive,
}: {
  caseId: string | null;
  caseLabel: string | null;
  actions: CaseRiskNextAction[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  onRetry: () => void;
  isPending: boolean;
  pendingTaskId: string | null;
  mutationError: Error | null;
  drafts: Record<string, string>;
  reasonCodes: Record<string, RiskTaskWaiverReasonCode>;
  onDraftChange: (taskId: string, value: string) => void;
  onReasonCodeChange: (taskId: string, value: RiskTaskWaiverReasonCode) => void;
  onWaive: (input: {
    caseId: string;
    taskId: string;
    waiverReason: string;
    reasonCode: RiskTaskWaiverReasonCode;
  }) => void;
}) {
  const descriptionId = 'case-risk-task-resolution-description';
  const auditNoticeId = 'case-risk-task-resolution-audit-notice';
  const taskActions = actions.filter((action) => Boolean(action.task_id));

  return (
    <SectionCard aria-label="リスクタスク免除" data-testid="case-risk-task-resolution-panel">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">リスクタスクの免除</h3>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          タスク化済みの未解決リスクだけを、理由必須で専用フローから免除します。
        </p>
        {caseLabel ? (
          <p className="text-xs text-muted-foreground" data-testid="case-risk-task-resolution-case">
            対象: {caseLabel}
          </p>
        ) : null}
      </div>

      {!caseId ? (
        <p className="mt-3 text-sm font-medium text-muted-foreground">対象ケースがありません。</p>
      ) : null}

      {isLoading ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          リスクタスクを確認しています。
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-state-blocked/40 bg-state-blocked/10 p-3 text-sm text-state-blocked"
        >
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden className="size-4" />
            Case Risk Cockpit を表示できません
          </div>
          <p className="mt-1">{messageFromError(error, 'リスク状態の取得に失敗しました')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 min-h-11"
            onClick={onRetry}
          >
            再試行
          </Button>
        </div>
      ) : null}

      {caseId && !isLoading && !error && taskActions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          タスク化済みの未解決リスクはありません。必要な場合は上の同期を実行してください。
        </p>
      ) : null}

      {taskActions.length > 0 ? (
        <div className="mt-3 space-y-3">
          <p id={auditNoticeId} className="text-xs font-medium text-muted-foreground">
            免除理由は監査ログへ記録されます。理由本文は送信後に画面へ再表示しません。
          </p>
          {isFetching ? (
            <p role="status" className="text-xs text-muted-foreground">
              最新のリスク状態を再確認しています。
            </p>
          ) : null}
          <ul className="space-y-3" role="list">
            {taskActions.map((action) => {
              const taskId = action.task_id!;
              const reason = drafts[taskId] ?? '';
              const reasonCode = reasonCodes[taskId] ?? RISK_TASK_WAIVER_REASON_OPTIONS[0].value;
              const reasonId = `risk-task-waiver-reason-${taskId}`;
              const reasonCodeId = `risk-task-waiver-reason-code-${taskId}`;
              const reasonHelperId = `risk-task-waiver-reason-helper-${taskId}`;
              const isSubmitting = isPending && pendingTaskId === taskId;
              const isDisabled = !caseId || !reason.trim() || isPending;

              return (
                <li
                  key={taskId}
                  className="rounded-lg border border-border/70 bg-background/60 p-3"
                  data-testid="case-risk-task-resolution-action"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-foreground">{action.label}</p>
                      <p className="text-xs text-muted-foreground">
                        優先度: {formatCaseRiskPriority(action.priority)}
                        {action.due_at
                          ? ` / 期限: ${formatOptionalDate(action.due_at.slice(0, 10))}`
                          : ''}
                      </p>
                    </div>
                    <Link
                      href={action.action_href}
                      className={buttonVariants({
                        variant: 'ghost',
                        size: 'sm',
                        className: 'min-h-11 shrink-0',
                      })}
                    >
                      根拠へ
                    </Link>
                  </div>
                  <div className="mt-3 grid gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={reasonCodeId}>理由分類</Label>
                      <select
                        id={reasonCodeId}
                        className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={reasonCode}
                        onChange={(event) =>
                          onReasonCodeChange(
                            taskId,
                            event.currentTarget.value as RiskTaskWaiverReasonCode,
                          )
                        }
                      >
                        {RISK_TASK_WAIVER_REASON_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={reasonId}>免除理由</Label>
                      <Textarea
                        id={reasonId}
                        value={reason}
                        onChange={(event) => onDraftChange(taskId, event.currentTarget.value)}
                        aria-describedby={`${descriptionId} ${auditNoticeId}`}
                        placeholder="薬剤師確認済み、既存対応済みなど業務上の理由を入力"
                        rows={3}
                      />
                      <p id={reasonHelperId} className="text-xs text-muted-foreground">
                        免除理由を入力すると記録できます。
                      </p>
                    </div>
                    <LoadingButton
                      type="button"
                      variant="outline"
                      className="min-h-11 justify-self-start"
                      loading={isSubmitting}
                      loadingLabel="記録中"
                      disabled={isDisabled}
                      aria-describedby={`${descriptionId} ${auditNoticeId} ${reasonHelperId}`}
                      onClick={() => {
                        if (!caseId) return;
                        onWaive({
                          caseId,
                          taskId,
                          waiverReason: reason,
                          reasonCode,
                        });
                      }}
                    >
                      免除を記録
                    </LoadingButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {mutationError ? (
        <p
          role="alert"
          className="mt-3 flex items-center gap-2 text-sm font-medium text-state-blocked"
        >
          <TriangleAlert aria-hidden className="size-4" />
          {messageFromError(mutationError, 'リスクタスク免除に失敗しました')}
        </p>
      ) : null}
    </SectionCard>
  );
}

function formatCaseRiskPriority(priority: CaseRiskNextAction['priority']) {
  switch (priority) {
    case 'urgent':
      return '至急';
    case 'high':
      return '高';
    case 'low':
      return '低';
    default:
      return '通常';
  }
}

// 患者カードは最頻アクセス画面で、presence heartbeat や 17 本のクエリ/ミューテーション更新の
// たびに本体が再レンダリングされる。これらのパネルは props がすべてクエリ data / 安定参照
// (react-query の data・mutate、idle時 null の primitive) のため、React.memo で無関係な
// 再レンダリングを抑止できる。表示内容は不変。
const PatientFoundationPanelMemo = memo(PatientFoundationPanel);
const PatientProfilePanelMemo = memo(PatientProfilePanel);
const PatientContactsPanelMemo = memo(PatientContactsPanel);
const PatientHomeOperationsPanelMemo = memo(PatientHomeOperationsPanel);
const PatientShareCaseCreatePanelMemo = memo(PatientShareCaseCreatePanel);
const PatientCardDocumentsPanelMemo = memo(PatientCardDocumentsPanel);
const PatientVisitPreparationPanelMemo = memo(PatientVisitPreparationPanel);
const CardTodayPanelMemo = memo(CardTodayPanel);

/** 介護度コード(care_N / support_N)を要介護N・要支援N へ整形する。未知値はそのまま返す。 */
function formatCareLevel(careLevel: string): string {
  const careMatch = /^care_([1-5])$/.exec(careLevel);
  if (careMatch) return `要介護${careMatch[1]}`;
  const supportMatch = /^support_([12])$/.exec(careLevel);
  if (supportMatch) return `要支援${supportMatch[1]}`;
  return careLevel;
}

export function CardWorkspace({
  patientId,
  initialPatient = null,
}: {
  patientId: string;
  initialPatient?: PatientOverview | null;
}) {
  const orgId = useOrgId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [initialPatientUpdatedAt] = useState(() => (initialPatient ? Date.now() : undefined));
  const [activeDetailTab, setActiveDetailTab] = useState<PatientDetailTab>(() =>
    resolveInitialPatientDetailTab(),
  );
  const [timelineRequest, setTimelineRequest] = useState(() => ({
    patientId,
    limit: PATIENT_TIMELINE_INITIAL_LIMIT,
  }));
  const timelineLimit =
    timelineRequest.patientId === patientId
      ? timelineRequest.limit
      : PATIENT_TIMELINE_INITIAL_LIMIT;
  const [mountedDetailTabs, setMountedDetailTabs] = useState<ReadonlySet<PatientDetailTab>>(
    () => new Set<PatientDetailTab>([resolveInitialPatientDetailTab()]),
  );
  const [riskTaskSyncResult, setRiskTaskSyncResult] = useState<CaseRiskTaskSyncUiResult | null>(
    null,
  );
  const [riskTaskWaiverDrafts, setRiskTaskWaiverDrafts] = useState<Record<string, string>>({});
  const [riskTaskWaiverReasonCodes, setRiskTaskWaiverReasonCodes] = useState<
    Record<string, RiskTaskWaiverReasonCode>
  >({});

  const activateDetailTab = (tab: PatientDetailTab) => {
    setMountedDetailTabs((previous) =>
      previous.has(tab) ? previous : new Set<PatientDetailTab>([...previous, tab]),
    );
    setActiveDetailTab(tab);
  };
  const isDetailTabMounted = (tab: PatientDetailTab) => mountedDetailTabs.has(tab);

  useEffect(() => {
    const activateHashTab = () => {
      const hashTab = resolvePatientDetailTabFromHash(window.location.hash);
      if (!hashTab) return;
      setMountedDetailTabs((previous) =>
        previous.has(hashTab) ? previous : new Set<PatientDetailTab>([...previous, hashTab]),
      );
      setActiveDetailTab(hashTab);
    };

    activateHashTab();
    window.addEventListener('hashchange', activateHashTab);
    return () => window.removeEventListener('hashchange', activateHashTab);
  }, []);

  // P1-13 今だれが見ているか: このカードを開いていることを共有(ベストエフォート)
  usePresenceHeartbeat({
    entityType: 'patient',
    entityId: patientId,
    activeField: 'card',
    enabled: Boolean(orgId),
    initialDelayMs: 3_000,
  });

  const {
    data: patient,
    isLoading,
    error,
    refetch: refetchPatient,
  } = useQuery<PatientOverview>({
    queryKey: ['patient-overview', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/overview'), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: PatientOverview }>(res, {
        fallbackMessage: '患者情報の取得に失敗しました',
      });
      return payload.data;
    },
    enabled: Boolean(orgId),
    initialData: initialPatient ?? undefined,
    initialDataUpdatedAt: initialPatientUpdatedAt,
    staleTime: initialPatient ? SSR_PATIENT_OVERVIEW_STALE_TIME_MS : 0,
  });

  const {
    data: homeOperations,
    isError: homeOperationsError,
    refetch: refetchHomeOperations,
  } = useQuery<PatientHomeOperationsSnapshot>({
    queryKey: ['patient-home-operations', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/home-operations'), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: PatientHomeOperationsSnapshot }>(res, {
        fallbackMessage: '在宅運用管理の取得に失敗しました',
      });
      return payload.data;
    },
    enabled: Boolean(orgId && patient),
  });

  const { data: headerSummary, isError: headerSummaryError } = useQuery<PatientHeaderSummary>({
    queryKey: ['patient-header-summary', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/header-summary'), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: PatientHeaderSummary }>(res, {
        fallbackMessage: '患者ヘッダー情報の取得に失敗しました',
      });
      return payload.data;
    },
    enabled: Boolean(orgId && patient),
  });

  const commandCenterLatestCaseForQuery = patient ? selectLatestPatientCase(patient.cases) : null;
  const commandCenterCaseForQuery = patient ? selectCommandCenterCase(patient.cases) : null;
  const {
    data: caseRiskCockpit,
    isLoading: caseRiskCockpitLoading,
    isFetching: caseRiskCockpitFetching,
    isError: caseRiskCockpitIsError,
    error: caseRiskCockpitError,
    refetch: refetchCaseRiskCockpit,
  } = useQuery<CaseRiskCockpitResponse>({
    queryKey: ['case-risk-cockpit', commandCenterCaseForQuery?.id ?? null, orgId],
    queryFn: async () => {
      if (!commandCenterCaseForQuery?.id) {
        throw new Error('対象ケースがありません');
      }
      const response = await fetch(buildCaseRiskCockpitPath(commandCenterCaseForQuery.id), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: CaseRiskCockpitResponse }>(
        response,
        'Case Risk Cockpit の取得に失敗しました',
      );
      return payload.data;
    },
    enabled: Boolean(orgId && commandCenterCaseForQuery?.id && isDetailTabMounted('command')),
    staleTime: 30_000,
  });

  const {
    data: movementTimelineSnapshot,
    isLoading: movementTimelineLoading,
    isFetching: movementTimelineFetching,
    isError: movementTimelineError,
    refetch: refetchMovementTimeline,
  } = useQuery<PatientMovementTimelineSnapshot>({
    queryKey: ['patient-movement-timeline', patientId, orgId, timelineLimit],
    queryFn: async () => {
      const path = `${buildPatientApiPath(patientId, '/movement-timeline')}?${new URLSearchParams({
        limit: String(timelineLimit),
      }).toString()}`;
      const response = await fetch(path, { headers: buildOrgHeaders(orgId) });
      return readApiJson<PatientMovementTimelineSnapshot>(
        response,
        '患者の動きの取得に失敗しました',
      );
    },
    enabled: Boolean(
      orgId && patient && (isDetailTabMounted('command') || isDetailTabMounted('movement')),
    ),
    staleTime: 30_000,
  });

  const markFaxOriginalCollectedMutation = useMutation({
    mutationFn: async (intakeId: string) => {
      const response = await fetch(buildPrescriptionIntakeApiPath(intakeId), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          original_collected_at: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? 'FAX原本到着の記録に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
      ]);
      toast.success('FAX原本の到着を記録しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, 'FAX原本到着の記録に失敗しました'));
    },
  });

  const savePrescriptionDocumentMutation = useMutation({
    mutationFn: async (input: PrescriptionDocumentFormInput) => {
      if (!input.documentUrl) {
        throw new Error('処方せん画像/PDF URLを入力してください');
      }
      const response = await fetch(buildPrescriptionIntakeApiPath(input.intakeId), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          original_document_url: input.documentUrl,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? '処方せん画像/PDFの保存に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['prescription-intake-detail', orgId] }),
      ]);
      toast.success('処方せん画像/PDFを保存しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, '処方せん画像/PDFの保存に失敗しました'));
    },
  });

  const uploadPrescriptionDocument = async (file: File) => {
    // 画像/PDF 混在: PDF は downscaleImage 内の image/* 判定で無変換のまま返す(W2-F1)。
    const uploadFile = await downscaleImage(file);
    const presignResponse = await fetch('/api/files/presigned-upload', {
      method: 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({
        purpose: 'prescription',
        patient_id: patientId,
        file_name: uploadFile.name,
        mime_type: uploadFile.type || 'application/octet-stream',
        size_bytes: uploadFile.size,
      }),
    });

    const presignJson = await presignResponse.json().catch(() => null);
    if (!presignResponse.ok) {
      throw new Error(
        presignJson?.message ?? '処方せん画像/PDFのアップロードURL取得に失敗しました',
      );
    }

    const uploadResponse = await fetch(presignJson.data.uploadUrl, {
      method: 'PUT',
      headers: presignJson.data.headers,
      body: uploadFile,
    });
    if (!uploadResponse.ok) {
      throw new Error('処方せん画像/PDFのアップロードに失敗しました');
    }

    const completeResponse = await fetch('/api/files/complete', {
      method: 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({
        file_id: presignJson.data.id,
        etag: uploadResponse.headers.get('etag') ?? undefined,
      }),
    });

    const completeJson = await completeResponse.json().catch(() => null);
    if (!completeResponse.ok) {
      throw new Error(completeJson?.message ?? '処方せん画像/PDFのアップロード確定に失敗しました');
    }

    return new URL(buildFileDownloadHref(completeJson.data.id), window.location.origin).toString();
  };

  const recordPrescriptionOriginalManagementMutation = useMutation({
    mutationFn: async (input: PrescriptionOriginalManagementFormInput) => {
      const response = await fetch(buildPrescriptionIntakeApiPath(input.intakeId), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          original_collected_at: input.originalCollectedAt,
          original_management: {
            reconciliation_result: input.reconciliationResult,
            discrepancy_note: input.discrepancyNote,
            storage_location: input.storageLocation,
            e_prescription_exchange_number: input.ePrescriptionExchangeNumber,
            e_prescription_acquired_status: input.ePrescriptionAcquiredStatus,
            dispensing_result_registration: input.dispensingResultRegistration,
            note: input.note,
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? '処方せん原本管理の保存に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['prescription-intake-detail', orgId] }),
      ]);
      toast.success('処方せん原本管理を保存しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, '処方せん原本管理の保存に失敗しました'));
    },
  });

  const recordBillingCollectionMutation = useMutation({
    mutationFn: async (input: BillingCollectionFormInput) => {
      const response = await fetch(
        `/api/billing-candidates/${encodePathSegment(input.candidateId)}/collection`,
        {
          method: 'PATCH',
          headers: buildOrgJsonHeaders(orgId, { 'Idempotency-Key': input.idempotencyKey }),
          body: JSON.stringify({
            status: input.status,
            expected_updated_at: input.expectedUpdatedAt,
            billed_amount: input.billedAmount,
            collected_amount: input.collectedAmount,
            payment_method: input.paymentMethod,
            payer_name: input.payerName,
            scheduled_collection_at: input.scheduledCollectionAt,
            collected_at: ['collected', 'partial'].includes(input.status)
              ? new Date().toISOString()
              : null,
            receipt_number: input.receiptNumber,
            receipt_issue_status: input.receiptIssueStatus,
            invoice_issue_status: input.invoiceIssueStatus,
            save_receipt_copy: input.saveReceiptCopy,
            save_invoice_copy: input.saveInvoiceCopy,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? '集金記録の保存に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['billing-candidates', orgId] }),
      ]);
      toast.success('集金記録を保存しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, '集金記録の保存に失敗しました'));
    },
  });

  const recordBillingPaymentProfileMutation = useMutation({
    mutationFn: async (input: BillingPaymentProfileFormInput) => {
      const response = await fetch(
        `/api/patients/${encodePathSegment(input.patientId)}/billing-profile`,
        {
          method: 'PATCH',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify({
            payer_type: input.payerType,
            payer_name: input.payerName,
            payer_relation: input.payerRelation,
            billing_address_mode: input.billingAddressMode,
            billing_address: input.billingAddress,
            payment_method: input.paymentMethod,
            collection_timing: input.collectionTiming,
            receipt_issue: input.receiptIssue,
            invoice_issue: input.invoiceIssue,
            unpaid_tolerance: input.unpaidTolerance,
            note: input.note,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? '支払設定の保存に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
      ]);
      toast.success('支払設定を保存しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, '支払設定の保存に失敗しました'));
    },
  });

  const recordConferenceNoteMutation = useMutation({
    mutationFn: async (input: ConferenceNoteFormInput) => {
      if (!input.title || !input.conferenceDate || !input.content) {
        throw new Error('会議名・開催日時・会議要点を入力してください');
      }
      const structuredContent = buildConferenceStructuredContent(input);
      const participants = parseConferenceParticipants(input.participantsRaw);
      const pharmacyParticipants = parseConferenceNameList(input.pharmacyParticipantsRaw);
      const response = await fetch('/api/conference-notes', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          note_type: input.noteType,
          conference_type: input.noteType,
          title: input.title,
          patient_id: input.patientId,
          ...(input.caseId ? { case_id: input.caseId } : {}),
          content: input.content,
          conference_date: new Date(input.conferenceDate).toISOString(),
          ...(input.followUpDate
            ? { follow_up_date: new Date(input.followUpDate).toISOString() }
            : {}),
          follow_up_completed: input.followUpCompleted,
          participants,
          metadata: {
            visit_brief: {
              patient_id: input.patientId,
            },
            conference_operation: {
              format: input.conferenceFormat,
              ...(input.location ? { location: input.location } : {}),
              organizer: input.organizer,
              ...(input.agenda ? { agenda: input.agenda } : {}),
              ...(pharmacyParticipants.length
                ? { pharmacy_participants: pharmacyParticipants }
                : {}),
              participant_count: participants.length + pharmacyParticipants.length,
              report_type: input.reportType,
            },
          },
          ...(structuredContent ? { structured_content: structuredContent } : {}),
          action_items: parseConferenceActionItems(input.actionItemsRaw),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? '会議要点の保存に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['conference-notes', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['conference-notes-calendar', orgId] }),
      ]);
      toast.success('会議要点を保存しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, '会議要点の保存に失敗しました'));
    },
  });

  const recordMcsCheckLogMutation = useMutation({
    mutationFn: async (input: McsCheckLogFormInput) => {
      const response = await fetch(`/api/patients/${encodePathSegment(input.patientId)}/mcs/logs`, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          content_type: input.contentType,
          summary: input.summary,
          next_action: input.nextAction,
          occurred_at: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? 'MCS確認ログの保存に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-home-operations', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['patient-mcs', patientId, orgId] }),
      ]);
      toast.success('MCS確認ログを保存しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, 'MCS確認ログの保存に失敗しました'));
    },
  });

  const syncRiskTasksMutation = useMutation({
    mutationFn: async (caseId: string) => {
      const response = await fetch(buildCaseRiskTaskSyncPath(caseId), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
      });
      const payload = await readApiJson<{ data: CaseRiskTaskSyncUiResult }>(
        response,
        'リスクタスク同期に失敗しました',
      );
      return payload.data;
    },
    onSuccess: async (result) => {
      setRiskTaskSyncResult(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['case-risk-cockpit', result.case_id, orgId] }),
      ]);
      toast.success(
        `未解決リスクをタスクへ同期しました（作成/更新 ${result.upserted_task_count}件 / 解決 ${result.resolved_stale_task_count}件）`,
      );
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, 'リスクタスク同期に失敗しました'));
    },
  });

  const waiveRiskTaskMutation = useMutation({
    mutationFn: async (input: {
      caseId: string;
      taskId: string;
      waiverReason: string;
      reasonCode: RiskTaskWaiverReasonCode;
    }) => {
      const response = await fetch(buildCaseRiskTaskResolutionPath(input.caseId, input.taskId), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          resolution_state: 'waived',
          waiver_reason: input.waiverReason,
          reason_code: input.reasonCode,
        }),
      });
      const payload = await readApiJson<{ data: CaseRiskTaskResolutionUiResult }>(
        response,
        'リスクタスク免除に失敗しました',
      );
      return payload.data;
    },
    onSuccess: async (result) => {
      setRiskTaskWaiverDrafts((previous) => {
        const next = { ...previous };
        delete next[result.task_id];
        return next;
      });
      setRiskTaskWaiverReasonCodes((previous) => {
        const next = { ...previous };
        delete next[result.task_id];
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['case-risk-cockpit', result.case_id, orgId] }),
      ]);
      toast.success('リスクタスクの免除を記録しました');
    },
    onError: (error: Error) => {
      toast.error(messageFromError(error, 'リスクタスク免除に失敗しました'));
    },
  });

  if (!orgId || isLoading) return <PatientCardWorkspaceLoadingState />;
  if (!patient) {
    // 取得失敗(error)を「患者が見つかりません」(=不在)に潰さない。
    // error 時は再試行導線付き ErrorState、患者データが無く error も無い場合のみ not-found。
    return error ? (
      <ErrorState
        variant="server"
        title="患者情報を表示できません"
        description="患者情報の取得に失敗しました。再試行してください。"
        detail={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetchPatient()}
      />
    ) : (
      <EmptyState
        icon={FileQuestion}
        title="患者が見つかりません"
        description="指定された患者情報を取得できませんでした"
      />
    );
  }
  // patient が存在する場合は、背景 refetch が失敗(error)していてもワークスペースを維持して表示する
  // (react-query v5 は cached/initialData がある状態で error をセットしても data を保持する)。

  const renderPatientTimelinePanel = () => {
    if (movementTimelineLoading) {
      return (
        <SegmentLoading
          label="患者の動きを読み込み中"
          description="訪問、処方、文書、連絡の発生履歴を部分取得しています。"
          rows={3}
          cols={2}
        />
      );
    }

    if (movementTimelineError) {
      return (
        <SegmentError
          title="患者の動きを表示できません"
          cause="患者の動きの取得に失敗しました。"
          nextAction="通信状態または権限を確認して再試行してください。"
          onRetry={() => void refetchMovementTimeline()}
          retryLabel="患者の動きを再取得"
        />
      );
    }

    return (
      <PatientMovementTimelinePanel
        timelineEvents={movementTimelineSnapshot?.movement_events ?? []}
        selfReports={[]}
        isPartial={timelineLimit < PATIENT_TIMELINE_FULL_LIMIT}
        fullLimit={PATIENT_TIMELINE_FULL_LIMIT}
        isLoadingFull={movementTimelineFetching && timelineLimit >= PATIENT_TIMELINE_FULL_LIMIT}
        partialFailures={movementTimelineSnapshot?.partial_failures}
        onLoadFull={() => setTimelineRequest({ patientId, limit: PATIENT_TIMELINE_FULL_LIMIT })}
      />
    );
  };

  const workspace = patient.workspace;
  const rxNumber = workspace?.current_intake
    ? formatPrescriptionCardNumber(
        workspace.current_intake.id,
        workspace.current_intake.prescribed_date.slice(0, 10),
        'rx_year',
      )
    : null;
  // 共通患者ヘッダー(PatientHeader)へ渡す派生値。workspace が無い患者でも識別・正本確認時の
  // 誤患者防止を維持するため、処方カード有無に依存しない位置で組み立てる。
  const headerIntake = getPrimaryHomeVisitIntake(patient);
  const headerCareLevelRaw =
    patient.scheduling_preference?.care_level ?? headerIntake?.care_level ?? null;
  const headerCareLevelLabel = headerCareLevelRaw ? formatCareLevel(headerCareLevelRaw) : null;
  const headerHomeStatusRaw = labelOf(headerIntake?.home_care_status, homeCareStatusLabels);
  const headerHomeStatusLabel = headerHomeStatusRaw !== '—' ? headerHomeStatusRaw : null;
  const headerResidenceRaw = formatResidenceLabel(patient);
  const headerResidenceLabel = headerResidenceRaw !== '住所未設定' ? headerResidenceRaw : null;
  const headerPrimaryCondition =
    patient.conditions.find((c) => c.is_primary && c.is_active) ??
    patient.conditions.find((c) => c.is_active) ??
    null;
  const headerPrimaryDiagnosis = headerPrimaryCondition?.name ?? null;
  // backend getPatientHeaderSummary と同じ tie-break(updated_at → created_at → id, いずれも desc)で
  // latest ケースを選ぶ。これにより担当4名(header-summary 由来)と介入開始日が同一ケースを指す。
  const headerLatestCase = commandCenterLatestCaseForQuery;
  const commandCenterCase = commandCenterCaseForQuery;
  const commandCenterCaseLabel = commandCenterCase
    ? formatPatientShareCaseOption(commandCenterCase)
    : null;
  const headerInterventionStartDate = headerLatestCase?.start_date ?? null;
  const headerVisit = buildVisitScheduleLabel(patient);
  const headerLastVisitLabel = headerVisit.latest !== '未設定' ? headerVisit.latest : null;
  const headerNextVisitLabel = headerVisit.next !== '未設定' ? headerVisit.next : null;
  const headerFirstVisitLabel = headerSummary?.first_visit_date
    ? formatOptionalDate(headerSummary.first_visit_date.slice(0, 10))
    : null;
  const headerLastPrescriptionLabel = headerSummary?.last_prescribed_date
    ? formatOptionalDate(headerSummary.last_prescribed_date.slice(0, 10))
    : null;
  const headerNextPrescriptionLabel = headerSummary?.next_prescription_expected_date
    ? formatOptionalDate(headerSummary.next_prescription_expected_date.slice(0, 10))
    : null;
  const patientHeader = (
    <div className="space-y-1.5">
      <PatientHeader
        name={patient.name}
        kana={patient.name_kana}
        birthDate={patient.birth_date}
        genderLabel={formatGenderLabel(patient.gender)}
        careLevelLabel={headerCareLevelLabel}
        homeStatusLabel={headerHomeStatusLabel}
        residenceLabel={headerResidenceLabel}
        careTeam={{
          primaryPharmacist: headerSummary?.primary_pharmacist_name ?? null,
          backupPharmacist: headerSummary?.backup_pharmacist_name ?? null,
          primaryStaff: headerSummary?.primary_staff_name ?? null,
          backupStaff: headerSummary?.backup_staff_name ?? null,
        }}
        primaryDiagnosis={headerPrimaryDiagnosis}
        interventionStartDate={headerInterventionStartDate}
        firstVisitLabel={headerFirstVisitLabel}
        lastVisitLabel={headerLastVisitLabel}
        nextVisitLabel={headerNextVisitLabel}
        lastPrescriptionLabel={headerLastPrescriptionLabel}
        nextPrescriptionLabel={headerNextPrescriptionLabel}
        safety={{
          allergy: workspace?.safety.allergy ?? null,
          renal: workspace?.safety.renal ?? null,
          handlingTags: workspace?.safety.handling_tags ?? [],
          swallowing: workspace?.safety.swallowing ?? null,
          cautions: workspace?.safety.cautions ?? [],
        }}
        archive={{
          archived: patient.foundation.archive.archived,
          archivedAt: patient.foundation.archive.archived_at,
          archivedByName: patient.foundation.archive.archived_by_name,
        }}
        safetyCheckHref={buildPatientHref(patientId, '/safety-check')}
      />
      {headerSummaryError ? (
        <p
          role="status"
          data-testid="patient-header-summary-error"
          className="flex items-center gap-1 px-1 text-xs font-medium text-tag-hazard"
        >
          <TriangleAlert aria-hidden className="size-3.5" />
          担当者・処方／訪問サマリーを取得できませんでした（最新の担当情報が表示されていない可能性があります）。
        </p>
      ) : null}
    </div>
  );

  const headerRow = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold leading-snug text-foreground">処方カード作業台</h1>
          {rxNumber ? (
            <p className="text-sm tabular-nums text-muted-foreground">{rxNumber}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={buildPatientHref(patientId, '/collaboration')}
          className={buttonVariants({
            variant: 'outline',
            className: '!h-auto !min-h-11 px-4 py-2',
          })}
          data-testid="card-open-collaboration"
        >
          いま見ている人
        </Link>
        <Button
          type="button"
          variant="outline"
          className="!h-auto !min-h-11 px-4 py-2"
          data-testid="card-open-profile"
          onClick={() => activateDetailTab('foundation')}
        >
          プロフィールを確認
        </Button>
        {/* カードの分割表示は side-by-side で幅が要るデスクトップ機能。狭い画面では
            プレミアムな上部スペースを使わないよう非表示にする(モバイルは最小情報優先)。 */}
        <Link
          href={buildPatientCompareHref(patientId)}
          className={buttonVariants({
            variant: 'outline',
            className: 'max-sm:hidden !h-auto !min-h-11 px-4 py-2',
          })}
          data-testid="card-open-compare"
        >
          カードを分割表示
        </Link>
      </div>
    </div>
  );

  const caseRiskCommand = buildCaseRiskCommandPanelModel(caseRiskCockpit);
  const caseRiskError =
    caseRiskCockpitIsError && caseRiskCockpitError instanceof Error ? caseRiskCockpitError : null;
  const taskBackedCaseRiskActions =
    caseRiskCockpit?.next_actions.filter((action) => Boolean(action.task_id)) ?? [];
  const pendingWaiverTaskId = waiveRiskTaskMutation.variables?.taskId ?? null;
  const commandCaseRiskProps = {
    caseId: commandCenterCase?.id ?? null,
    caseLabel: commandCenterCaseLabel,
    summary: caseRiskCommand.caseRiskSummary,
    actions: caseRiskCommand.caseRiskActions,
    isLoading: caseRiskCockpitLoading,
    isFetching: caseRiskCockpitFetching,
    error: caseRiskError,
    onRetry: () => void refetchCaseRiskCockpit(),
  };
  const commandRiskTaskSyncProps = {
    caseId: commandCenterCase?.id ?? null,
    caseLabel: commandCenterCaseLabel,
    disabledReason: commandCenterCase ? undefined : '対象ケースがありません。',
    isPending: syncRiskTasksMutation.isPending,
    result: riskTaskSyncResult,
    error: syncRiskTasksMutation.error instanceof Error ? syncRiskTasksMutation.error : null,
    onSync: syncRiskTasksMutation.mutate,
  };
  const commandRiskTaskResolutionProps = {
    caseId: commandCenterCase?.id ?? null,
    caseLabel: commandCenterCaseLabel,
    actions: taskBackedCaseRiskActions,
    isLoading: caseRiskCockpitLoading,
    isFetching: caseRiskCockpitFetching,
    error: caseRiskError,
    onRetry: () => void refetchCaseRiskCockpit(),
    isPending: waiveRiskTaskMutation.isPending,
    pendingTaskId: pendingWaiverTaskId,
    mutationError:
      waiveRiskTaskMutation.error instanceof Error ? waiveRiskTaskMutation.error : null,
    drafts: riskTaskWaiverDrafts,
    reasonCodes: riskTaskWaiverReasonCodes,
    onDraftChange: (taskId: string, value: string) =>
      setRiskTaskWaiverDrafts((previous) => ({
        ...previous,
        [taskId]: value,
      })),
    onReasonCodeChange: (taskId: string, value: RiskTaskWaiverReasonCode) =>
      setRiskTaskWaiverReasonCodes((previous) => ({
        ...previous,
        [taskId]: value,
      })),
    onWaive: waiveRiskTaskMutation.mutate,
  };
  const commandTimelineExcerptProps = {
    events: movementTimelineSnapshot?.movement_events ?? [],
    isLoading: movementTimelineLoading,
    error: movementTimelineError,
    onRetry: () => void refetchMovementTimeline(),
  };

  const renderHomeOperationsPanel = (
    visibleKeys: PatientHomeOperationKey[],
    panelId = 'patient-home-operations',
  ) => (
    <PatientHomeOperationsPanelMemo
      patient={patient}
      operations={homeOperations}
      operationsError={homeOperationsError}
      onRetryOperations={() => void refetchHomeOperations()}
      markingFaxOriginalIntakeId={
        markFaxOriginalCollectedMutation.isPending
          ? markFaxOriginalCollectedMutation.variables
          : null
      }
      savingPrescriptionDocumentIntakeId={
        savePrescriptionDocumentMutation.isPending
          ? savePrescriptionDocumentMutation.variables?.intakeId
          : null
      }
      recordingPrescriptionOriginalManagementIntakeId={
        recordPrescriptionOriginalManagementMutation.isPending
          ? recordPrescriptionOriginalManagementMutation.variables?.intakeId
          : null
      }
      recordingBillingPaymentProfilePatientId={
        recordBillingPaymentProfileMutation.isPending
          ? recordBillingPaymentProfileMutation.variables?.patientId
          : null
      }
      recordingBillingCandidateId={
        recordBillingCollectionMutation.isPending
          ? recordBillingCollectionMutation.variables?.candidateId
          : null
      }
      recordingConferenceScopeId={
        recordConferenceNoteMutation.isPending
          ? recordConferenceNoteMutation.variables?.caseId
            ? `case:${recordConferenceNoteMutation.variables.caseId}`
            : `patient:${recordConferenceNoteMutation.variables?.patientId}`
          : null
      }
      recordingMcsCheckPatientId={
        recordMcsCheckLogMutation.isPending ? recordMcsCheckLogMutation.variables?.patientId : null
      }
      onMarkFaxOriginalCollected={markFaxOriginalCollectedMutation.mutate}
      onSavePrescriptionDocument={savePrescriptionDocumentMutation.mutate}
      onUploadPrescriptionDocument={uploadPrescriptionDocument}
      onRecordPrescriptionOriginalManagement={recordPrescriptionOriginalManagementMutation.mutate}
      onRecordBillingPaymentProfile={recordBillingPaymentProfileMutation.mutate}
      onRecordBillingCollection={recordBillingCollectionMutation.mutate}
      onRecordConferenceNote={recordConferenceNoteMutation.mutate}
      onRecordMcsCheckLog={recordMcsCheckLogMutation.mutate}
      visibleKeys={visibleKeys}
      panelId={panelId}
    />
  );

  if (!workspace) {
    return (
      <div className="space-y-6" data-testid="card-workspace">
        {headerRow}
        {patientHeader}
        <Tabs
          value={activeDetailTab}
          onValueChange={(value) => activateDetailTab(value as PatientDetailTab)}
          className="gap-4"
        >
          <TabsList
            variant="line"
            aria-label="患者詳細セクション"
            data-testid="patient-detail-tablist"
            className="flex w-full flex-wrap justify-start gap-2 border-b border-border/70 pb-1"
          >
            {PATIENT_DETAIL_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="min-h-11 px-3"
                aria-label={`${tab.label}: ${tab.description}`}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {isDetailTabMounted('command') ? (
            <TabsContent value="command" keepMounted className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">Command</h2>
              <PatientCommandCenterPanel
                blockedReasons={[]}
                evidence={[]}
                recentActivities={[]}
                timelineExcerpt={commandTimelineExcerptProps}
                evidenceOpenLabel="開く"
                caseRisk={commandCaseRiskProps}
                riskTaskSync={commandRiskTaskSyncProps}
                riskTaskResolution={commandRiskTaskResolutionProps}
              />
            </TabsContent>
          ) : null}
          {isDetailTabMounted('foundation') ? (
            <TabsContent value="foundation" keepMounted className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">正本・在宅運用</h2>
              <PatientFoundationPanelMemo patient={patient} />
              <PatientProfilePanelMemo patient={patient} />
              <div id="patient-contacts">
                <PatientContactsPanelMemo
                  patientId={patient.id}
                  orgId={orgId}
                  initialContacts={patient.contacts}
                  initialExpectedUpdatedAt={patient.updated_at}
                />
              </div>
            </TabsContent>
          ) : null}
          {isDetailTabMounted('medication') ? (
            <TabsContent value="medication" keepMounted className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">薬剤・訪問</h2>
              <PatientVisitPreparationPanelMemo patient={patient} />
              {renderHomeOperationsPanel(['prescription'], 'patient-home-operations-medication')}
            </TabsContent>
          ) : null}
          {isDetailTabMounted('movement') ? (
            <TabsContent value="movement" keepMounted className="space-y-4">
              <div id="patient-movement" data-testid="patient-movement-panel" className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">患者の動き</h2>
                {renderPatientTimelinePanel()}
              </div>
            </TabsContent>
          ) : null}
          {isDetailTabMounted('sharing') ? (
            <TabsContent value="sharing" keepMounted className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">共有・文書</h2>
              <PatientShareCaseCreatePanelMemo patient={patient} orgId={orgId} />
              <PatientCardDocumentsPanelMemo patient={patient} orgId={orgId} />
              {renderHomeOperationsPanel(['documents', 'mcs'], 'patient-home-operations-sharing')}
            </TabsContent>
          ) : null}
          {isDetailTabMounted('billing') ? (
            <TabsContent value="billing" keepMounted className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">請求・会議</h2>
              {renderHomeOperationsPanel(['billing', 'conference'])}
            </TabsContent>
          ) : null}
          {isDetailTabMounted('history') ? (
            <TabsContent value="history" keepMounted className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">履歴・構造化</h2>
              <div id="patient-structured-care" data-testid="patient-structured-care">
                <PatientStructuredCarePanel patientId={patientId} />
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    );
  }

  const {
    currentStep,
    currentStepLabel,
    cycleAction,
    processLabel,
    nextAction,
    blockedReasons,
    evidence,
    recentActivities,
    caseRiskSummary,
    caseRiskActions,
  } = buildPatientCommandCenterModel({ patient, patientId, workspace, caseRiskCockpit });
  return (
    <div className="space-y-4" data-testid="card-workspace">
      {headerRow}

      {/* 本文を圧迫しないため、補助3点セットは上部バーから開く右ドロワーへ移す。 */}
      <div className="space-y-4">
        <div className="min-w-0 space-y-6">
          {patientHeader}

          <Tabs
            value={activeDetailTab}
            onValueChange={(value) => activateDetailTab(value as PatientDetailTab)}
            className="gap-4"
          >
            <div className="sticky top-14 z-20 border-b border-border/70 bg-background/95 pb-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <TabsList
                variant="line"
                aria-label="患者詳細セクション"
                data-testid="patient-detail-tablist"
                className="flex w-full flex-wrap justify-start gap-2"
              >
                {PATIENT_DETAIL_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="min-h-11 px-3"
                    aria-label={`${tab.label}: ${tab.description}`}
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {isDetailTabMounted('command') ? (
              <TabsContent value="command" keepMounted className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">Command</h2>
                <PatientCommandCenterPanel
                  nextAction={nextAction}
                  blockedReasons={blockedReasons}
                  evidence={evidence}
                  recentActivities={recentActivities}
                  timelineExcerpt={commandTimelineExcerptProps}
                  evidenceOpenLabel="開く"
                  caseRisk={{
                    ...commandCaseRiskProps,
                    summary: caseRiskSummary,
                    actions: caseRiskActions,
                  }}
                  riskTaskSync={commandRiskTaskSyncProps}
                  riskTaskResolution={commandRiskTaskResolutionProps}
                />
                <CardTodayPanelMemo tasks={workspace.today_tasks} />
              </TabsContent>
            ) : null}

            {isDetailTabMounted('medication') ? (
              <TabsContent value="medication" keepMounted className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">薬剤・訪問</h2>

                {/* 今回の処方: 安全確認の直後に置き、正本/補助パネルより先に実作業へ入れる */}
                <SectionCard aria-label="今回の処方" data-testid="card-prescription-section">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-base font-semibold text-foreground">
                        今回の処方{rxNumber ? ` — ${rxNumber}` : ''}
                      </h3>
                      {processLabel ? (
                        <span className="text-xs text-muted-foreground">{processLabel}</span>
                      ) : null}
                    </div>
                    {cycleAction && currentStepLabel ? (
                      <Link
                        href={cycleAction.actionHref}
                        className={buttonVariants({
                          variant: 'outline',
                          className: '!h-auto !min-h-11 px-4 py-2',
                        })}
                      >
                        → {currentStepLabel}へ
                      </Link>
                    ) : null}
                  </div>
                  {currentStep ? <ProcessChips currentStep={currentStep} className="mt-3" /> : null}
                  {workspace.prescription_lines.length > 0 ? (
                    // 麻薬/冷所 等の取扱い注意は「安全」列のトークンベース バッジで表すため、
                    // 行全体の生アラート色塗り(非トークン)は引き算する。
                    <div className="mt-3">
                      <DataTable
                        columns={prescriptionWorkspaceLineColumns}
                        data={workspace.prescription_lines}
                        getRowId={(line) => line.id}
                        caption="今回の処方明細"
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      処方明細はまだ取り込まれていません。
                    </p>
                  )}
                </SectionCard>

                <PatientVisitPreparationPanelMemo patient={patient} />
                {renderHomeOperationsPanel(['prescription'], 'patient-home-operations-medication')}

                {/* 直近の動き: 工程遷移・疑義照会・処方取込の時系列 */}
                <SectionCard aria-label="直近の動き" data-testid="card-recent-activities">
                  <h3 className="text-base font-semibold text-foreground">直近の動き</h3>
                  {workspace.recent_activities.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {workspace.recent_activities.map((activity) => (
                        <ListOpenCard
                          key={activity.id}
                          badgeLabel={ACTIVITY_TYPE_LABELS[activity.type]}
                          badgeClassName={ACTIVITY_BADGE_CLASSES[activity.type]}
                          title={
                            activity.actor
                              ? `${activity.label} — ${activity.actor}`
                              : activity.label
                          }
                          subtitle={formatActivityTime(activity.at)}
                          openLabel="開く"
                          onOpen={() => router.push(activity.href)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      直近の動きはまだありません。
                    </p>
                  )}
                </SectionCard>
              </TabsContent>
            ) : null}

            {isDetailTabMounted('movement') ? (
              <TabsContent value="movement" keepMounted className="space-y-4">
                <div
                  id="patient-movement"
                  data-testid="patient-movement-panel"
                  className="space-y-4"
                >
                  <h2 className="text-lg font-bold text-foreground">患者の動き</h2>
                  {renderPatientTimelinePanel()}
                </div>
              </TabsContent>
            ) : null}

            {isDetailTabMounted('foundation') ? (
              <TabsContent value="foundation" keepMounted className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">正本・在宅運用</h2>
                <PatientFoundationPanelMemo patient={patient} />
                <PatientProfilePanelMemo patient={patient} />
                <div id="patient-contacts">
                  <PatientContactsPanelMemo
                    patientId={patient.id}
                    orgId={orgId}
                    initialContacts={patient.contacts}
                    initialExpectedUpdatedAt={patient.updated_at}
                  />
                </div>
              </TabsContent>
            ) : null}

            {isDetailTabMounted('sharing') ? (
              <TabsContent value="sharing" keepMounted className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">共有・文書</h2>
                <PatientShareCaseCreatePanelMemo patient={patient} orgId={orgId} />
                <PatientCardDocumentsPanelMemo patient={patient} orgId={orgId} />
                {renderHomeOperationsPanel(['documents', 'mcs'], 'patient-home-operations-sharing')}
              </TabsContent>
            ) : null}

            {isDetailTabMounted('billing') ? (
              <TabsContent value="billing" keepMounted className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">請求・会議</h2>
                {renderHomeOperationsPanel(['billing', 'conference'])}
              </TabsContent>
            ) : null}

            {isDetailTabMounted('history') ? (
              <TabsContent value="history" keepMounted className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">履歴・構造化</h2>
                {/* 変更履歴: 患者項目の業務差分(誰がいつ何を何から何へ・確認元) */}
                <SectionCard
                  id="patient-field-revisions"
                  aria-label="変更履歴"
                  data-testid="card-field-revisions"
                >
                  <h3 className="text-base font-semibold text-foreground">変更履歴</h3>
                  <div className="mt-3">
                    <PatientFieldRevisionTimeline patientId={patientId} />
                  </div>
                </SectionCard>

                {/* 在宅医療処置・麻薬: 構造化レイヤ(開始日・確認元の時系列。実施中行が無ければ非表示) */}
                <div id="patient-structured-care" data-testid="patient-structured-care">
                  <PatientStructuredCarePanel patientId={patientId} />
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
        </div>

        {/* 補助操作レール: 上部バーから開く右ドロワー(portal)。本文スペースは消費しない(SSOT 左ナビ・補助パネル) */}
        <WorkspaceActionRail
          nextAction={nextAction}
          blockedReasons={blockedReasons}
          blockedReasonsEmptyLabel="止まっている作業はありません"
          evidence={evidence}
          evidenceOpenLabel="開く"
        />
      </div>
    </div>
  );
}
