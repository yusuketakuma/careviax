'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ListTodo, MessageCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Button, buttonVariants } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { CareReportActionPermissions } from '@/types/care-report-permissions';
import {
  buildAudienceShareSections,
  buildNextCheckTaskInput,
  buildShareAudienceCards,
  defaultAudienceForReportType,
  pickLatestAudienceReplyRequest,
  shareAudienceLabel,
  type CareTeamMemberSummary,
  type ContactPartySummary,
  type ShareAudienceKey,
  type ShareCommunicationRequest,
} from './interprofessional-share.helpers';

/**
 * p1_05「他職種向け共有ページ」。
 * 外部公開ビュー(/shared/[token])の発行・閲覧とは別に、薬局側から
 * 「誰に・何が見えるか」をプレビューし、相手からの返信を次回タスクへつなげる画面。
 * 3 カラム: 共有する相手 / 相手に見える内容 / 返信・確認(主操作=次回タスクにする)。
 */

type ShareCareReport = {
  id: string;
  patient_id: string;
  case_id?: string | null;
  report_type: string;
  status: string;
  content: unknown;
  pdf_url: string | null;
  patient_summary?: {
    id: string;
    name: string | null;
  } | null;
  permissions?: CareReportActionPermissions;
};

type ShareReplyDetail = {
  id: string;
  responses: Array<{
    id: string;
    responder_name: string;
    content: string;
    responded_at: string;
  }>;
};

export function InterprofessionalShareContent({ reportId }: { reportId: string }) {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;

  const [selectedAudience, setSelectedAudience] = useState<ShareAudienceKey | null>(null);
  const [createdResponseIds, setCreatedResponseIds] = useState<readonly string[]>([]);

  const reportQuery = useQuery({
    queryKey: ['care-report', reportId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/care-reports/${reportId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書の取得に失敗しました');
      return res.json() as Promise<{ data: ShareCareReport }>;
    },
    enabled: !!orgId && !!reportId,
  });
  const report = reportQuery.data?.data ?? null;
  const patientId = report?.patient_id ?? null;
  const canSendReport = report?.permissions?.can_send === true;
  const canCreateExternalShare = report?.permissions?.can_create_external_share === true;
  const isShareableReportStatus = report
    ? ['confirmed', 'sent', 'response_waiting'].includes(report.status)
    : false;
  const canUseShareOutput = canSendReport && canCreateExternalShare && isShareableReportStatus;
  const canCreateFollowupTask = report?.permissions?.can_create_followup_task === true;
  const canViewPatient = report?.permissions?.can_view_patient === true;
  const canLoadPatientSupport = Boolean(patientId && canViewPatient && canUseShareOutput);

  const careTeamQuery = useQuery({
    queryKey: ['patient-care-team', patientId, report?.case_id, orgId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (report?.case_id) params.set('case_id', report.case_id);
      const res = await fetch(`/api/patients/${patientId}/care-team?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ケアチームの取得に失敗しました');
      return res.json() as Promise<{ data: CareTeamMemberSummary[] }>;
    },
    enabled: !!orgId && canLoadPatientSupport,
  });

  const contactsQuery = useQuery({
    queryKey: ['patient-contacts', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/contacts`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('連絡先の取得に失敗しました');
      return res.json() as Promise<{ data: ContactPartySummary[] }>;
    },
    enabled: !!orgId && canLoadPatientSupport,
  });

  const requestsQuery = useQuery({
    queryKey: ['communication-requests', 'care_report', reportId, orgId],
    queryFn: async () => {
      const params = new URLSearchParams({
        related_entity_type: 'care_report',
        related_entity_id: reportId,
      });
      const res = await fetch(`/api/communication-requests?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('返信状況の取得に失敗しました');
      return res.json() as Promise<{ data: ShareCommunicationRequest[] }>;
    },
    enabled: !!orgId && !!reportId && canUseShareOutput,
  });

  const audience = selectedAudience ?? defaultAudienceForReportType(report?.report_type ?? null);
  const audienceLabel = shareAudienceLabel(audience);
  const audienceCards = buildShareAudienceCards(
    careTeamQuery.data?.data ?? [],
    contactsQuery.data?.data ?? [],
  );
  const sections = buildAudienceShareSections(report?.content ?? null, audience, {
    hasPdf: Boolean(report && canUseShareOutput),
  });
  const replyRequest = pickLatestAudienceReplyRequest(requestsQuery.data?.data ?? [], audience);

  // 一覧 API の responses は本文を含まないため、対象依頼のみ詳細を取得する
  const replyDetailQuery = useQuery({
    queryKey: ['communication-request', replyRequest?.id, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/communication-requests/${replyRequest?.id}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('返信内容の取得に失敗しました');
      return res.json() as Promise<{ data: ShareReplyDetail }>;
    },
    enabled: !!orgId && !!replyRequest?.id && canUseShareOutput,
  });
  const latestReply = replyDetailQuery.data?.data.responses[0] ?? null;
  const taskCreated = Boolean(latestReply && createdResponseIds.includes(latestReply.id));
  const supportingDataErrors = [
    careTeamQuery.isError ? 'ケアチーム' : null,
    contactsQuery.isError ? '患者連絡先' : null,
    canUseShareOutput && requestsQuery.isError ? '返信状況' : null,
    canUseShareOutput && replyDetailQuery.isError ? '返信内容' : null,
  ].filter((label): label is string => Boolean(label));

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!canCreateFollowupTask) {
        throw new Error('運用タスクの作成権限がありません');
      }
      if (!report || !latestReply || !replyRequest) {
        throw new Error('タスク化できる返信がありません');
      }
      const input = buildNextCheckTaskInput({
        audience,
        patientId: report.patient_id,
        patientName: report.patient_summary?.name ?? null,
        reportId: report.id,
        requestId: replyRequest.id,
        response: latestReply,
      });
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as { message?: string } | null)?.message ?? '次回タスクの作成に失敗しました',
        );
      }
      return res.json();
    },
    onSuccess: () => {
      if (latestReply) {
        setCreatedResponseIds((prev) => [...prev, latestReply.id]);
      }
      toast.success('次回訪問の確認タスクを作成しました');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isBootstrappingOrg || reportQuery.isLoading) {
    return (
      <PageScaffold>
        <Loading />
      </PageScaffold>
    );
  }

  if (reportQuery.error) {
    return (
      <PageScaffold>
        <div className="rounded-lg border border-transparent bg-state-confirm/10 p-4 text-state-confirm">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
            報告書を取得できませんでした
          </h1>
          <p className="mt-1 text-sm text-state-confirm">
            通信状態または権限を確認して、再読み込みしてください。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 min-h-[44px] bg-background sm:min-h-0"
            onClick={() => void reportQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      </PageScaffold>
    );
  }

  if (!report) {
    return (
      <PageScaffold>
        <p className="text-sm text-muted-foreground">報告書が見つかりません</p>
      </PageScaffold>
    );
  }

  const patientName = report.patient_summary?.name ?? null;
  const introShortcuts = [
    { href: '/reports', label: '報告書一覧' },
    ...(patientId && canViewPatient ? [{ href: `/patients/${patientId}`, label: '患者詳細' }] : []),
    { href: '/external', label: '外部連携' },
  ];
  const externalShareAction =
    patientId && canViewPatient && canUseShareOutput ? (
      <Link
        href={`/patients/${patientId}/share`}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'min-h-[44px] sm:min-h-0',
        )}
      >
        <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
        外部共有リンクの発行
      </Link>
    ) : null;

  if (!canUseShareOutput) {
    const shareBlockedMessage = !isShareableReportStatus
      ? '下書きの報告書は外部共有できません。薬剤師確認済みまたは送付済みの状態にしてから共有してください。'
      : 'この報告書の外部共有または送付権限がないため、共有プレビューと返信確認は表示できません。';
    return (
      <PageScaffold>
        <div data-testid="interprofessional-share" className="contents">
          <WorkflowPageIntro
            backHref={`/reports/${report.id}`}
            backLabel="報告書詳細へ戻る"
            title="他職種向け共有ページ"
            description={
              patientName
                ? `${patientName} 様の報告内容を相手ごとにプレビューし、返信を次回タスクへつなげます。`
                : '報告内容を相手ごとにプレビューし、返信を次回タスクへつなげます。'
            }
            shortcuts={introShortcuts}
            actions={externalShareAction}
          />
          <div
            className="rounded-lg border border-transparent bg-state-confirm/10 p-4 text-state-confirm"
            data-testid="share-permission-warning"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
              共有内容を表示できません
            </h2>
            <p className="mt-1 text-sm text-state-confirm">{shareBlockedMessage}</p>
          </div>
        </div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold>
      <div data-testid="interprofessional-share" className="contents">
        <WorkflowPageIntro
          backHref={`/reports/${report.id}`}
          backLabel="報告書詳細へ戻る"
          title="他職種向け共有ページ"
          description={
            patientName
              ? `${patientName} 様の報告内容を相手ごとにプレビューし、返信を次回タスクへつなげます。`
              : '報告内容を相手ごとにプレビューし、返信を次回タスクへつなげます。'
          }
          shortcuts={introShortcuts}
          actions={externalShareAction}
        />

        {supportingDataErrors.length > 0 ? (
          <div
            className="rounded-lg border border-transparent bg-state-confirm/10 p-4 text-state-confirm"
            data-testid="share-supporting-data-warning"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
                  一部の共有情報を取得できませんでした
                </h2>
                <p className="mt-1 text-sm text-state-confirm">
                  {supportingDataErrors.join('、')}
                  を取得できないため、登録済み相手や返信の表示が一部欠けています。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px] bg-background sm:min-h-0"
                onClick={() => {
                  if (canLoadPatientSupport) {
                    void careTeamQuery.refetch();
                    void contactsQuery.refetch();
                  }
                  if (canUseShareOutput) {
                    void requestsQuery.refetch();
                  }
                  if (canUseShareOutput && replyRequest?.id) {
                    void replyDetailQuery.refetch();
                  }
                }}
              >
                再取得
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          {/* 左: 共有する相手 */}
          <section
            aria-labelledby="share-audience-heading"
            data-testid="share-audience-column"
            className="rounded-lg border border-border/70 bg-card p-4"
          >
            <h2 id="share-audience-heading" className="text-base font-bold text-foreground">
              共有する相手
            </h2>
            <ul className="mt-3 space-y-2.5" role="list">
              {audienceCards.map((card) => {
                const active = card.key === audience;
                return (
                  <li key={card.key}>
                    <button
                      type="button"
                      data-testid="share-audience-card"
                      data-audience={card.key}
                      aria-pressed={active}
                      onClick={() => setSelectedAudience(card.key)}
                      className={cn(
                        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                        'min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        active
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background hover:bg-muted/40',
                      )}
                    >
                      <span className="block text-sm font-bold text-foreground">{card.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {card.memberLabel ?? 'ケアチーム未登録'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 中央: 相手に見える内容 */}
          <section
            aria-labelledby="share-preview-heading"
            data-testid="share-preview-column"
            className="rounded-lg border border-border/70 bg-card p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="share-preview-heading" className="text-base font-bold text-foreground">
                相手に見える内容
              </h2>
              <p className="text-xs text-muted-foreground">選択中: {audienceLabel}向けプレビュー</p>
            </div>
            <div className="mt-3 space-y-3">
              {sections.map((section) => (
                <article
                  key={section.key}
                  data-testid="share-preview-section"
                  className="rounded-lg border border-border/70 bg-background px-4 py-3"
                >
                  <h3 className="text-sm font-bold text-foreground">{section.title}</h3>
                  <p
                    className={cn(
                      'mt-1 whitespace-pre-line text-sm leading-6',
                      section.isEmpty ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {section.body}
                  </p>
                </article>
              ))}
            </div>
          </section>

          {/* 右: 返信・確認 */}
          <section
            aria-labelledby="share-reply-heading"
            data-testid="share-reply-column"
            className="rounded-lg border border-border/70 bg-card p-4"
          >
            <h2 id="share-reply-heading" className="text-base font-bold text-foreground">
              返信・確認
            </h2>
            <h3 className="mt-3 flex items-center gap-1.5 text-sm font-bold text-foreground">
              <MessageCircle className="size-4 text-primary" aria-hidden="true" />
              {audienceLabel}からの返信
            </h3>

            {latestReply ? (
              <div
                data-testid="share-reply-card"
                className="mt-2.5 rounded-lg border border-border/70 bg-background px-4 py-3"
              >
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">
                  {latestReply.content}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {latestReply.responder_name} —{' '}
                  {format(new Date(latestReply.responded_at), 'M月d日(E) HH:mm', { locale: ja })}
                </p>
              </div>
            ) : (
              <div
                data-testid="share-reply-empty"
                className="mt-2.5 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-center"
              >
                <p className="text-sm text-muted-foreground">返信はまだありません。</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  返信が届くと、内容を確認して次回訪問のタスクにできます。
                </p>
              </div>
            )}

            <Button
              type="button"
              data-testid="share-next-task-button"
              className="mt-4 min-h-[44px] w-full"
              disabled={
                !canCreateFollowupTask ||
                !latestReply ||
                createTaskMutation.isPending ||
                taskCreated
              }
              onClick={() => createTaskMutation.mutate()}
            >
              {taskCreated ? (
                <>
                  <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                  次回タスク作成済み
                </>
              ) : (
                <>
                  <ListTodo className="mr-1.5 size-4" aria-hidden="true" />
                  {createTaskMutation.isPending ? '作成中...' : '次回タスクにする'}
                </>
              )}
            </Button>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {canCreateFollowupTask
                ? '返信内容を次回訪問の確認タスク(運用タスク)として登録します。登録後はダッシュボードのタスク一覧に表示されます。'
                : '運用タスクの作成権限がないため、返信内容は閲覧のみできます。'}
            </p>
          </section>
        </div>
      </div>
    </PageScaffold>
  );
}
