'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  MessageSquare,
  Eye,
  Brain,
  ClipboardList,
  User,
  CalendarCheck,
  FileDown,
  Clock,
  FileText,
  FileImage,
  Paperclip,
  MapPin,
  ArrowUpRight,
  ReceiptText,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { generateCareReportFromVisit } from '@/lib/reports/generate-from-visit-client';
import { OUTCOME_LABELS, OUTCOME_VARIANTS } from '@/lib/constants/visit';
import type { VisitGeoLog } from '@/lib/visit-location';
import {
  VisitReportReadinessPanel,
  type VisitReportReadinessItem,
} from '@/components/features/visits/visit-report-readiness-panel';
import {
  PatientCareTeamSourcePanel,
  type PatientCareTeamSourceContact,
} from '@/components/features/visits/patient-care-team-source-panel';
import {
  buildHomeVisit2026ReadinessItems,
  type HomeVisit2026BillingBlocker,
} from '@/lib/visits/home-visit-2026-evidence';
import type { VisitConferenceContext } from '@/components/features/visits/visit-medication-management-section';
import { VisitReflectedFieldsCard } from './visit-reflected-fields-card';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  buildPostVisitWorkflowActions,
  type VisitWorkflowAction,
} from '@/lib/visits/visit-workflow-projection';
import {
  canUseAutomaticReportGeneration,
  findDraftReportForType,
} from './visit-record-report-generation';
import { buildVisitRecordPdfHref } from '@/lib/visits/navigation';

type ResidualMedication = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  prescribed_quantity: number | null;
  remaining_quantity: number;
  excess_days: number | null;
  is_prohibited_reduction: boolean;
  is_reduction_target: boolean;
};

type VisitRecordFull = {
  id: string;
  schedule_id: string;
  patient_id: string;
  pharmacist_id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  structured_soap: StructuredSoap | null;
  receipt_person_name: string | null;
  receipt_person_relation: string | null;
  receipt_at: string | null;
  next_visit_suggestion_date: string | null;
  cancellation_reason: string | null;
  postpone_reason: string | null;
  revisit_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  pharmacist_name: string | null;
  last_modified_by_id: string | null;
  last_modified_by_name: string | null;
  attachments: Array<{
    file_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string | null;
    kind: 'photo' | 'attachment';
  }>;
  visit_geo_log: VisitGeoLog | null;
  schedule: {
    id: string;
    case_id: string;
    site_id: string | null;
    pharmacist_id: string;
    visit_type: string;
    scheduled_date: string;
    recurrence_rule: string | null;
    time_window_start: string | null;
    time_window_end: string | null;
  } | null;
};

type VisitPreparationSnapshot = {
  data: {
    pack: {
      care_team: PatientCareTeamSourceContact[];
      billing_blockers: HomeVisit2026BillingBlocker[];
      conference_context?: VisitConferenceContext[];
      intake_context?: {
        initial_transition_management_expected?: boolean | null;
      };
    };
  };
};

type CareReportSummary = {
  id: string;
  report_type: string;
  status: string;
  updated_at: string;
  latest_delivery_status?: string | null;
  latest_delivery_recipient_name?: string | null;
};

type CareReportsResponse = {
  data?: CareReportSummary[];
};

type BillingCandidateSummary = {
  id: string;
  patient_id: string;
  status: string;
};

type BillingCandidatesResponse = {
  data?: BillingCandidateSummary[];
};

const relationLabel: Record<string, string> = {
  self: '本人',
  spouse: '配偶者',
  child: '子',
  parent: '親',
  sibling: '兄弟姉妹',
  other_family: 'その他家族',
  caregiver: '介護者',
  facility_staff: '施設職員',
  other: 'その他',
};

function SoapSection({
  icon: Icon,
  label,
  colorClass,
  content,
}: {
  icon: React.ElementType;
  label: string;
  colorClass: string;
  content: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
          <Icon className={`size-4 ${colorClass}`} aria-hidden="true" />
          {label}
        </h3>
      </CardHeader>
      <CardContent>
        {content ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</p>
        ) : (
          <p className="text-sm text-muted-foreground">記録なし</p>
        )}
      </CardContent>
    </Card>
  );
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }

  return `${sizeBytes}B`;
}

function formatTimeWindow(value: string | null) {
  if (!value) return undefined;

  try {
    return format(parseISO(value), 'HH:mm', { locale: ja });
  } catch {
    return undefined;
  }
}

function formatBillingMonth(value: string | null | undefined) {
  if (!value) return null;

  try {
    const date = parseISO(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  } catch {
    return null;
  }
}

function formatGeoCoordinate(value: number) {
  return value.toFixed(5);
}

function GeoLocationCard({
  label,
  point,
}: {
  label: string;
  point: {
    latitude: number;
    longitude: number;
    captured_at: string;
    accuracy_meters: number | null;
  } | null;
}) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {point ? (
        <>
          <p className="mt-1 text-sm font-medium">
            {formatGeoCoordinate(point.latitude)}, {formatGeoCoordinate(point.longitude)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(parseISO(point.captured_at), 'yyyy/MM/dd HH:mm', {
              locale: ja,
            })}
            {point.accuracy_meters != null ? ` / 精度 ±${point.accuracy_meters}m` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">未記録</p>
      )}
    </div>
  );
}

const postVisitStatusLabel: Record<VisitWorkflowAction['status'], string> = {
  ready: '進行可',
  needs_review: '要確認',
  waiting: '未入力',
  blocked: 'ブロック',
};

const postVisitStatusClassName: Record<VisitWorkflowAction['status'], string> = {
  ready: 'border-state-done/30 bg-state-done/10 text-state-done',
  needs_review: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  waiting: 'border-state-readonly/30 bg-state-readonly/10 text-state-readonly',
  blocked: 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked',
};

function PostVisitWorkflowPanel({
  actions,
  renderActionButton,
}: {
  actions: VisitWorkflowAction[];
  renderActionButton: (
    action: VisitWorkflowAction,
    button: VisitWorkflowAction['primary_action'],
  ) => React.ReactNode;
}) {
  const primaryActions = actions.filter((action) => action.placement === 'primary');
  const secondaryActions = actions.filter((action) => action.placement !== 'primary');

  const renderAction = (action: VisitWorkflowAction) => (
    <article
      key={action.key}
      className="flex min-h-[190px] flex-col rounded-lg border border-border/70 bg-muted/10 p-3"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{action.title}</h3>
          <Badge
            variant="outline"
            className={`shrink-0 text-xs ${postVisitStatusClassName[action.status]}`}
          >
            {postVisitStatusLabel[action.status]}
          </Badge>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{action.description}</p>
      </div>

      {action.details && action.details.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {action.details.slice(0, 2).map((detail) => (
            <div
              key={`${action.key}-${detail.label}`}
              className="rounded-md bg-background px-2 py-1"
            >
              <dt className="text-xs text-muted-foreground">{detail.label}</dt>
              <dd className="mt-0.5 truncate text-xs font-medium text-foreground">
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {action.evidence.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {action.evidence.slice(0, 3).map((item) => (
            <span
              key={`${action.key}-${item}`}
              className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 pt-3">
        {renderActionButton(action, action.primary_action)}
        {action.secondary_action ? renderActionButton(action, action.secondary_action) : null}
      </div>
    </article>
  );

  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <h2 className="font-heading text-base leading-snug font-medium">訪問後ワークフロー</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          訪問記録から、報告・算定・次回訪問を直接起こし、送付や算定確定は専用画面で確認します。
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">{primaryActions.map(renderAction)}</div>
        <div className="grid gap-3 md:grid-cols-2">{secondaryActions.map(renderAction)}</div>
        <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
          この画面では送付・算定確定・除外は行いません。薬剤師が確認画面で判断できる状態までを整えます。
        </div>
      </CardContent>
    </Card>
  );
}

export function VisitRecordDetail({ recordId }: { recordId: string }) {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showReportMenu, setShowReportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowReportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const generateReportMutation = useMutation({
    mutationFn: async (input: {
      reportType?: string;
      visitRecordUpdatedAt: string;
      expectedReportUpdatedAt?: string;
    }) => {
      const data = await generateCareReportFromVisit({
        orgId,
        visitRecordId: recordId,
        expectedVisitRecordUpdatedAt: input.visitRecordUpdatedAt,
        reportType: input.reportType,
        expectedReportUpdatedAt: input.expectedReportUpdatedAt,
      });
      return { data };
    },
    onSuccess: (result) => {
      toast.success('報告書を生成しました');
      setShowReportMenu(false);
      queryClient.invalidateQueries({ queryKey: ['care-reports-by-visit', recordId, orgId] });
      const firstId = result.data?.[0]?.id;
      if (firstId) router.push(`/reports/${firstId}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setShowReportMenu(false);
    },
  });

  function handleGenerateReport(visitRecordUpdatedAt: string, reportType?: string) {
    // 報告書一覧の取得に失敗している間は下書きの有無が不確定なため、生成を実行しない
    // (重複/不正生成の防止)。メニューが開いたまま error に転じても発火させない。
    if (careReportsError) {
      setShowReportMenu(false);
      toast.error('報告書の取得に失敗しています。再読み込みしてから作成してください。');
      return;
    }
    const existingDraft = reportType ? findDraftReportForType(careReports, reportType) : null;
    generateReportMutation.mutate({
      reportType,
      visitRecordUpdatedAt,
      expectedReportUpdatedAt: existingDraft?.updated_at,
    });
  }

  const createNextVisitMutation = useMutation({
    mutationFn: async (payload: {
      case_id: string;
      site_id?: string;
      visit_type: string;
      scheduled_date: string;
      pharmacist_id: string;
      time_window_start?: string;
      time_window_end?: string;
      recurrence_rule?: string;
    }) => {
      const response = await fetch('/api/visit-schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message ?? '次回訪問予定の作成に失敗しました');
      }

      return json as { id: string };
    },
    onSuccess: (schedule) => {
      toast.success('次回訪問予定を作成しました');
      router.push(`/schedules?selected=${schedule.id}`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const {
    data: record,
    isLoading,
    isError: isRecordError,
    refetch: refetchRecord,
  } = useQuery<VisitRecordFull>({
    queryKey: ['visit-record', recordId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-records/${recordId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問記録の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!recordId,
  });
  const billingMonth = formatBillingMonth(record?.visit_date);

  const {
    data: careReportsResponse,
    isError: careReportsError,
    refetch: refetchCareReports,
  } = useQuery<CareReportsResponse>({
    queryKey: ['care-reports-by-visit', recordId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/care-reports?visit_record_id=${recordId}&limit=10`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!recordId,
  });

  const {
    data: billingCandidatesResponse,
    isError: billingCandidatesError,
    refetch: refetchBillingCandidates,
  } = useQuery<BillingCandidatesResponse>({
    queryKey: ['billing-candidates-by-visit', orgId, record?.patient_id, billingMonth],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (billingMonth) params.set('billing_month', billingMonth);
      if (record?.patient_id) params.set('patient_id', record.patient_id);
      params.set('limit', '20');
      const res = await fetch(`/api/billing-candidates?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('請求候補の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!record?.patient_id && !!billingMonth,
  });

  const generateBillingCandidatesMutation = useMutation({
    mutationFn: async () => {
      if (!billingMonth) throw new Error('対象月を判定できません');
      const res = await fetch('/api/billing-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ billing_month: billingMonth }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message ?? '請求候補の生成に失敗しました');
      }
      return json;
    },
    onSuccess: () => {
      toast.success('請求候補を生成しました');
      queryClient.invalidateQueries({
        queryKey: ['billing-candidates-by-visit', orgId, record?.patient_id, billingMonth],
      });
      queryClient.invalidateQueries({ queryKey: ['billing-candidates'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Residual medications query
  const {
    data: residuals,
    isError: residualsError,
    refetch: refetchResiduals,
  } = useQuery<ResidualMedication[]>({
    queryKey: ['residual-medications', recordId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/residual-medications?visit_record_id=${recordId}`, {
        headers: { 'x-org-id': orgId },
      });
      // 取得失敗を空配列に潰すと残薬ゼロ(=訪問準備の根拠なし)と区別できないため、
      // throw して isError を立て、利用側で「取得失敗」を明示する。
      if (!res.ok) throw new Error('残薬データの取得に失敗しました');
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!orgId && !!recordId,
  });
  const { data: visitPreparationSnapshot, isLoading: visitPreparationLoading } =
    useQuery<VisitPreparationSnapshot>({
      queryKey: ['visit-preparation-care-team', record?.schedule?.id, orgId],
      queryFn: async () => {
        const res = await fetch(`/api/visit-preparations/${record?.schedule?.id}`, {
          headers: { 'x-org-id': orgId },
        });
        if (!res.ok) throw new Error('訪問準備情報の取得に失敗しました');
        return res.json();
      },
      enabled: !!orgId && !!record?.schedule?.id,
    });

  if (isBootstrappingOrg || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (isRecordError) {
    // 取得失敗を「見つかりません」に潰さず、再試行導線つきの ErrorState を出す。
    return (
      <div className="py-12">
        <ErrorState
          variant="server"
          size="inline"
          title="訪問記録を読み込めませんでした"
          description="データの読み込みに失敗しました。時間をおいて再読み込みしてください。"
          action={{ label: '再読み込み', onClick: () => void refetchRecord() }}
        />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">訪問記録が見つかりません</p>
      </div>
    );
  }

  const visitDateFormatted = format(parseISO(record.visit_date), 'yyyy年MM月dd日', { locale: ja });
  const visitPreparationPack = visitPreparationSnapshot?.data.pack;
  const patientCareTeamContacts = visitPreparationPack?.care_team ?? [];
  const homeVisit2026ReadinessItems = buildHomeVisit2026ReadinessItems({
    structuredSoap: record.structured_soap,
    visitType: record.schedule?.visit_type,
    residualMedicationCount: residuals?.length ?? 0,
    billingBlockers: visitPreparationPack?.billing_blockers ?? [],
    intakeInitialTransitionExpected:
      visitPreparationPack?.intake_context?.initial_transition_management_expected ?? null,
  });
  const requiredHomeVisit2026Items = homeVisit2026ReadinessItems.filter((item) => item.required);
  const completedHomeVisit2026Count = requiredHomeVisit2026Items.filter((item) => item.done).length;
  const missingHomeVisit2026Items = requiredHomeVisit2026Items.filter((item) => !item.done);
  const careReports = careReportsResponse?.data ?? [];
  const billingCandidates = billingCandidatesResponse?.data ?? [];
  const billingCandidatesLoading = Boolean(
    orgId && record?.patient_id && billingMonth && !billingCandidatesResponse,
  );
  // 報告書/請求候補/残薬のいずれかが取得失敗の場合、それらから導出する件数・下書き有無・
  // 残薬準備状況は不正確になりうる。ワークフロー欄で「取得失敗」を明示し再読み込みを促す。
  const workflowDataError = careReportsError || billingCandidatesError || residualsError;
  const soapComplete = Boolean(
    record.soap_subjective?.trim() &&
    record.soap_objective?.trim() &&
    record.soap_assessment?.trim() &&
    record.soap_plan?.trim(),
  );
  const collaborationMentioned = Boolean(
    record.soap_plan?.includes('医師') ||
    record.soap_plan?.includes('ケアマネ') ||
    record.soap_plan?.includes('報告') ||
    record.soap_plan?.includes('連携'),
  );
  const visitDetailReadinessItems: VisitReportReadinessItem[] = [
    {
      key: 'soap',
      label: 'SOAP本文',
      description: 'S/O/A/P の本文が報告書生成の材料になります。',
      done: soapComplete,
    },
    {
      key: 'collaboration',
      label: '他職種へ送る論点',
      description: '医師・ケアマネへ渡す提案や連絡事項が P に含まれているか確認します。',
      done: collaborationMentioned,
    },
    {
      key: 'residuals',
      label: '残薬・減数調剤情報',
      description: '残薬がある場合は報告書と疑義照会の根拠になります。',
      done: Boolean((residuals?.length ?? 0) > 0),
      required: false,
    },
    {
      key: 'attachments',
      label: '添付・現地証跡',
      description: '写真、PDF、位置情報は薬局での報告書確認を補強します。',
      done: Boolean(
        record.attachments.length > 0 || record.visit_geo_log?.start || record.visit_geo_log?.end,
      ),
      required: false,
    },
    {
      key: 'medication_management',
      label: '訪問薬剤管理の確認',
      description:
        missingHomeVisit2026Items.length === 0
          ? '服薬状況、残薬、副作用、連携、該当時の加算根拠が揃っています。'
          : `不足: ${missingHomeVisit2026Items
              .slice(0, 4)
              .map((item) => item.label)
              .join(' / ')}`,
      done: completedHomeVisit2026Count === requiredHomeVisit2026Items.length,
      required: true,
    },
  ];
  const postVisitWorkflowActions = buildPostVisitWorkflowActions({
    recordId,
    scheduleId: record.schedule_id,
    patientId: record.patient_id,
    soapComplete,
    collaborationMentioned,
    medicationManagementComplete: completedHomeVisit2026Count === requiredHomeVisit2026Items.length,
    missingMedicationManagementLabels: missingHomeVisit2026Items.map((item) => item.label),
    billingBlockerCount: visitPreparationPack?.billing_blockers.length ?? 0,
    billingBlockers: visitPreparationPack?.billing_blockers ?? [],
    billingCandidateCount: billingCandidates.length,
    billingCandidatesLoading,
    billingCandidatesError,
    billingMonth,
    careTeamContactCount: patientCareTeamContacts.length,
    hasNextVisitSuggestion: Boolean(record.next_visit_suggestion_date),
    nextVisitSuggestionDate: record.next_visit_suggestion_date,
    reports: careReports,
    reportsError: careReportsError,
    conferenceContext: visitPreparationPack?.conference_context,
  });
  // 報告書の宛先別下書きを明示生成する選択肢。バックエンド(generate-from-visit)が
  // 受け付ける4宛先(主治医/ケアマネ/訪問看護/施設)をすべて提示する。
  const reportAudienceItems: Array<{ type: string; label: string }> = [
    { type: 'physician_report', label: '医師向け報告書を作成' },
    { type: 'care_manager_report', label: 'ケアマネ向け情報提供書を作成' },
    { type: 'nurse_share', label: '看護師向け共有メモを作成' },
    { type: 'facility_handoff', label: '施設向け引継書を作成' },
  ];
  // 取得失敗時は careReports=[] が「下書きゼロ」と区別できず自動生成を誤提示するため出さない。
  const showAutomaticReportGeneration =
    !careReportsError && canUseAutomaticReportGeneration(careReports);
  const reportGenerationActions = (
    <div className="relative" ref={menuRef}>
      <Button
        size="sm"
        className="h-10 w-full gap-1 sm:h-8 sm:w-auto"
        onClick={() => setShowReportMenu((v) => !v)}
        disabled={generateReportMutation.isPending}
        aria-haspopup="menu"
        aria-expanded={showReportMenu}
      >
        <FileText className="size-3.5" aria-hidden="true" />
        {generateReportMutation.isPending ? '生成中...' : '報告書生成'}
      </Button>
      {showReportMenu && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-popover shadow-md"
        >
          {reportAudienceItems.map((item) => (
            <button
              key={item.type}
              role="menuitem"
              className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
              onClick={() => handleGenerateReport(record.updated_at, item.type)}
            >
              {item.label}
            </button>
          ))}
          {showAutomaticReportGeneration ? (
            <>
              <div className="border-t border-border" />
              <button
                role="menuitem"
                className="w-full px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={() => handleGenerateReport(record.updated_at)}
              >
                自動判定（保険種別に応じて生成）
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );

  function createNextVisitFromSuggestion() {
    const currentRecord = record;
    if (!currentRecord?.schedule || !currentRecord.next_visit_suggestion_date) return;

    createNextVisitMutation.mutate({
      case_id: currentRecord.schedule.case_id,
      site_id: currentRecord.schedule.site_id ?? undefined,
      visit_type: currentRecord.schedule.visit_type,
      scheduled_date: currentRecord.next_visit_suggestion_date,
      pharmacist_id: currentRecord.schedule.pharmacist_id,
      time_window_start: formatTimeWindow(currentRecord.schedule.time_window_start) ?? undefined,
      time_window_end: formatTimeWindow(currentRecord.schedule.time_window_end) ?? undefined,
      recurrence_rule: currentRecord.schedule.recurrence_rule ?? undefined,
    });
  }

  function renderWorkflowActionButton(
    action: VisitWorkflowAction,
    button: VisitWorkflowAction['primary_action'],
  ) {
    const variant = button.variant ?? (action.placement === 'primary' ? 'default' : 'outline');
    const className = 'min-h-9 w-full justify-center gap-1';

    if (button.operation === 'generate_report') {
      return reportGenerationActions;
    }

    if (button.operation === 'generate_billing_candidates') {
      return (
        <Button
          size="sm"
          variant={variant}
          className={className}
          disabled={!billingMonth || generateBillingCandidatesMutation.isPending}
          onClick={() => generateBillingCandidatesMutation.mutate()}
        >
          <ReceiptText className="size-3.5" aria-hidden="true" />
          {generateBillingCandidatesMutation.isPending ? '生成中...' : button.label}
        </Button>
      );
    }

    if (button.operation === 'create_next_visit') {
      return (
        <Button
          size="sm"
          variant={variant}
          className={className}
          disabled={
            !record?.schedule ||
            !record?.next_visit_suggestion_date ||
            createNextVisitMutation.isPending
          }
          onClick={createNextVisitFromSuggestion}
        >
          <CalendarCheck className="size-3.5" aria-hidden="true" />
          {createNextVisitMutation.isPending ? '作成中...' : button.label}
        </Button>
      );
    }

    if (!button.href) return null;

    const Icon =
      button.operation === 'open_report' || button.operation === 'edit_visit_record'
        ? FileText
        : button.operation === 'review_share' || button.operation === 'open_conference'
          ? UsersRound
          : button.operation === 'open_billing_candidates' ||
              button.operation === 'review_billing_blockers'
            ? ReceiptText
            : ArrowUpRight;

    return (
      <Link
        href={button.href}
        className={buttonVariants({
          variant,
          size: 'sm',
          className,
        })}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {button.label}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  訪問サマリー
                </p>
                <p className="mt-1 text-xl font-bold tracking-tight text-foreground">
                  {visitDateFormatted} 訪問記録
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={OUTCOME_VARIANTS[record.outcome_status] ?? 'outline'}>
                  {OUTCOME_LABELS[record.outcome_status] ?? record.outcome_status}
                </Badge>
                {record.schedule ? (
                  <Badge variant="outline">{record.schedule.visit_type}</Badge>
                ) : null}
                <Badge variant="outline">v{record.version}</Badge>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={buildVisitRecordPdfHref(recordId)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'h-10 w-full gap-1 sm:h-8 sm:w-auto',
                })}
                aria-label="訪問記録 PDF を開く"
              >
                <FileDown className="size-3.5" aria-hidden="true" />
                PDF出力
              </Link>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                作成: {format(parseISO(record.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
              </span>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                最終更新: {format(parseISO(record.updated_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
              </span>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              記録者: {record.pharmacist_name ?? record.pharmacist_id}
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:col-span-2 xl:col-span-2">
              最終更新者:{' '}
              {record.last_modified_by_name ??
                record.last_modified_by_id ??
                record.pharmacist_name ??
                record.pharmacist_id}
            </div>
          </div>
        </CardHeader>
      </Card>

      <VisitReportReadinessPanel mode="visit_detail" items={visitDetailReadinessItems} />

      {workflowDataError ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-3 text-sm text-state-confirm"
        >
          <p className="min-w-0 flex-1 leading-6">
            報告書・請求候補・残薬データの一部を取得できませんでした。表示中の件数や下書きの有無、残薬の準備状況が不正確な可能性があります。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] border-state-confirm/40 bg-card text-state-confirm hover:bg-state-confirm/15 sm:min-h-9"
            onClick={() => {
              void refetchCareReports();
              void refetchBillingCandidates();
              void refetchResiduals();
            }}
          >
            再読み込み
          </Button>
        </div>
      ) : null}

      <PostVisitWorkflowPanel
        actions={postVisitWorkflowActions}
        renderActionButton={renderWorkflowActionButton}
      />

      {!visitPreparationLoading ? (
        <PatientCareTeamSourcePanel contacts={patientCareTeamContacts} compact />
      ) : null}

      {/* Reason fields */}
      {record.cancellation_reason && (
        <div className="rounded-lg border-l-4 border-border/70 border-l-state-blocked bg-card p-3">
          <p className="text-xs font-medium text-state-blocked">キャンセル理由</p>
          <p className="mt-1 text-sm">{record.cancellation_reason}</p>
        </div>
      )}
      {record.postpone_reason && (
        <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-3">
          <p className="text-xs font-medium text-state-confirm">延期理由</p>
          <p className="mt-1 text-sm">{record.postpone_reason}</p>
        </div>
      )}
      {record.revisit_reason && (
        <div className="rounded-lg border-l-4 border-border/70 border-l-tag-info bg-card p-3">
          <p className="text-xs font-medium text-tag-info">再訪理由</p>
          <p className="mt-1 text-sm">{record.revisit_reason}</p>
        </div>
      )}

      {/* SOAP — 2-column on tablet */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <SoapSection
            icon={MessageSquare}
            label="S — 主観情報"
            colorClass="text-blue-500"
            content={record.soap_subjective}
          />
          <SoapSection
            icon={Eye}
            label="O — 客観情報"
            colorClass="text-green-500"
            content={record.soap_objective}
          />
        </div>
        <div className="space-y-4">
          <SoapSection
            icon={Brain}
            label="A — 薬学的評価"
            colorClass="text-purple-500"
            content={record.soap_assessment}
          />
          <SoapSection
            icon={ClipboardList}
            label="P — 計画・介入"
            colorClass="text-orange-500"
            content={record.soap_plan}
          />
        </div>
      </div>

      {/* Receipt record */}
      <Card>
        <CardHeader className="pb-2">
          <h2 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
            <User className="size-4 text-muted-foreground" aria-hidden="true" />
            受領記録
          </h2>
        </CardHeader>
        <CardContent>
          {record.receipt_person_name ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">受領者名</dt>
                <dd className="mt-0.5 font-medium">{record.receipt_person_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">続柄</dt>
                <dd className="mt-0.5">
                  {record.receipt_person_relation
                    ? (relationLabel[record.receipt_person_relation] ??
                      record.receipt_person_relation)
                    : '—'}
                </dd>
              </div>
              {record.receipt_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">受領日時</dt>
                  <dd className="mt-0.5">
                    {format(parseISO(record.receipt_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">受領記録なし</p>
          )}
        </CardContent>
      </Card>

      {record.visit_geo_log?.enabled && (
        <Card>
          <CardHeader className="pb-2">
            <h2 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
              <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
              訪問位置情報
            </h2>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <GeoLocationCard label="開始位置" point={record.visit_geo_log.start ?? null} />
              <GeoLocationCard label="終了位置" point={record.visit_geo_log.end ?? null} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              権限状態: {record.visit_geo_log.permission}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ⑤ 反映 provenance(訪問側): この訪問から患者詳細へ反映した項目。反映が無ければ非表示 */}
      <VisitReflectedFieldsCard recordId={recordId} />

      <Card>
        <CardHeader className="pb-2">
          <h2 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
            <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
            写真・添付
          </h2>
        </CardHeader>
        <CardContent>
          {record.attachments.length > 0 ? (
            <ul className="space-y-2">
              {record.attachments.map((attachment) => {
                const Icon = attachment.kind === 'photo' ? FileImage : FileText;

                return (
                  <li
                    key={attachment.file_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate text-sm font-medium text-foreground">
                          {attachment.file_name}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{attachment.mime_type}</span>
                        <span>{formatFileSize(attachment.size_bytes)}</span>
                        {attachment.uploaded_at ? (
                          <span>
                            {format(parseISO(attachment.uploaded_at), 'yyyy/MM/dd HH:mm', {
                              locale: ja,
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Link
                      href={`/api/files/${attachment.file_id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'gap-1',
                      })}
                    >
                      <FileDown className="size-3.5" aria-hidden="true" />
                      開く
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">添付ファイルはありません</p>
          )}
        </CardContent>
      </Card>

      {/* Residual medications */}
      {residuals && residuals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h2 className="font-heading text-sm leading-snug font-medium">残薬記録</h2>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">残薬一覧</caption>
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                      薬剤名
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      処方量
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      残数
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      余剰日数
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                      区分
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {residuals.map((med, i) => (
                    <tr
                      key={med.id}
                      className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-muted/20' : ''}`}
                    >
                      <td className="px-3 py-2">{med.drug_name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {med.prescribed_quantity ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{med.remaining_quantity}</td>
                      <td className="px-3 py-2 text-right">
                        {med.excess_days !== null ? `${med.excess_days}日` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {med.is_prohibited_reduction && (
                            <Badge variant="destructive" className="text-xs">
                              減数禁止
                            </Badge>
                          )}
                          {med.is_reduction_target && !med.is_prohibited_reduction && (
                            <Badge
                              variant="outline"
                              className="text-xs text-state-confirm border-state-confirm/30"
                            >
                              減数対象
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
