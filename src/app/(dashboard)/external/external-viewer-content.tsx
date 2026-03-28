'use client';

import type { ElementType } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ExternalLink, HeartHandshake, MessageSquareWarning, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

type ExternalGrant = {
  id: string;
  patient_id: string;
  patient: { name: string };
  granted_to_name: string;
  granted_to_contact: string | null;
  scope: Record<string, boolean>;
  expires_at: string;
  accessed_at: string | null;
  created_at: string;
  self_report_summary: {
    total: number;
    open: number;
    latest_at: string | null;
  };
};

type SelfReport = {
  id: string;
  patient_id: string;
  patient_name: string | null;
  category: string;
  subject: string;
  status: string;
  reported_by_name: string;
  requested_callback: boolean;
  created_at: string;
};

type CommunityActivity = {
  id: string;
  title: string;
  activity_type: string;
  partner_name: string | null;
  follow_up_required: boolean;
  referrals_generated: number | null;
  activity_date: string;
};

function scopeLabels(scope: Record<string, boolean>) {
  return Object.entries(scope)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

export function ExternalViewerContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const grantsQuery = useQuery({
    queryKey: ['external-access-grants', orgId],
    queryFn: async () => {
      const response = await fetch('/api/external-access', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('外部共有の取得に失敗しました');
      return response.json() as Promise<{ data: ExternalGrant[] }>;
    },
    enabled: !!orgId,
  });

  const selfReportsQuery = useQuery({
    queryKey: ['patient-self-reports', orgId, 'external-dashboard'],
    queryFn: async () => {
      const response = await fetch('/api/patient-self-reports?limit=12', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('自己申告の取得に失敗しました');
      return response.json() as Promise<{ data: SelfReport[] }>;
    },
    enabled: !!orgId,
  });

  const activitiesQuery = useQuery({
    queryKey: ['community-activities', orgId, 'follow-up'],
    queryFn: async () => {
      const response = await fetch('/api/community-activities?limit=8&follow_up_required=true', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('地域活動の取得に失敗しました');
      return response.json() as Promise<{ data: CommunityActivity[] }>;
    },
    enabled: !!orgId,
  });

  const grants = grantsQuery.data?.data ?? [];
  const selfReports = selfReportsQuery.data?.data ?? [];
  const activeSelfReports = selfReports.filter(
    (item) => item.status !== 'resolved' && item.status !== 'dismissed'
  );
  const followUps = (activitiesQuery.data?.data ?? []).filter((item) => item.follow_up_required);

  const updateSelfReportMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: 'triaged' | 'resolved' | 'dismissed' | 'converted_to_task';
    }) => {
      const response = await fetch(`/api/patient-self-reports/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? '自己申告の更新に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['patient-self-reports', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createTaskMutation = useMutation({
    mutationFn: async (report: SelfReport) => {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          task_type: 'patient_self_report_followup',
          title: `${report.patient_name ?? '患者'}: ${report.subject}`,
          description: `${report.category}\n${report.reported_by_name}${report.requested_callback ? '\n折返し希望あり' : ''}`,
          priority: report.requested_callback ? 'high' : 'normal',
          related_entity_type: 'patient_self_report',
          related_entity_id: report.id,
          dedupe_key: `patient-self-report:${report.id}`,
          metadata: {
            patient_id: report.patient_id,
            category: report.category,
            requested_callback: report.requested_callback,
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? 'タスク作成に失敗しました');
      }
      await updateSelfReportMutation.mutateAsync({
        id: report.id,
        status: 'converted_to_task',
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      toast.success('自己申告をタスク化しました');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-3">
        <SummaryCard
          title="有効な共有"
          value={grants.length}
          description="OTP共有と外部連携導線"
          icon={HeartHandshake}
        />
        <SummaryCard
          title="自己申告"
          value={activeSelfReports.length}
          description="未解消の患者・家族申告"
          icon={MessageSquareWarning}
        />
        <SummaryCard
          title="地域フォロー"
          value={followUps.length}
          description="紹介元・地域活動の要対応"
          icon={Users}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">外部共有管理</CardTitle>
            <CardDescription>患者ごとの共有 grant と閲覧状況を管理します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {grantsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">共有情報を読み込んでいます...</p>
            ) : grants.length === 0 ? (
              <p className="text-sm text-muted-foreground">有効な共有リンクはありません</p>
            ) : (
              grants.map((grant) => (
                <div key={grant.id} className="rounded-xl border border-border/70 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{grant.patient.name}</p>
                      <p className="text-sm text-muted-foreground">
                        共有先: {grant.granted_to_name}
                        {grant.granted_to_contact ? ` / ${grant.granted_to_contact}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {scopeLabels(grant.scope).map((label) => (
                        <Badge key={`${grant.id}-${label}`} variant="outline">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      有効期限: {format(new Date(grant.expires_at), 'yyyy年M月d日 HH:mm', { locale: ja })}
                    </span>
                    <span>{grant.accessed_at ? '閲覧済み' : '未閲覧'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>自己申告 {grant.self_report_summary.total} 件</span>
                    <span>未解決 {grant.self_report_summary.open} 件</span>
                    {grant.self_report_summary.latest_at ? (
                      <span>
                        最新 {format(new Date(grant.self_report_summary.latest_at), 'M/d HH:mm', { locale: ja })}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    <Link
                      href={`/patients/${grant.patient_id}/share`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      詳細を開く
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">自己申告キュー</CardTitle>
              <CardDescription>折返しや triage が必要な申告を確認します</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selfReportsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">自己申告を読み込んでいます...</p>
              ) : activeSelfReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">自己申告はありません</p>
              ) : (
                activeSelfReports.slice(0, 6).map((report) => (
                  <div key={report.id} className="rounded-xl border border-border/70 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{report.subject}</p>
                        <p className="text-sm text-muted-foreground">
                          {report.patient_name ?? '患者不明'} / {report.reported_by_name}
                        </p>
                      </div>
                      <Badge variant="outline">{report.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {report.category}
                      {report.requested_callback ? ' / 折返し希望' : ''}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateSelfReportMutation.mutate({ id: report.id, status: 'triaged' })
                        }
                        disabled={
                          updateSelfReportMutation.isPending || createTaskMutation.isPending
                        }
                      >
                        受理
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => createTaskMutation.mutate(report)}
                        disabled={
                          updateSelfReportMutation.isPending || createTaskMutation.isPending
                        }
                      >
                        タスク化
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          updateSelfReportMutation.mutate({ id: report.id, status: 'resolved' })
                        }
                        disabled={
                          updateSelfReportMutation.isPending || createTaskMutation.isPending
                        }
                      >
                        解決
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">地域活動フォロー</CardTitle>
              <CardDescription>紹介導線と地域活動の後続対応です</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activitiesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">地域活動を読み込んでいます...</p>
              ) : followUps.length === 0 ? (
                <p className="text-sm text-muted-foreground">要フォロー活動はありません</p>
              ) : (
                followUps.map((activity) => (
                  <div key={activity.id} className="rounded-xl border border-border/70 px-4 py-3">
                    <p className="font-medium text-foreground">{activity.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {activity.activity_type}
                      {activity.partner_name ? ` / ${activity.partner_name}` : ''}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      紹介件数: {activity.referrals_generated ?? 0} /
                      実施日: {format(new Date(activity.activity_date), 'yyyy年M月d日', { locale: ja })}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: number;
  description: string;
  icon: ElementType;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
