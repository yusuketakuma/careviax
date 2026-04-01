'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Square, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedProgressBar } from '@/components/ui/segmented-progress-bar';
import { Separator } from '@/components/ui/separator';
import {
  UAT_CHECKLIST,
  UAT_PRIORITY_OPTIONS,
  UAT_STATUS_OPTIONS,
} from '@/lib/constants/uat';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  createUatFeedbackDraft,
  isUatFeedbackDraftDirty,
  mergeUatFeedbackDraft,
  type UatFeedbackDraft,
} from '@/lib/uat-feedback';

type UatFeedbackItem = {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'triaged' | 'in_progress' | 'resolved' | 'deferred';
  owner_user_id: string | null;
  feedback: string;
  checklist_progress: string | null;
  checked_items: string[];
  source: string | null;
  linked_work_item: string | null;
  due_date: string | null;
  resolved_at: string | null;
  created_at: string;
};

type PilotReadinessData = {
  generated_at: string;
  case_summary: {
    active_case_count: number;
    facility_linked_case_count: number;
    non_facility_case_count: number;
    facility_count: number;
    set_pilot_case_count: number;
    set_pilot_without_facility_count: number;
  };
  uat_summary: {
    total_feedback: number;
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    blocker_count: number;
    recent_feedback: Array<{
      id: string;
      priority: string;
      feedback: string;
      checklist_progress: string | null;
      source: string | null;
      created_at: string;
    }>;
  };
  decisions: {
    facility_batching: 'ready' | 'phase2_candidate';
    medication_set_workflow: 'ready' | 'phase2_candidate';
    phase2_entry: 'ready' | 'blocked';
  };
  recommendations: string[];
};

type CollaboratorOption = {
  id: string;
  name: string;
  role: string;
};

function dedupeCollaboratorOptions(items: CollaboratorOption[]) {
  const uniqueItems = new Map<string, CollaboratorOption>();
  for (const item of items) {
    if (!uniqueItems.has(item.id)) {
      uniqueItems.set(item.id, item);
    }
  }
  return Array.from(uniqueItems.values());
}

type UatFeedbackSummaryData = {
  generated_at: string;
  total_feedback: number;
  priorities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  blocker_count: number;
  action_items: Array<{
    id: string;
    priority: string;
    status: string;
    feedback: string;
    checklist_progress: string | null;
    source: string | null;
    created_at: string;
  }>;
  checklist_coverage: Array<{
    item_id: string;
    label: string;
    checked_count: number;
  }>;
  recommendations: string[];
};

type PilotOrgAuditData = {
  generated_at: string;
  org_structure: {
    site_count: number;
    active_member_count: number;
    role_counts: Record<string, number>;
    site_breakdown: Array<{
      site_id: string;
      site_name: string;
      active_member_count: number;
      service_area_count: number;
      has_geo: boolean;
    }>;
  };
  pilot_targets: {
    active_case_count: number;
    facility_linked_case_count: number;
    set_pilot_case_count: number;
  };
  coverage: {
    total_primary_residences: number;
    flagged_patient_count: number;
    flagged_patients_truncated: boolean;
    service_area_covered_count: number;
    radius_16km_covered_count: number;
    uncovered_count: number;
    review_required_count: number;
    flagged_patients: Array<{
      patient_id: string;
      patient_name: string;
      address: string;
      reason: string;
      nearest_site_name: string | null;
      nearest_site_distance_km: number | null;
    }>;
  };
  recommendations: string[];
};

type PilotLaunchDossierData = {
  generated_at: string;
  recommendations: string[];
  readiness: {
    decisions: {
      facility_batching: 'ready' | 'phase2_candidate';
      medication_set_workflow: 'ready' | 'phase2_candidate';
      phase2_entry: 'ready' | 'blocked';
    };
  };
  org_audit: {
    coverage: {
      uncovered_count: number;
      review_required_count: number;
      flagged_patient_count: number;
      flagged_patients_truncated: boolean;
    };
  };
  uat_summary: {
    total_feedback: number;
    blocker_count: number;
  };
  external_readiness: {
    pmda: {
      ready_for_import_test: boolean;
    };
    backup: {
      ready_for_live_drill: boolean;
      recorded_runs: Array<{
        date: string;
      }>;
    };
    isms: {
      ready_for_quote_request: boolean;
      comparison_table_started: boolean;
      decision_memo_started: boolean;
    };
  };
};

async function fetchOrgJson<T>(
  orgId: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackMessage: string
) {
  const response = await fetch(input, {
    ...init,
    headers: {
      'x-org-id': orgId,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? fallbackMessage);
  }

  if (!payload) {
    throw new Error(fallbackMessage);
  }

  return payload;
}

export function UatContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState('');
  const [priority, setPriority] = useState('medium');
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, UatFeedbackDraft>>({});

  const feedbackQuery = useQuery({
    queryKey: ['uat-feedback', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: UatFeedbackItem[] }>(
        orgId,
        '/api/admin/uat-feedback',
        undefined,
        'UAT フィードバックの取得に失敗しました'
      ),
    enabled: !!orgId,
  });
  const readinessQuery = useQuery({
    queryKey: ['pilot-readiness', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: PilotReadinessData }>(
        orgId,
        '/api/admin/pilot-readiness',
        undefined,
        'pilot readiness の取得に失敗しました'
      ),
    enabled: !!orgId,
  });
  const summaryQuery = useQuery({
    queryKey: ['uat-feedback-summary', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: UatFeedbackSummaryData }>(
        orgId,
        '/api/admin/uat-feedback/summary',
        undefined,
        'UAT 集計の取得に失敗しました'
      ),
    enabled: !!orgId,
  });
  const collaboratorsQuery = useQuery({
    queryKey: ['uat-feedback-collaborators', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: CollaboratorOption[] }>(
        orgId,
        '/api/pharmacists?include_collaborators=true',
        undefined,
        '担当候補の取得に失敗しました'
      ),
    enabled: !!orgId,
  });
  const orgAuditQuery = useQuery({
    queryKey: ['pilot-org-audit', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: PilotOrgAuditData }>(
        orgId,
        '/api/admin/pilot-org-audit',
        undefined,
        'pilot org audit の取得に失敗しました'
      ),
    enabled: !!orgId,
  });
  const dossierQuery = useQuery({
    queryKey: ['pilot-launch-dossier', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: PilotLaunchDossierData }>(
        orgId,
        '/api/admin/pilot-launch-dossier',
        undefined,
        'pilot launch dossier の取得に失敗しました'
      ),
    enabled: !!orgId,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      fetchOrgJson<{ data: UatFeedbackItem }>(
        orgId,
        '/api/admin/uat-feedback',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            priority,
            feedback: feedback.trim(),
            checklist_progress: `${checkedCount}/${totalItems}`,
            checked_items: Array.from(checked),
            source: 'pilot_pharmacy',
          }),
        },
        'UAT フィードバックの送信に失敗しました'
      ),
    onSuccess: async () => {
      toast.success('フィードバックを保存しました');
      setFeedback('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['uat-feedback', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['uat-feedback-summary', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-readiness', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-launch-dossier', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'UAT フィードバックの送信に失敗しました');
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: UatFeedbackDraft }) =>
      fetchOrgJson<{ data: UatFeedbackItem }>(
        orgId,
        `/api/admin/uat-feedback/${id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: draft.status,
            owner_user_id: draft.owner_user_id || null,
            linked_work_item: draft.linked_work_item.trim() || null,
            due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
          }),
        },
        'UAT フィードバックの更新に失敗しました'
      ),
    onSuccess: async () => {
      toast.success('フィードバックの triage 状態を更新しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['uat-feedback', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['uat-feedback-summary', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-readiness', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-launch-dossier', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'UAT フィードバックの更新に失敗しました');
    },
  });

  const totalItems = UAT_CHECKLIST.reduce(
    (acc, s) => acc + s.items.length,
    0
  );
  const checkedCount = checked.size;
  const readiness = readinessQuery.data?.data;
  const summary = summaryQuery.data?.data;
  const orgAudit = orgAuditQuery.data?.data;
  const dossier = dossierQuery.data?.data;
  const collaborators = dedupeCollaboratorOptions(collaboratorsQuery.data?.data ?? []);
  const collaboratorError = collaboratorsQuery.error instanceof Error
    ? collaboratorsQuery.error.message
    : '担当候補の取得に失敗しました';

  const priorityLabelByValue = new Map<string, string>(
    UAT_PRIORITY_OPTIONS.map((option) => [option.value, option.label] as const)
  );
  const statusLabelByValue = new Map<string, string>(
    UAT_STATUS_OPTIONS.map((option) => [option.value, option.label] as const)
  );

  function getDraft(item: UatFeedbackItem): UatFeedbackDraft {
    return feedbackDrafts[item.id] ?? createUatFeedbackDraft(item);
  }

  function updateDraft(item: UatFeedbackItem, patch: Partial<UatFeedbackDraft>) {
    setFeedbackDrafts((prev) => ({
      ...prev,
      [item.id]: mergeUatFeedbackDraft({
        item,
        currentDraft: prev[item.id],
        patch,
      }),
    }));
  }

  function isDraftDirty(item: UatFeedbackItem) {
    return isUatFeedbackDraftDirty({
      item,
      draft: getDraft(item),
    });
  }

  function toggleItem(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmitFeedback() {
    if (!feedback.trim()) {
      toast.error('フィードバック内容を入力してください');
      return;
    }
    await submitMutation.mutateAsync();
  }

  async function handleUpdateFeedback(item: UatFeedbackItem) {
    await updateMutation.mutateAsync({
      id: item.id,
      draft: getDraft(item),
    });
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Pilot Launch Dossier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {dossierQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">ローンチ前提を読み込み中...</p>
          ) : dossierQuery.error ? (
            <p className="text-sm text-destructive">
              {dossierQuery.error instanceof Error
                ? dossierQuery.error.message
                : 'pilot launch dossier の取得に失敗しました'}
            </p>
          ) : dossier ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Phase 2 開始判断</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {dossier.readiness.decisions.phase2_entry === 'ready' ? '進行可能' : '要修正'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    集計時刻 {new Date(dossier.generated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">UAT / カバレッジ</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    blocker {dossier.uat_summary.blocker_count} / flagged {dossier.org_audit.coverage.flagged_patient_count}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    圏外 {dossier.org_audit.coverage.uncovered_count} / 要確認 {dossier.org_audit.coverage.review_required_count}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">外部前提</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    PMDA {dossier.external_readiness.pmda.ready_for_import_test ? 'ok' : 'pending'}
                    {' / '}
                    Backup {dossier.external_readiness.backup.ready_for_live_drill ? 'ready' : 'pending'}
                    {' / '}
                    ISMS {dossier.external_readiness.isms.ready_for_quote_request ? 'docs ok' : 'pending'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    drill 記録 {dossier.external_readiness.backup.recorded_runs.length} 件
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">pilot 方針</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    facility {dossier.readiness.decisions.facility_batching}
                    {' / '}
                    set {dossier.readiness.decisions.medication_set_workflow}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    UAT {dossier.uat_summary.total_feedback} 件
                    {dossier.org_audit.coverage.flagged_patients_truncated ? ' / flagged preview truncated' : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">統合アクション</p>
                <ul className="space-y-2">
                  {dossier.recommendations.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {readiness ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Pilot Readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">施設患者</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.case_summary.facility_linked_case_count} / {readiness.case_summary.active_case_count}
                </p>
                <p className="text-xs text-muted-foreground">
                  施設数 {readiness.case_summary.facility_count}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">セット pilot 対象</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.case_summary.set_pilot_case_count} 件
                </p>
                <p className="text-xs text-muted-foreground">
                  施設紐付けなし {readiness.case_summary.set_pilot_without_facility_count} 件
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">UAT blocker</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.uat_summary.blocker_count} 件
                </p>
                <p className="text-xs text-muted-foreground">
                  critical {readiness.uat_summary.critical_count} / high {readiness.uat_summary.high_count}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Phase 2 開始判断</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.decisions.phase2_entry === 'ready' ? '進行可能' : '要修正'}
                </p>
                <p className="text-xs text-muted-foreground">
                  集計時刻 {new Date(readiness.generated_at).toLocaleString('ja-JP')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">推奨アクション</p>
              <ul className="space-y-2">
                {readiness.recommendations.map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {readiness.uat_summary.recent_feedback.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">直近フィードバック</p>
                <ul className="space-y-2">
                  {readiness.uat_summary.recent_feedback.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
                    >
                      <p className="font-medium text-foreground">
                        [{item.priority}] {item.feedback}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {item.checklist_progress ?? '進捗未入力'} /{' '}
                        {new Date(item.created_at).toLocaleString('ja-JP')}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">UAT Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {summaryQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">集計を読み込み中...</p>
          ) : summaryQuery.error ? (
            <p className="text-sm text-destructive">
              {summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : 'UAT 集計の取得に失敗しました'}
            </p>
          ) : summary ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">総フィードバック</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {summary.total_feedback} 件
                  </p>
                  <p className="text-xs text-muted-foreground">
                    集計時刻 {new Date(summary.generated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">未解消 blocker</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {summary.blocker_count} 件
                  </p>
                  <p className="text-xs text-muted-foreground">
                    critical {summary.priorities.critical} / high {summary.priorities.high}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                {UAT_PRIORITY_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    className="rounded-md border border-border/70 bg-background px-3 py-2"
                  >
                    <p className="text-xs text-muted-foreground">{option.label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {summary.priorities[option.value]}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">推奨アクション</p>
                <ul className="space-y-2">
                  {summary.recommendations.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">優先 action items</p>
                {summary.action_items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    critical/high の未解消項目はありません。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {summary.action_items.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
                      >
                        <p className="font-medium text-foreground">
                          [{priorityLabelByValue.get(item.priority) ?? item.priority}] {item.feedback}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          状態 {statusLabelByValue.get(item.status) ?? item.status} /{' '}
                          {item.checklist_progress ?? '進捗未入力'} /{' '}
                          {new Date(item.created_at).toLocaleString('ja-JP')}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Target Pharmacy Audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgAuditQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">監査サマリーを読み込み中...</p>
          ) : orgAuditQuery.error ? (
            <p className="text-sm text-destructive">
              {orgAuditQuery.error instanceof Error
                ? orgAuditQuery.error.message
                : 'pilot org audit の取得に失敗しました'}
            </p>
          ) : orgAudit ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">店舗構成</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {orgAudit.org_structure.site_count} 店舗 / {orgAudit.org_structure.active_member_count} 名
                  </p>
                  <p className="text-xs text-muted-foreground">
                    集計時刻 {new Date(orgAudit.generated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">訪問カバレッジ</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    area {orgAudit.coverage.service_area_covered_count} / 16km {orgAudit.coverage.radius_16km_covered_count}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    圏外 {orgAudit.coverage.uncovered_count} / 要確認 {orgAudit.coverage.review_required_count} / flagged {orgAudit.coverage.flagged_patient_count}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">pilot 対象</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    active {orgAudit.pilot_targets.active_case_count} / facility {orgAudit.pilot_targets.facility_linked_case_count}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    set pilot {orgAudit.pilot_targets.set_pilot_case_count}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">ロール内訳</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {Object.entries(orgAudit.org_structure.role_counts)
                      .map(([role, count]) => `${role}:${count}`)
                      .join(' / ') || '未登録'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    `pnpm pilot:org-audit -- --org &lt;org_id&gt;` と同じ集計
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">店舗別 breakdown</p>
                <ul className="space-y-2">
                  {orgAudit.org_structure.site_breakdown.map((site) => (
                    <li
                      key={site.site_id}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {site.site_name}: active members {site.active_member_count} / service areas {site.service_area_count} / geo {site.has_geo ? 'ok' : 'missing'}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">監査メモ</p>
                <ul className="space-y-2">
                  {orgAudit.recommendations.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {orgAudit.coverage.flagged_patients.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">要確認患者</p>
                  {orgAudit.coverage.flagged_patients_truncated ? (
                    <p className="text-xs text-muted-foreground">
                      表示は先頭 20 件のみです。CLI で残件を確認してください。
                    </p>
                  ) : null}
                  <ul className="space-y-2">
                    {orgAudit.coverage.flagged_patients.map((patient) => (
                      <li
                        key={patient.patient_id}
                        className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
                      >
                        <p className="font-medium text-foreground">{patient.patient_name}</p>
                        <p className="mt-1 text-muted-foreground">
                          {patient.reason} / {patient.address}
                          {patient.nearest_site_name ? ` / nearest ${patient.nearest_site_name}` : ''}
                          {patient.nearest_site_distance_km != null ? ` / ${patient.nearest_site_distance_km}km` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Progress */}
      <div className="flex items-center gap-3">
        <SegmentedProgressBar value={checkedCount} max={totalItems} className="h-2 flex-1" />
        <span className="text-sm tabular-nums text-muted-foreground">
          {checkedCount} / {totalItems} 完了
        </span>
      </div>

      {/* Checklist */}
      <div className="space-y-6">
        {UAT_CHECKLIST.map((section) => (
          <Card key={section.title} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {section.items.map((item) => {
                  const isChecked = checked.has(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        className="flex w-full items-start gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-pressed={isChecked}
                      >
                        {isChecked ? (
                          <CheckSquare
                            className="mt-0.5 size-5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                        ) : (
                          <Square
                            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`text-sm leading-relaxed ${
                            isChecked
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Feedback form */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          フィードバック送信
        </h2>

        <div className="space-y-1">
          <Label htmlFor="feedback_priority">優先度</Label>
          <Select value={priority} onValueChange={(v) => v && setPriority(v)}>
            <SelectTrigger id="feedback_priority" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UAT_PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="feedback_text">フィードバック内容</Label>
          <Textarea
            id="feedback_text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={5}
            placeholder="問題の内容・再現手順・改善提案などを記入してください"
            className="resize-none"
          />
        </div>

        <Button
          onClick={handleSubmitFeedback}
          disabled={submitMutation.isPending || !feedback.trim()}
        >
          <Send className="mr-2 size-4" aria-hidden="true" />
          {submitMutation.isPending ? '送信中...' : 'フィードバックを送信'}
        </Button>
      </div>

      <Separator />

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">保存済みフィードバック</h2>
        {feedbackQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        ) : feedbackQuery.error ? (
          <p className="text-sm text-destructive">
            {feedbackQuery.error instanceof Error
              ? feedbackQuery.error.message
              : 'UAT フィードバックの取得に失敗しました'}
          </p>
        ) : (feedbackQuery.data?.data.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">まだ保存済みフィードバックはありません。</p>
        ) : (
          <div className="space-y-3">
            {(feedbackQuery.data?.data ?? []).map((item) => (
              <Card key={item.id} size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {priorityLabelByValue.get(item.priority) ?? item.priority}
                      {' · '}
                      {statusLabelByValue.get(item.status) ?? item.status}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {new Date(item.created_at).toLocaleString('ja-JP')}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <p className="whitespace-pre-wrap text-foreground">{item.feedback}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>進捗: {item.checklist_progress ?? '未記録'}</span>
                    <span>チェック項目: {item.checked_items.length}</span>
                    <span>source: {item.source ?? 'unknown'}</span>
                    {item.resolved_at ? (
                      <span>解決日時: {new Date(item.resolved_at).toLocaleString('ja-JP')}</span>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`feedback-status-${item.id}`}>状態</Label>
                      <Select
                        value={getDraft(item).status}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateDraft(item, { status: value });
                        }}
                      >
                        <SelectTrigger id={`feedback-status-${item.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UAT_STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`feedback-owner-${item.id}`}>担当者</Label>
                      <Select
                        value={getDraft(item).owner_user_id || '__unassigned__'}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateDraft(item, {
                            owner_user_id: value === '__unassigned__' ? '' : value,
                          });
                        }}
                      >
                        <SelectTrigger id={`feedback-owner-${item.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">未割当</SelectItem>
                          {collaborators.map((collaborator) => (
                            <SelectItem key={collaborator.id} value={collaborator.id}>
                              {collaborator.name} ({collaborator.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {collaboratorsQuery.error ? (
                        <p className="text-xs text-destructive">{collaboratorError}</p>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`feedback-work-item-${item.id}`}>関連 work item</Label>
                      <Input
                        id={`feedback-work-item-${item.id}`}
                        value={getDraft(item).linked_work_item}
                        onChange={(event) =>
                          updateDraft(item, { linked_work_item: event.target.value })}
                        placeholder="例: CVX-102"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`feedback-due-date-${item.id}`}>期限</Label>
                      <Input
                        id={`feedback-due-date-${item.id}`}
                        type="date"
                        value={getDraft(item).due_date}
                        onChange={(event) =>
                          updateDraft(item, { due_date: event.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {getDraft(item).owner_user_id
                        ? `担当: ${
                            collaborators.find((collaborator) => collaborator.id === getDraft(item).owner_user_id)?.name ??
                            '選択済み'
                          }`
                        : '担当未割当'}
                      {' / '}
                      {getDraft(item).due_date ? `期限 ${getDraft(item).due_date}` : '期限未設定'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={updateMutation.isPending || !isDraftDirty(item)}
                      onClick={() => handleUpdateFeedback(item)}
                    >
                      {updateMutation.isPending ? '保存中...' : 'triage を保存'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
