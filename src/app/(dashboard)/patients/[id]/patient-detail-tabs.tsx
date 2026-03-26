'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { CasesTab } from './cases-tab';
import { ManagementPlanPanel } from './management-plan-panel';
import { MedicationsContent } from './medications/medications-content';
import { PatientCareTeamPanel } from './patient-care-team-panel';
import { PatientConditionsCard } from './patient-conditions-card';
import { PatientContactsPanel } from './patient-contacts-panel';
import { PatientMasterCard } from './patient-master-card';
import { PrescriptionHistoryContent } from './prescriptions/prescription-history-content';
import { ExternalShareContent } from './share/external-share-content';
import { VisitConstraintsCard } from './visit-constraints-card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { FileQuestion } from 'lucide-react';

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
    care_team_links: Array<{
      id: string;
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
    status: string;
    reported_by_name: string;
    requested_callback: boolean;
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
    };
    items: Array<{
      id: string;
      queue_type: string;
      title: string;
      summary: string;
      channel: string;
      status: string;
      priority: 'urgent' | 'high' | 'normal';
      due_at: string | null;
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
  billing_summary: {
    claimable_count: number;
    blocked_count: number;
    evidence: Array<{
      id: string;
      billing_month: string | null;
      claimable: boolean;
      exclusion_reason: string | null;
      validation_notes: string | null;
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

export function PatientDetailTabs({ patientId }: PatientDetailTabsProps) {
  const orgId = useOrgId();

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
    enabled: !!orgId,
  });

  if (isLoading) return <Loading />;
  if (error || !patient) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="患者が見つかりません"
        description="指定された患者情報を取得できませんでした"
      />
    );
  }

  return (
    <div>
      {/* Patient header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{patient.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{patient.name_kana}</p>
      </div>

      <Tabs defaultValue="basic">
        <TabsList variant="line" className="mb-4 w-full overflow-x-auto">
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="cases">ケース</TabsTrigger>
          <TabsTrigger value="prescriptions">処方履歴</TabsTrigger>
          <TabsTrigger value="medications">薬剤</TabsTrigger>
          <TabsTrigger value="visits">訪問</TabsTrigger>
          <TabsTrigger value="communications">連携</TabsTrigger>
          <TabsTrigger value="documents">文書</TabsTrigger>
          <TabsTrigger value="timeline">タイムライン</TabsTrigger>
        </TabsList>

        {/* 基本情報タブ */}
        <TabsContent value="basic">
          <div className="grid gap-4 lg:grid-cols-2">
            <PatientMasterCard patient={patient} orgId={orgId} />
            <PatientRiskCard riskSummary={patient.risk_summary} />

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
          <MedicationsContent patientId={patient.id} />
        </TabsContent>
        <TabsContent value="visits">
          <PatientVisitsTab
            visitSchedules={patient.visit_schedules}
            visitRecords={patient.visit_records}
          />
        </TabsContent>
        <TabsContent value="communications">
          <div className="grid gap-4 lg:grid-cols-2">
            <PatientContactsPanel
              patientId={patient.id}
              orgId={orgId}
              initialContacts={patient.contacts}
            />
            <PatientCareTeamPanel patientId={patient.id} orgId={orgId} cases={patient.cases} />
            <CommunicationQueueCard queue={patient.communication_queue} />
            <TaskAndIssueCard
              tasks={patient.open_tasks}
              issues={patient.medication_issues}
              billingSummary={patient.billing_summary}
            />
          </div>
        </TabsContent>
        <TabsContent value="documents">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <ManagementPlanPanel patientName={patient.name} cases={patient.cases} orgId={orgId} />
            <ExternalShareContent patientId={patient.id} />
          </div>
        </TabsContent>
        <TabsContent value="timeline">
          <PatientTimelineTab
            timelineEvents={patient.timeline_events}
            selfReports={patient.self_reports}
            externalShares={patient.external_shares}
          />
        </TabsContent>
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

function PatientVisitsTab({
  visitSchedules,
  visitRecords,
}: {
  visitSchedules: Patient['visit_schedules'];
  visitRecords: Patient['visit_records'];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">直近の訪問予定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <CardTitle className="text-base">訪問記録</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {visitRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground">訪問記録はありません</p>
          ) : (
            visitRecords.map((item) => (
              <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {format(new Date(item.visit_date ?? item.created_at), 'yyyy年M月d日(E)', { locale: ja })}
                    </p>
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
                    {item.reported_by_name} / {item.category} / {item.status}
                  </p>
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
}: {
  queue: Patient['communication_queue'];
}) {
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
          <Badge variant="outline">報告送達 {queue.summary.delivery_backlog}</Badge>
        </div>
        {queue.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">未処理の連絡はありません</p>
        ) : (
          queue.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.summary}</p>
                </div>
                <Badge variant={item.priority === 'urgent' ? 'destructive' : 'outline'}>
                  {item.channel}
                </Badge>
              </div>
            </div>
          ))
        )}
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
        </div>
      </CardContent>
    </Card>
  );
}
