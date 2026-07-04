'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ExternalLink, HeartHandshake, MessageSquareWarning, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { StatCard } from '@/components/ui/stat-card';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { SELF_REPORT_STATUS_LABELS } from '@/lib/constants/status-labels';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';
import type { ExternalFocus } from '@/lib/dashboard/home-link-builders';

type ExternalGrant = {
  id: string;
  patient_id: string;
  patient: { name: string };
  granted_to_name: string;
  granted_to_contact_masked: string | null;
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
  reported_by_name: string | null;
  requested_callback: boolean;
  created_at: string;
  updated_at: string;
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

export function ExternalViewerContent({
  initialFocus,
  initialContext,
}: {
  initialFocus?: ExternalFocus;
  initialContext?: string | null;
} = {}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const grantsQuery = useQuery({
    queryKey: ['external-access-grants', orgId],
    queryFn: async () => {
      const response = await fetch('/api/external-access', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: ExternalGrant[] }>(response, '外部共有の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const selfReportsQuery = useQuery({
    queryKey: ['patient-self-reports', orgId, 'external-dashboard'],
    queryFn: async () => {
      const response = await fetch('/api/patient-self-reports?limit=12', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: SelfReport[] }>(response, '自己申告の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const activitiesQuery = useQuery({
    queryKey: ['community-activities', orgId, 'follow-up'],
    queryFn: async () => {
      const response = await fetch('/api/community-activities?limit=8&follow_up_required=true', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: CommunityActivity[] }>(response, '地域活動の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const grants = grantsQuery.data?.data ?? [];
  const selfReports = selfReportsQuery.data?.data ?? [];
  const activeSelfReports = selfReports.filter(
    (item) => item.status !== 'resolved' && item.status !== 'dismissed',
  );
  const followUps = (activitiesQuery.data?.data ?? []).filter((item) => item.follow_up_required);
  const contextSummary =
    initialContext === 'dashboard_home'
      ? initialFocus === 'self_reports'
        ? 'ホームから自己申告キューにフォーカスして開いています。'
        : initialFocus === 'activities'
          ? 'ホームから地域活動フォローにフォーカスして開いています。'
          : 'ホームから外部共有管理にフォーカスして開いています。'
      : null;

  const updateSelfReportMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      updated_at,
    }: {
      id: string;
      status: 'triaged' | 'resolved' | 'dismissed' | 'converted_to_task';
      updated_at: string;
    }) => {
      const response = await fetch(`/api/patient-self-reports/${id}`, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ status, updated_at }),
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
    onError: (error: Error) => toast.error(messageFromError(error, '自己申告の更新に失敗しました')),
  });

  const createTaskMutation = useMutation({
    mutationFn: async (report: SelfReport) => {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          task_type: 'patient_self_report_followup',
          title: `${report.patient_name ?? '患者'}: ${report.subject}`,
          description: `${report.category}\n${report.reported_by_name ?? '報告者非表示'}${report.requested_callback ? '\n折返し希望あり' : ''}`,
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
        updated_at: report.updated_at,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      toast.success('自己申告をタスク化しました');
    },
    onError: (error: Error) => toast.error(messageFromError(error, 'タスク作成に失敗しました')),
  });

  const shareCard = (
    <ExternalPanelCard
      key="shares"
      active={initialFocus === 'shares'}
      title="外部共有管理"
      description="患者ごとの共有 grant と閲覧状況を管理します"
    >
      <PanelBody
        isLoading={grantsQuery.isLoading}
        isError={grantsQuery.isError}
        isEmpty={grants.length === 0}
        emptyText="有効な共有リンクはありません"
        errorTitle="外部共有を表示できません"
        onRetry={() => void grantsQuery.refetch()}
      >
        {grants.map((grant) => (
          <div key={grant.id} className="rounded-lg border border-border/70 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{grant.patient.name}</p>
                <p className="text-sm text-muted-foreground">
                  共有先: {grant.granted_to_name}
                  {grant.granted_to_contact_masked ? ` / ${grant.granted_to_contact_masked}` : ''}
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
                  最新{' '}
                  {format(new Date(grant.self_report_summary.latest_at), 'M/d HH:mm', {
                    locale: ja,
                  })}
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <Link
                href={`/patients/${grant.patient_id}/share`}
                className="inline-flex min-h-11 min-w-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                詳細を開く
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        ))}
      </PanelBody>
    </ExternalPanelCard>
  );
  const selfReportCard = (
    <ExternalPanelCard
      key="self_reports"
      active={initialFocus === 'self_reports'}
      title="自己申告キュー"
      description="折返しや triage が必要な申告を確認します"
      testId="external-self-report-queue"
    >
      <PanelBody
        isLoading={selfReportsQuery.isLoading}
        isError={selfReportsQuery.isError}
        isEmpty={activeSelfReports.length === 0}
        emptyText="自己申告はありません"
        errorTitle="自己申告を表示できません"
        onRetry={() => void selfReportsQuery.refetch()}
      >
        {activeSelfReports.slice(0, 6).map((report) => (
          <div key={report.id} className="rounded-lg border border-border/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{report.subject}</p>
                <p className="text-sm text-muted-foreground">
                  {report.patient_name ?? '患者不明'} / {report.reported_by_name ?? '報告者非表示'}
                </p>
              </div>
              <Badge variant="outline">
                {SELF_REPORT_STATUS_LABELS[report.status] ?? report.status}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {report.category}
              {report.requested_callback ? ' / 折返し希望' : ''}
            </p>
            <ActionRail align="start" className="mt-3">
              <Button
                size="sm"
                variant="outline"
                className="sm:h-11 sm:min-h-[44px]"
                onClick={() =>
                  updateSelfReportMutation.mutate({
                    id: report.id,
                    status: 'triaged',
                    updated_at: report.updated_at,
                  })
                }
                disabled={updateSelfReportMutation.isPending || createTaskMutation.isPending}
              >
                受理
              </Button>
              <Button
                size="sm"
                className="sm:h-11 sm:min-h-[44px]"
                onClick={() => createTaskMutation.mutate(report)}
                disabled={updateSelfReportMutation.isPending || createTaskMutation.isPending}
              >
                タスク化
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="sm:h-11 sm:min-h-[44px]"
                onClick={() =>
                  updateSelfReportMutation.mutate({
                    id: report.id,
                    status: 'resolved',
                    updated_at: report.updated_at,
                  })
                }
                disabled={updateSelfReportMutation.isPending || createTaskMutation.isPending}
              >
                解決
              </Button>
            </ActionRail>
          </div>
        ))}
      </PanelBody>
    </ExternalPanelCard>
  );
  const activityCard = (
    <ExternalPanelCard
      key="activities"
      active={initialFocus === 'activities'}
      title="地域活動フォロー"
      description="紹介導線と地域活動の後続対応です"
    >
      <PanelBody
        isLoading={activitiesQuery.isLoading}
        isError={activitiesQuery.isError}
        isEmpty={followUps.length === 0}
        emptyText="要フォロー活動はありません"
        errorTitle="地域活動を表示できません"
        onRetry={() => void activitiesQuery.refetch()}
      >
        {followUps.map((activity) => (
          <div key={activity.id} className="rounded-lg border border-border/70 px-4 py-3">
            <p className="font-medium text-foreground">{activity.title}</p>
            <p className="text-sm text-muted-foreground">
              {activity.activity_type}
              {activity.partner_name ? ` / ${activity.partner_name}` : ''}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              紹介件数: {activity.referrals_generated ?? 0} / 実施日:{' '}
              {format(new Date(activity.activity_date), 'yyyy年M月d日', { locale: ja })}
            </p>
          </div>
        ))}
      </PanelBody>
    </ExternalPanelCard>
  );
  const panelOrder: Record<NonNullable<ExternalFocus>, ReactNode[]> = {
    self_reports: [selfReportCard, shareCard, activityCard],
    activities: [activityCard, shareCard, selfReportCard],
    shares: [shareCard, selfReportCard, activityCard],
  };
  const orderedPanels = initialFocus ? panelOrder[initialFocus] : panelOrder.shares;

  return (
    <div className="space-y-6">
      {contextSummary ? (
        <Alert
          className="border-tag-info/30 bg-tag-info/10 text-tag-info"
          data-testid="external-context-banner"
        >
          <HeartHandshake className="size-4 text-tag-info" aria-hidden="true" />
          <AlertDescription className="text-tag-info">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <PageSection
        title="外部連携サマリー"
        description="有効な共有、未解消の自己申告、地域フォローを先に把握する導入グループです。"
        contentClassName="grid grid-cols-3 gap-2 sm:gap-4"
      >
        <StatCard
          label="有効な共有"
          value={grantsQuery.isError ? '—' : grants.length.toLocaleString('ja-JP')}
          hint={grantsQuery.isError ? '取得に失敗しました' : 'OTP共有と外部連携導線'}
          hintClassName="hidden sm:block"
          icon={<HeartHandshake className="size-4" aria-hidden="true" />}
          iconClassName="hidden sm:inline-flex"
          role={grantsQuery.isError ? 'blocked' : undefined}
          className="min-w-0"
        />
        <StatCard
          label="自己申告"
          value={selfReportsQuery.isError ? '—' : activeSelfReports.length.toLocaleString('ja-JP')}
          hint={selfReportsQuery.isError ? '取得に失敗しました' : '未解消の患者・家族申告'}
          hintClassName="hidden sm:block"
          icon={<MessageSquareWarning className="size-4" aria-hidden="true" />}
          iconClassName="hidden sm:inline-flex"
          role={
            selfReportsQuery.isError
              ? 'blocked'
              : activeSelfReports.length > 0
                ? 'confirm'
                : undefined
          }
          className="min-w-0"
        />
        <StatCard
          label="地域フォロー"
          value={activitiesQuery.isError ? '—' : followUps.length.toLocaleString('ja-JP')}
          hint={activitiesQuery.isError ? '取得に失敗しました' : '紹介元・地域活動の要対応'}
          hintClassName="hidden sm:block"
          icon={<Users className="size-4" aria-hidden="true" />}
          iconClassName="hidden sm:inline-flex"
          role={activitiesQuery.isError ? 'blocked' : followUps.length > 0 ? 'confirm' : undefined}
          className="min-w-0"
        />
      </PageSection>

      <PageSection
        title="共有とフォロー"
        description="共有 grant、自己申告キュー、地域活動フォローを役割ごとに分けて確認します。"
        contentClassName="grid gap-4 xl:grid-cols-[1fr_1fr_0.9fr]"
        data-testid="external-work-queue"
      >
        {orderedPanels}
      </PageSection>
    </div>
  );
}

function PanelBody({
  isLoading,
  isError,
  isEmpty,
  emptyText,
  errorTitle,
  onRetry,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyText: string;
  errorTitle: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="外部連携パネルを読み込み中">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        variant="server"
        size="inline"
        title={errorTitle}
        description="データの取得に失敗しました。再試行してください。"
        onRetry={onRetry}
        live="polite"
      />
    );
  }
  if (isEmpty) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return <>{children}</>;
}

function ExternalPanelCard({
  active,
  title,
  description,
  testId,
  children,
}: {
  active: boolean;
  title: string;
  description: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0', active ? 'ring-2 ring-primary/25' : null)} data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
