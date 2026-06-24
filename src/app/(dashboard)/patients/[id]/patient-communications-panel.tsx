'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ActionRail } from '@/components/ui/action-rail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { PatientContactsPanel } from './patient-contacts-panel';
import { PatientCareTeamPanel } from './patient-care-team-panel';
import { PatientMcsLinkCard } from './patient-mcs-link-card';
import type { PatientCommunicationsSnapshot, PatientOverview } from './patient-detail.types';

export function PatientCommunicationsPanel({
  patientId,
  cases,
  enabled,
}: {
  patientId: string;
  cases: PatientOverview['cases'];
  enabled: boolean;
}) {
  const orgId = useOrgId();
  const contactsQuery = useQuery<{
    data: Array<{
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
  }>({
    queryKey: ['patient-contacts', patientId, orgId],
    enabled: Boolean(orgId && patientId && enabled),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${encodePathSegment(patientId)}/contacts`, {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      if (!response.ok) {
        throw new Error('患者連絡先の取得に失敗しました');
      }
      return response.json();
    },
  });
  const communicationsQuery = useQuery<PatientCommunicationsSnapshot>({
    queryKey: ['patient-communications', patientId, orgId],
    enabled: Boolean(orgId && patientId && enabled),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${encodePathSegment(patientId)}/communications`, {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      if (!response.ok) {
        throw new Error('連携情報の取得に失敗しました');
      }
      return response.json();
    },
  });

  if (!orgId) {
    return <Loading label="連携情報を読み込み中..." />;
  }

  if (communicationsQuery.isLoading || contactsQuery.isLoading) {
    return <Loading label="連携情報を読み込み中..." />;
  }

  if (
    communicationsQuery.error instanceof Error ||
    contactsQuery.error instanceof Error ||
    !communicationsQuery.data ||
    !contactsQuery.data
  ) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">連携</h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {communicationsQuery.error instanceof Error
              ? communicationsQuery.error.message
              : contactsQuery.error instanceof Error
                ? contactsQuery.error.message
                : '連携情報の取得に失敗しました'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PatientContactsPanel
        patientId={patientId}
        orgId={orgId}
        initialContacts={contactsQuery.data.data}
      />
      <PatientCareTeamPanel patientId={patientId} orgId={orgId} cases={cases} />
      <PatientMcsLinkCard patientId={patientId} />
      <CommunicationQueueCard
        queue={communicationsQuery.data.communication_queue}
        orgId={orgId}
        patientId={patientId}
      />
      <TaskAndIssueCard
        tasks={communicationsQuery.data.open_tasks}
        issues={communicationsQuery.data.medication_issues}
        billingSummary={communicationsQuery.data.billing_summary}
      />
    </div>
  );
}

function CommunicationQueueCard({
  queue,
  orgId,
  patientId,
}: {
  queue: PatientCommunicationsSnapshot['communication_queue'];
  orgId: string;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const createDraftMutation = useMutation({
    mutationFn: async (
      draft: PatientCommunicationsSnapshot['communication_queue']['emergency_drafts'][number],
    ) => {
      const res = await fetch('/api/communication-requests', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
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
        queryClient.invalidateQueries({ queryKey: ['patient-communications', patientId, orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '緊急連絡ドラフトの起票に失敗しました');
    },
  });

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">連絡キュー</h2>
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
                <ActionRail className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => createDraftMutation.mutate(draft)}
                    disabled={createDraftMutation.isPending}
                  >
                    下書き作成
                  </Button>
                </ActionRail>
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
  tasks: PatientCommunicationsSnapshot['open_tasks'];
  issues: PatientCommunicationsSnapshot['medication_issues'];
  billingSummary: PatientCommunicationsSnapshot['billing_summary'];
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">運用・請求ステータス</h2>
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
              <p className="text-xs text-muted-foreground">{task.description ?? task.task_type}</p>
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
              <div
                key={evidence.id}
                className="rounded-lg border border-state-blocked/30 bg-state-blocked/10 p-3 text-sm"
              >
                <p className="font-medium text-state-blocked">算定を止めている理由</p>
                <p className="mt-1 text-xs text-state-blocked">
                  改定 {evidence.effective_revision_code ?? '—'} / 設定{' '}
                  {evidence.site_config_status ?? '—'}
                </p>
                <p className="mt-1 text-xs text-state-blocked">
                  {evidence.blockers[0]?.reason ??
                    evidence.exclusion_reason ??
                    '算定条件を確認してください'}
                </p>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
