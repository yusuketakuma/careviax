'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInYears, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HomeCareFeatureBoard } from '@/components/home-care/home-care-feature-board';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import { CasesTab } from './cases-tab';
import { ManagementPlanPanel } from './management-plan-panel';
import { MedicationsContent } from './medications/medications-content';
import { PatientCareTeamPanel } from './patient-care-team-panel';
import { PatientConditionsCard } from './patient-conditions-card';
import { PatientIntakeSummaryCard } from './patient-intake-summary-card';
import { PatientContactsPanel } from './patient-contacts-panel';
import { PatientMasterCard } from './patient-master-card';
import { PatientPackagingCard } from './patient-packaging-card';
import { deriveStatusFromPatient, selectNextVisit } from './patient-detail-helpers';
import { fetchPatientVisitRecordsWindow } from './patient-visit-records.helpers';
import { PrescriptionHistoryContent } from './prescriptions/prescription-history-content';
import { ExternalShareContent } from './share/external-share-content';
import { VisitConstraintsCard } from './visit-constraints-card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import type { HomeCareFeatureSummary } from '@/types/home-care';
import type { VisitBrief } from '@/types/visit-brief';
import {
  CalendarPlus,
  CirclePause,
  Clock,
  ClipboardPlus,
  FileDown,
  FileQuestion,
  FileWarning,
  Hospital,
  LogOut,
  PhoneOff,
  Printer,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import { toast } from 'sonner';

type Patient = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
  phone: string | null;
  medical_insurance_number: string | null;
  care_insurance_number: string | null;
  allergy_info: string[] | null;
  notes: string | null;
  residences: Array<{
    id: string;
    address: string;
    building_id: string | null;
    facility_id: string | null;
    unit_name: string | null;
    is_primary: boolean;
  }>;
  contacts: Array<{
    id: string;
    relation:
      | 'self'
      | 'spouse'
      | 'child'
      | 'parent'
      | 'sibling'
      | 'care_manager'
      | 'physician'
      | 'nurse'
      | 'facility_staff'
      | 'other';
    name: string;
    phone: string | null;
    email: string | null;
    fax: string | null;
    organization_name: string | null;
    department: string | null;
    address: string | null;
    is_primary: boolean;
    is_emergency_contact: boolean;
    notes: string | null;
  }>;
  conditions: Array<{
    id: string;
    condition_type: 'disease' | 'problem';
    name: string;
    is_primary: boolean;
    is_active: boolean;
    noted_at: string | null;
    notes: string | null;
  }>;
  cases: Array<{
    id: string;
    status: string;
    primary_pharmacist_id: string | null;
    referral_source: string | null;
    referral_date: string | null;
    start_date: string | null;
    end_date: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    required_visit_support: Record<string, unknown> | null;
    care_team_links: Array<{
      id: string;
      external_professional_id?: string | null;
      role: string;
      name: string;
      organization_name: string | null;
      department: string | null;
      phone: string | null;
      email: string | null;
      fax: string | null;
      address: string | null;
      is_primary: boolean;
      notes: string | null;
    }>;
  }>;
  first_visit_documents: Array<{
    id: string;
    case_id: string;
    emergency_contacts: Array<{
      id?: string;
      name: string;
      relation: string | null;
      phone: string | null;
      email: string | null;
      fax: string | null;
      organization_name: string | null;
      department: string | null;
      is_primary: boolean;
      is_emergency_contact: boolean;
    }>;
    document_url: string | null;
    delivered_at: string | null;
    delivered_to: string | null;
    created_at: string;
    updated_at: string;
  }>;
  current_medications: Array<{
    id: string;
    drug_name: string;
  }>;
  visit_schedules: Array<{
    id: string;
    scheduled_date: string;
    schedule_status: string;
    priority: string;
    confirmed_at: string | null;
    route_order: number | null;
    visit_record: {
      id: string;
      outcome_status: string;
    } | null;
  }>;
  monthly_visit_count: number;
  visit_records: Array<{
    id: string;
    schedule_id: string | null;
    visit_date: string | null;
    outcome_status: string;
    next_visit_suggestion_date: string | null;
    cancellation_reason: string | null;
    postpone_reason: string | null;
    revisit_reason: string | null;
    created_at: string;
  }>;
  self_reports: Array<{
    id: string;
    subject: string;
    category: string;
    content: string;
    relation: string | null;
    status: string;
    reported_by_name: string;
    requested_callback: boolean;
    preferred_contact_time: string | null;
    created_at: string;
  }>;
  external_shares: Array<{
    id: string;
    granted_to_name: string;
    expires_at: string;
    accessed_at: string | null;
  }>;
  open_tasks: Array<{
    id: string;
    task_type: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    sla_due_at: string | null;
    created_at: string;
  }>;
  medication_issues: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    category: string | null;
    identified_at: string;
  }>;
  communication_queue: {
    summary: {
      pending_count: number;
      overdue_count: number;
      self_reports: number;
      callback_followups: number;
      open_requests: number;
      delivery_backlog: number;
      expiring_external_shares: number;
      unconfirmed_count: number;
      reply_waiting_count: number;
      failed_count: number;
    };
    items: Array<{
      id: string;
      queue_type: string;
      title: string;
      summary: string;
      channel: string;
      status: string;
      priority: 'urgent' | 'high' | 'normal';
      patient_name: string | null;
      due_at: string | null;
      action_href: string;
      action_label: string;
    }>;
    timeline: Array<{
      id: string;
      source_type: 'care_report' | 'tracing_report' | 'communication_request' | 'delivery_record';
      patient_name: string | null;
      title: string;
      summary: string;
      status: string;
      occurred_at: string | null;
      action_href: string;
      action_label: string;
    }>;
    emergency_drafts: Array<{
      id: string;
      patient_id: string;
      template_key: string;
      request_type: string;
      target_name: string | null;
      target_role: string;
      title: string;
      summary: string;
      subject: string;
      content: string;
      action_href: string;
      action_label: string;
    }>;
  };
  risk_summary: {
    patient_id: string;
    patient_name: string;
    score: number;
    level: 'stable' | 'watch' | 'high';
    reasons: string[];
    unresolved_self_reports: number;
    open_issues: number;
    disrupted_visits_30d: number;
    pending_reports: number;
    open_tasks: number;
    missing_visit_consent: boolean;
    missing_management_plan: boolean;
  } | null;
  home_care_feature_summary: HomeCareFeatureSummary;
  visit_brief: VisitBrief;
  billing_summary: {
    claimable_count: number;
    blocked_count: number;
    evidence: Array<{
      id: string;
      billing_month: string | null;
      claimable: boolean;
      exclusion_reason: string | null;
      validation_notes: string | null;
      blockers: Array<{
        key: string;
        reason: string;
        action_href: string;
        action_label: string;
        severity: 'urgent' | 'high' | 'normal';
      }>;
    }>;
    candidates: Array<{
      id: string;
      billing_month: string;
      billing_code: string;
      billing_name: string;
      points: number | null;
      status: string;
      exclusion_reason: string | null;
    }>;
  };
  timeline_events: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
    title: string;
    summary: string | null;
    href: string;
  }>;
};

interface PatientDetailTabsProps {
  patientId: string;
}

const PATIENT_DETAIL_TABS = [
  { value: 'basic', label: '基本情報', description: '患者マスタ、保険、リスク、訪問条件' },
  { value: 'cases', label: 'ケース', description: 'ケース進行、担当、紹介情報' },
  { value: 'prescriptions', label: '処方履歴', description: '前回比較と薬剤ライン差分' },
  { value: 'medications', label: '薬剤', description: '服薬一覧、残薬、管理状況' },
  { value: 'visits', label: '訪問', description: '予定、記録、月次実績' },
  { value: 'communications', label: '連携', description: '連絡キュー、課題、請求ブロッカー' },
  { value: 'documents', label: '文書', description: '計画書、共有、PDF 導線' },
  { value: 'timeline', label: 'タイムライン', description: '自己申告、共有、統合イベント' },
] as const;

const CONTACT_RELATION_LABELS: Record<string, string> = {
  self: '本人',
  spouse: '配偶者',
  child: '子',
  parent: '親',
  sibling: '兄弟姉妹',
  care_manager: 'ケアマネ',
  physician: '医師',
  nurse: '看護師',
  facility_staff: '施設職員',
  other: 'その他',
};

type PatientDetailTabValue = (typeof PATIENT_DETAIL_TABS)[number]['value'];

const STATUS_ICONS = {
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

export function PatientDetailTabs({ patientId }: PatientDetailTabsProps) {
  const orgId = useOrgId();
  const [activeTab, setActiveTab] = useState<PatientDetailTabValue>('basic');
  const isBootstrappingOrg = !orgId;

  const {
    data: patient,
    isLoading,
    error,
  } = useQuery<Patient>({
    queryKey: ['patient', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者情報の取得に失敗しました');
      return res.json();
    },
    enabled: !isBootstrappingOrg,
  });

  if (isBootstrappingOrg || isLoading) return <Loading />;
  if (error || !patient) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="患者が見つかりません"
        description="指定された患者情報を取得できませんでした"
      />
    );
  }

  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;
  const nextVisit = selectNextVisit(patient.visit_schedules);
  const age = differenceInYears(new Date(), new Date(patient.birth_date));
  const activeTabMeta =
    PATIENT_DETAIL_TABS.find((tab) => tab.value === activeTab) ?? PATIENT_DETAIL_TABS[0];
  const activeCase =
    patient.cases.find((item) => item.status === 'active') ?? patient.cases[0] ?? null;
  const prescriptionIntakeHref = activeCase
    ? `/prescriptions/new?patient_id=${patient.id}&case_id=${activeCase.id}`
    : `/prescriptions/new?patient_id=${patient.id}`;
  const patientStatusKey = deriveStatusFromPatient(patient);
  const patientStatusConfig = STATUS_ICON_CONFIG[patientStatusKey];
  const PatientStatusIconComponent = STATUS_ICONS[patientStatusKey];

  return (
    <div className="space-y-6">
      {/* Patient header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{patient.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{patient.name_kana}</p>
        </div>
        <Link
          href={prescriptionIntakeHref}
          className={buttonVariants({ size: 'sm' })}
        >
          <ClipboardPlus className="mr-1.5 size-4" aria-hidden="true" />
          処方受付
        </Link>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PatientDetailTabValue)}>
        <div className="space-y-4 md:hidden">
          <VisitBriefCard
            brief={patient.visit_brief}
            title="患者サマリー"
            description="処方変更、調剤方法、他職種共有、未解決事項を1画面に要約しています。"
          />
          <TabsList variant="line" className="w-full overflow-x-auto">
            {PATIENT_DETAIL_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="md:grid md:grid-cols-[320px_minmax(0,1fr)] md:items-start md:gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="hidden space-y-4 md:sticky md:top-6 md:block">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">患者ハブ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 shrink-0 rounded-full p-1.5 ${patientStatusConfig.color} ${patientStatusConfig.bg}`}
                      title={patientStatusConfig.label}
                    >
                      <PatientStatusIconComponent className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[10px] ${patientStatusConfig.color} border-current`}
                        >
                          {patientStatusConfig.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {patient.name_kana} / {age}歳 / {patient.gender}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">主住所</p>
                    <p className="mt-1 leading-5 text-foreground">
                      {primaryResidence?.address ?? '未登録'}
                    </p>
                    {primaryResidence?.unit_name ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        部屋番号 {primaryResidence.unit_name}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">次回訪問</p>
                    <p className="mt-1 font-medium text-foreground">
                      {nextVisit
                        ? format(new Date(nextVisit.scheduled_date), 'M/d HH:mm', { locale: ja })
                        : '未設定'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">連絡キュー</p>
                    <p className="mt-1 font-medium text-foreground">
                      {patient.communication_queue.summary.pending_count}件
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">未完了タスク</p>
                    <p className="mt-1 font-medium text-foreground">{patient.open_tasks.length}件</p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">ステータス</p>
                    <p
                      className={`mt-1 inline-flex items-center gap-1 font-medium ${patientStatusConfig.color}`}
                    >
                      <PatientStatusIconComponent className="size-3.5" aria-hidden="true" />
                      {patientStatusConfig.label}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {patient.medical_insurance_number ? <Badge variant="outline">医療保険</Badge> : null}
                  {patient.care_insurance_number ? <Badge variant="outline">介護保険</Badge> : null}
                  {patient.communication_queue.summary.overdue_count > 0 ? (
                    <Badge variant="destructive">
                      期限超過 {patient.communication_queue.summary.overdue_count}
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">詳細セクション</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {PATIENT_DETAIL_TABS.map((tab) => {
                  const isActive = activeTab === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActiveTab(tab.value)}
                      className={`flex min-h-11 w-full items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-primary/30 bg-primary/5 text-foreground'
                          : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <span className="space-y-1">
                        <span className="block text-sm font-medium">{tab.label}</span>
                        <span className="block text-xs leading-5">{tab.description}</span>
                      </span>
                      {isActive ? <Badge variant="outline">表示中</Badge> : null}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <div className="hidden rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 md:block">
              <p className="text-sm font-medium text-foreground">{activeTabMeta.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{activeTabMeta.description}</p>
            </div>

            <div className="hidden md:block">
              <VisitBriefCard
                brief={patient.visit_brief}
                title="患者サマリー"
                description="処方変更、調剤方法、他職種共有、未解決事項を1画面に要約しています。"
              />
            </div>

            {/* 基本情報タブ */}
            <TabsContent value="basic">
              <div className="grid gap-4 lg:grid-cols-2">
                <PatientIntakeSummaryCard patient={patient} />
                <PatientMasterCard patient={patient} orgId={orgId} />
                <PatientRiskCard riskSummary={patient.risk_summary} />
                <PatientPackagingCard patientId={patient.id} orgId={orgId} />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">保険情報</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-3 text-sm">
                      <DetailRow label="医療保険番号" value={patient.medical_insurance_number ?? '—'} />
                      <DetailRow label="介護保険番号" value={patient.care_insurance_number ?? '—'} />
                    </dl>
                  </CardContent>
                </Card>

                <PatientConditionsCard
                  patientId={patient.id}
                  orgId={orgId}
                  initialConditions={patient.conditions}
                />

                <div className="lg:col-span-2">
                  <VisitConstraintsCard patientId={patient.id} orgId={orgId} />
                </div>
              </div>
            </TabsContent>

            {/* ケースタブ */}
            <TabsContent value="cases">
              <CasesTab patient={patient} orgId={orgId} />
            </TabsContent>

            {/* 処方履歴タブ */}
            <TabsContent value="prescriptions">
              <PrescriptionHistoryContent />
            </TabsContent>

            {/* プレースホルダータブ群 */}
            <TabsContent value="medications">
              <MedicationsContent
                patientId={patient.id}
                patientName={patient.name}
                patientNameKana={patient.name_kana}
                birthDate={patient.birth_date}
                gender={patient.gender}
                allergyInfo={patient.allergy_info}
              />
            </TabsContent>
            <TabsContent value="visits">
              <div className="space-y-4">
                <HomeCareFeatureBoard
                  summary={patient.home_care_feature_summary}
                  title="訪問支援サマリー"
                  description="この患者で優先して整備・確認すべき訪問支援項目を一覧化しています。"
                  compact
                />
                <PatientVisitsTab
                  patientId={patient.id}
                  medicalInsuranceNumber={patient.medical_insurance_number}
                  careInsuranceNumber={patient.care_insurance_number}
                  monthlyVisitCount={patient.monthly_visit_count}
                  visitSchedules={patient.visit_schedules}
                  visitRecords={patient.visit_records}
                />
              </div>
            </TabsContent>
            <TabsContent value="communications">
              <div className="grid gap-4 lg:grid-cols-2">
                <PatientContactsPanel
                  patientId={patient.id}
                  orgId={orgId}
                  initialContacts={patient.contacts}
                />
                <PatientCareTeamPanel patientId={patient.id} orgId={orgId} cases={patient.cases} />
                <CommunicationQueueCard queue={patient.communication_queue} orgId={orgId} patientId={patient.id} />
                <TaskAndIssueCard
                  tasks={patient.open_tasks}
                  issues={patient.medication_issues}
                  billingSummary={patient.billing_summary}
                />
              </div>
            </TabsContent>
            <TabsContent value="documents">
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <ManagementPlanPanel
                  patientId={patient.id}
                  patientName={patient.name}
                  cases={patient.cases}
                  orgId={orgId}
                />
                <ExternalShareContent patientId={patient.id} />
                <div className="xl:col-span-2">
                  <FirstVisitDocumentsPanel
                    cases={patient.cases}
                    documents={patient.first_visit_documents}
                  />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="timeline">
              <PatientTimelineTab
                timelineEvents={patient.timeline_events}
                selfReports={patient.self_reports}
                externalShares={patient.external_shares}
              />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function FirstVisitDocumentsPanel({
  cases,
  documents,
}: {
  cases: Patient['cases'];
  documents: Patient['first_visit_documents'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">初回訪問文書・交付記録</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title="初回訪問文書はまだありません"
            description="初回訪問の完了後に、緊急連絡先と交付記録を含む文書が自動作成されます。"
          />
        ) : (
          <div className="space-y-4">
            {documents.map((document) => {
              const careCase = cases.find((item) => item.id === document.case_id) ?? null;

              return (
                <div
                  key={document.id}
                  className="rounded-2xl border border-border/70 bg-muted/10 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">初回訪問文書</p>
                        <Badge variant="outline">
                          ケース {careCase ? careCase.status : document.case_id}
                        </Badge>
                        {document.delivered_at ? (
                          <Badge>交付記録あり</Badge>
                        ) : (
                          <Badge variant="secondary">交付未記録</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        作成日時 {format(new Date(document.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        交付先 {document.delivered_to ?? '未記録'} / 交付日時{' '}
                        {document.delivered_at
                          ? format(new Date(document.delivered_at), 'yyyy/MM/dd HH:mm', {
                              locale: ja,
                            })
                          : '未記録'}
                      </p>
                    </div>

                    {document.document_url ? (
                      <Link
                        href={document.document_url}
                        target="_blank"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <FileDown className="mr-1.5 size-4" aria-hidden="true" />
                        PDF
                      </Link>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">緊急連絡先</p>
                    {document.emergency_contacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        緊急連絡先は文書作成時点で未登録でした。
                      </p>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {document.emergency_contacts.map((contact) => (
                          <div
                            key={contact.id ?? `${document.id}-${contact.name}`}
                            className="rounded-xl border border-border/60 bg-background p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{contact.name}</p>
                              <Badge variant="outline">
                                {CONTACT_RELATION_LABELS[contact.relation ?? ''] ??
                                  contact.relation ??
                                  '連絡先'}
                              </Badge>
                              {contact.is_primary ? <Badge variant="secondary">主</Badge> : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contact.organization_name ?? '所属未登録'}
                              {contact.department ? ` / ${contact.department}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contact.phone ?? contact.email ?? contact.fax ?? '連絡先未登録'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PatientVisitsTab({
  patientId,
  medicalInsuranceNumber,
  careInsuranceNumber,
  monthlyVisitCount,
  visitSchedules,
  visitRecords,
}: {
  patientId: string;
  medicalInsuranceNumber: string | null;
  careInsuranceNumber: string | null;
  monthlyVisitCount: number;
  visitSchedules: Patient['visit_schedules'];
  visitRecords: Patient['visit_records'];
}) {
  const orgId = useOrgId();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const visitRecordQuery = useQuery<{ data: Patient['visit_records'] }>({
    queryKey: ['patient-visit-records', patientId, orgId, dateFrom, dateTo],
    enabled: Boolean(patientId && orgId),
    ...(hasDateFilter ? {} : { initialData: { data: visitRecords } }),
    queryFn: async () => {
      const data = await fetchPatientVisitRecordsWindow<Patient['visit_records'][number]>({
        orgId,
        patientId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      return { data };
    },
  });

  const visibleVisitRecords = visitRecordQuery.data?.data ?? [];
  const exportQuery = new URLSearchParams();
  if (dateFrom) exportQuery.set('date_from', dateFrom);
  if (dateTo) exportQuery.set('date_to', dateTo);
  const exportHref = `/api/patients/${patientId}/visit-records/pdf${exportQuery.size > 0 ? `?${exportQuery.toString()}` : ''}`;
  const printHref = `/patients/${patientId}/visit-records/print${dateFrom || dateTo ? `?${new URLSearchParams({
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }).toString()}` : ''}`;
  const monthlyCountBadges = [
    ...(medicalInsuranceNumber
      ? [{ label: '医療', limit: 4 }]
      : []),
    ...(careInsuranceNumber
      ? [{ label: '介護', limit: 2 }]
      : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">直近の訪問予定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {monthlyCountBadges.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {monthlyCountBadges.map((badge) => (
                <Badge
                  key={badge.label}
                  variant={monthlyVisitCount > badge.limit ? 'destructive' : 'outline'}
                >
                  今月 {badge.label} {monthlyVisitCount}/{badge.limit} 回
                </Badge>
              ))}
            </div>
          ) : null}
          {visitSchedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">訪問予定はありません</p>
          ) : (
            visitSchedules.map((item) => (
              <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {format(new Date(item.scheduled_date), 'yyyy年M月d日(E)', { locale: ja })}
                    </p>
                    <p className="text-muted-foreground">
                      状態: {item.schedule_status}
                      {item.route_order ? ` / ルート順 ${item.route_order}` : ''}
                    </p>
                  </div>
                  <Badge variant={item.confirmed_at ? 'default' : 'outline'}>
                    {item.confirmed_at ? '確定済み' : '未確定'}
                  </Badge>
                </div>
                {item.visit_record ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    記録: {item.visit_record.outcome_status}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="text-base">訪問記録</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Link
                href={exportHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <FileDown className="mr-1.5 size-3.5" aria-hidden="true" />
                PDF
              </Link>
              <Link href={printHref} target="_blank" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                印刷
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="patient-visit-date-from" className="text-xs">開始日</Label>
              <Input
                id="patient-visit-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-8 w-40 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="patient-visit-date-to" className="text-xs">終了日</Label>
              <Input
                id="patient-visit-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-8 w-40 text-sm"
              />
            </div>
          </div>
          {visitRecordQuery.isLoading ? (
            <Loading label="訪問記録を読み込み中..." />
          ) : visibleVisitRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground">訪問記録はありません</p>
          ) : (
            visibleVisitRecords.map((item) => (
              <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/visits/${item.id}`} className="font-medium text-primary hover:underline">
                      {format(new Date(item.visit_date ?? item.created_at), 'yyyy年M月d日(E)', { locale: ja })}
                    </Link>
                    <p className="text-muted-foreground">結果: {item.outcome_status}</p>
                  </div>
                  {item.next_visit_suggestion_date ? (
                    <Badge variant="outline">
                      次回提案 {format(new Date(item.next_visit_suggestion_date), 'M/d', { locale: ja })}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.revisit_reason ?? item.postpone_reason ?? item.cancellation_reason ?? '特記事項なし'}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PatientTimelineTab({
  timelineEvents,
  selfReports,
  externalShares,
}: {
  timelineEvents: Patient['timeline_events'];
  selfReports: Patient['self_reports'];
  externalShares: Patient['external_shares'];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">統合タイムライン</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {timelineEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">イベントはありません</p>
          ) : (
            timelineEvents.map((item) => (
              <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-muted-foreground">
                      {format(new Date(item.occurred_at), 'yyyy年M月d日 HH:mm', { locale: ja })}
                    </p>
                  </div>
                  <Badge variant="outline">{item.event_type}</Badge>
                </div>
                {item.summary ? <p className="mt-2 text-xs text-muted-foreground">{item.summary}</p> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">自己申告</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selfReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">自己申告はありません</p>
            ) : (
              selfReports.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{item.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.reported_by_name}
                    {item.relation ? ` (${item.relation})` : ''} / {item.category} / {item.status}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-xs leading-5 text-muted-foreground">
                    {item.content}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {item.requested_callback ? <span>折返し希望</span> : null}
                    {item.preferred_contact_time ? (
                      <span>希望連絡帯 {item.preferred_contact_time}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">外部共有</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {externalShares.length === 0 ? (
              <p className="text-sm text-muted-foreground">共有中のリンクはありません</p>
            ) : (
              externalShares.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{item.granted_to_name}</p>
                  <p className="text-xs text-muted-foreground">
                    期限 {format(new Date(item.expires_at), 'M/d HH:mm', { locale: ja })}
                    {item.accessed_at ? ' / 閲覧済み' : ' / 未閲覧'}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PatientRiskCard({
  riskSummary,
}: {
  riskSummary: Patient['risk_summary'];
}) {
  const levelLabel =
    riskSummary?.level === 'high'
      ? '高'
      : riskSummary?.level === 'watch'
        ? '注意'
        : '安定';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">患者リスク</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">総合判定</span>
          <Badge variant={riskSummary?.level === 'high' ? 'destructive' : 'outline'}>
            {levelLabel}
            {riskSummary ? ` / ${riskSummary.score}` : ''}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span>自己申告 {riskSummary?.unresolved_self_reports ?? 0}</span>
          <span>課題 {riskSummary?.open_issues ?? 0}</span>
          <span>未完了タスク {riskSummary?.open_tasks ?? 0}</span>
          <span>報告待ち {riskSummary?.pending_reports ?? 0}</span>
        </div>
        {(riskSummary?.reasons.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">大きなリスクシグナルはありません。</p>
        ) : (
          <div className="space-y-2">
            {riskSummary?.reasons.slice(0, 4).map((reason) => (
              <div key={reason} className="rounded-lg border border-border p-2 text-xs">
                {reason}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommunicationQueueCard({
  queue,
  orgId,
  patientId,
}: {
  queue: Patient['communication_queue'];
  orgId: string;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const createDraftMutation = useMutation({
    mutationFn: async (draft: Patient['communication_queue']['emergency_drafts'][number]) => {
      const res = await fetch('/api/communication-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          patient_id: draft.patient_id || patientId,
          request_type: draft.request_type,
          template_key: draft.template_key,
          recipient_name: draft.target_name ?? draft.target_role,
          recipient_role: draft.target_role,
          related_entity_type: 'patient',
          related_entity_id: draft.patient_id || patientId,
          context_snapshot: {
            source: 'patient_detail',
            template_key: draft.template_key,
          },
          status: 'draft',
          subject: draft.subject,
          content: draft.content,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '緊急連絡ドラフトの起票に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('緊急連絡ドラフトを起票しました');
      await Promise.all([
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
        queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '緊急連絡ドラフトの起票に失敗しました');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">連絡キュー</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">未処理 {queue.summary.pending_count}</Badge>
          <Badge variant="outline">再架電 {queue.summary.callback_followups}</Badge>
          <Badge variant="outline">自己申告 {queue.summary.self_reports}</Badge>
          <Badge variant="outline">未確認 {queue.summary.unconfirmed_count}</Badge>
          <Badge variant="outline">返信待ち {queue.summary.reply_waiting_count}</Badge>
          <Badge variant="outline">失敗 {queue.summary.failed_count}</Badge>
        </div>
        {queue.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">未処理の連絡はありません</p>
        ) : (
          queue.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.patient_name ?? '患者未設定'} / {item.summary}
                  </p>
                </div>
                <Badge variant={item.priority === 'urgent' ? 'destructive' : 'outline'}>
                  {item.channel}
                </Badge>
              </div>
            </div>
          ))
        )}
        {queue.emergency_drafts.length > 0 ? (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium text-muted-foreground">緊急連絡ドラフト</p>
            {queue.emergency_drafts.slice(0, 3).map((draft) => (
              <div key={draft.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{draft.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{draft.summary}</p>
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => createDraftMutation.mutate(draft)}
                    disabled={createDraftMutation.isPending}
                  >
                    下書き作成
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TaskAndIssueCard({
  tasks,
  issues,
  billingSummary,
}: {
  tasks: Patient['open_tasks'];
  issues: Patient['medication_issues'];
  billingSummary: Patient['billing_summary'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">運用・請求ステータス</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">タスク {tasks.length}</Badge>
          <Badge variant="outline">薬学的課題 {issues.length}</Badge>
          <Badge variant="outline">算定可 {billingSummary.claimable_count}</Badge>
          <Badge variant="outline">算定ブロック {billingSummary.blocked_count}</Badge>
        </div>
        <div className="space-y-2">
          {tasks.slice(0, 3).map((task) => (
            <div key={task.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{task.title}</p>
              <p className="text-xs text-muted-foreground">
                {task.description ?? task.task_type}
              </p>
            </div>
          ))}
          {issues.slice(0, 2).map((issue) => (
            <div key={issue.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{issue.title}</p>
              <p className="text-xs text-muted-foreground">
                {issue.priority}
                {issue.category ? ` / ${issue.category}` : ''}
              </p>
            </div>
          ))}
          {billingSummary.evidence
            .filter((evidence) => evidence.blockers.length > 0)
            .slice(0, 2)
            .map((evidence) => (
              <div key={evidence.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
                <p className="font-medium text-rose-900">算定ブロッカー</p>
                <p className="mt-1 text-xs text-rose-800">
                  {evidence.blockers[0]?.reason ?? evidence.exclusion_reason ?? '算定条件を確認してください'}
                </p>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
