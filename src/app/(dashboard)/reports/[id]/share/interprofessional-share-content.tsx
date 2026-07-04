'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ListTodo, MessageCircle, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Button, buttonVariants } from '@/components/ui/button';
import { StateBadge } from '@/components/ui/state-badge';
import { Skeleton } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readApiJson } from '@/lib/api/client-json';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildCommunicationRequestApiPath,
  buildCommunicationRequestsApiPath,
} from '@/lib/communications/api-paths';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildCareReportApiPath } from '@/lib/reports/api-paths';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildTasksApiPath } from '@/lib/tasks/api-paths';
import { messageFromError } from '@/lib/utils/error-message';
import type { PatientArchiveSummary } from '@/lib/patient/archive-summary';
import type { CareReportActionPermissions } from '@/types/care-report-permissions';
import {
  buildAudienceShareSections,
  buildNextCheckTaskInput,
  buildShareCommunicationRequestInput,
  buildShareAudienceCards,
  defaultAudienceForReportType,
  pickLatestAudienceRequest,
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
  updated_at: string;
  status: string;
  content: unknown;
  pdf_url: string | null;
  patient_summary?: {
    id: string;
    name: string | null;
    archive?: PatientArchiveSummary | null;
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

type CreateCommunicationRequestResponse = {
  data?: {
    id?: string;
    status?: string;
  };
};

function tryBuildPatientHref(patientId: string, suffix = ''): string | null {
  try {
    return suffix ? buildPatientHref(patientId, suffix) : buildPatientHref(patientId);
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
}

function canBuildPatientApiPath(patientId: string): boolean {
  try {
    buildPatientApiPath(patientId);
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

function ArchivedPatientShareNotice({
  archive,
  patientName,
}: {
  archive?: PatientArchiveSummary | null;
  patientName: string | null;
}) {
  if (!archive?.archived) return null;
  return (
    <div className="rounded-lg border-l-4 border-border/70 border-l-state-blocked bg-card p-4 text-sm text-state-blocked">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge role="readonly" className="font-bold">
          アーカイブ中
        </StateBadge>
        <p className="font-semibold">
          {patientName ? `${patientName} 様は` : 'この患者は'}閲覧専用の患者正本です。
        </p>
      </div>
      <p className="mt-1 text-xs leading-5 text-state-blocked/90">
        復元するまで新規作業・共有・更新には使わないでください。外部共有の発行前に、対象患者と共有目的を再確認してください。
      </p>
    </div>
  );
}

function InterprofessionalShareLoadingState() {
  return (
    <PageScaffold>
      <div
        className="space-y-6"
        role="status"
        aria-label="他職種共有ワークスペースを読み込み中"
        aria-live="polite"
      >
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
            <Skeleton className="h-5 w-28" />
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-background px-4 py-3"
                >
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-2 h-3 w-36" />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-44" />
            </div>
            <div className="mt-3 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border/70 bg-background px-4 py-3"
                >
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-5/6" />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-4 h-4 w-36" />
            <div className="mt-2.5 rounded-lg border border-border/70 bg-background px-4 py-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-40" />
            </div>
            <Skeleton className="mt-4 h-10 w-full rounded-md" />
            <Skeleton className="mt-3 h-10 w-full rounded-md" />
          </section>
        </div>
        <span className="sr-only">他職種共有ワークスペースを読み込み中</span>
      </div>
    </PageScaffold>
  );
}

export function InterprofessionalShareContent({ reportId }: { reportId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const isBootstrappingOrg = !orgId;

  const [selectedAudience, setSelectedAudience] = useState<ShareAudienceKey | null>(null);
  const [createdResponseIds, setCreatedResponseIds] = useState<readonly string[]>([]);
  const [createdRequestAudiences, setCreatedRequestAudiences] = useState<
    readonly ShareAudienceKey[]
  >([]);
  const [createdRequestIdsByAudience, setCreatedRequestIdsByAudience] = useState<
    Partial<Record<ShareAudienceKey, string>>
  >({});

  const reportQuery = useQuery({
    queryKey: ['care-report', reportId, orgId],
    queryFn: async () => {
      const res = await fetch(buildCareReportApiPath(reportId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: ShareCareReport }>(res, '報告書の取得に失敗しました');
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
  const canUsePatientApiPath = patientId ? canBuildPatientApiPath(patientId) : false;
  const canLoadPatientSupport = Boolean(
    patientId && canUsePatientApiPath && canViewPatient && canUseShareOutput,
  );

  const careTeamQuery = useQuery({
    queryKey: ['patient-care-team', patientId, report?.case_id, orgId],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDがありません');
      const params = new URLSearchParams();
      if (report?.case_id) params.set('case_id', report.case_id);
      const res = await fetch(
        `${buildPatientApiPath(patientId, '/care-team')}?${params.toString()}`,
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      return readApiJson<{ data: CareTeamMemberSummary[] }>(res, 'ケアチームの取得に失敗しました');
    },
    enabled: !!orgId && canLoadPatientSupport,
  });

  const contactsQuery = useQuery({
    queryKey: ['patient-contacts', patientId, orgId],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDがありません');
      const res = await fetch(buildPatientApiPath(patientId, '/contacts'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: ContactPartySummary[] }>(res, '連絡先の取得に失敗しました');
    },
    enabled: !!orgId && canLoadPatientSupport,
  });

  const requestsQuery = useQuery({
    queryKey: ['communication-requests', 'care_report', reportId, orgId],
    queryFn: async () => {
      const res = await fetch(
        buildCommunicationRequestsApiPath({
          requestType: 'care_report_reply_request',
          relatedEntityType: 'care_report',
          relatedEntityId: reportId,
        }),
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      return readApiJson<{ data: ShareCommunicationRequest[] }>(
        res,
        '返信状況の取得に失敗しました',
      );
    },
    enabled: !!orgId && !!reportId && canUseShareOutput,
  });

  const audience = selectedAudience ?? defaultAudienceForReportType(report?.report_type ?? null);
  const audienceLabel = shareAudienceLabel(audience);
  const audienceCards = buildShareAudienceCards(
    careTeamQuery.data?.data ?? [],
    contactsQuery.data?.data ?? [],
  );
  const selectedAudienceCard = audienceCards.find((card) => card.key === audience) ?? null;
  const sections = buildAudienceShareSections(report?.content ?? null, audience, {
    hasPdf: Boolean(report && canUseShareOutput),
  });
  const audienceRequest = pickLatestAudienceRequest(requestsQuery.data?.data ?? [], audience);
  const replyRequest = pickLatestAudienceReplyRequest(requestsQuery.data?.data ?? [], audience);

  // 一覧 API の responses は本文を含まないため、対象依頼のみ詳細を取得する
  const replyDetailQuery = useQuery({
    queryKey: ['communication-request', replyRequest?.id, orgId],
    queryFn: async () => {
      const requestId = replyRequest?.id;
      if (!requestId) throw new Error('返信依頼IDがありません');
      const res = await fetch(buildCommunicationRequestApiPath(requestId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: ShareReplyDetail }>(res, '返信内容の取得に失敗しました');
    },
    enabled: !!orgId && !!replyRequest?.id && canUseShareOutput,
  });
  const latestReply = replyDetailQuery.data?.data.responses[0] ?? null;
  const taskCreated = Boolean(latestReply && createdResponseIds.includes(latestReply.id));
  const requestCreated = createdRequestAudiences.includes(audience);
  const activeAudienceRequest =
    audienceRequest && audienceRequest.status !== 'closed' ? audienceRequest : null;
  const hasActiveAudienceRequest = Boolean(activeAudienceRequest);
  const focusedReplyRequestId =
    activeAudienceRequest?.id ?? createdRequestIdsByAudience[audience] ?? null;
  const replyRequestQueueHref = focusedReplyRequestId
    ? buildCommunicationRequestsHref({
        status: activeAudienceRequest?.status ?? 'sent',
        requestType: 'care_report_reply_request',
        patientId,
        requestId: focusedReplyRequestId,
        relatedEntityType: 'care_report',
        relatedEntityId: report?.id ?? reportId,
      })
    : null;
  const supportingDataErrors = [
    patientId && canViewPatient && !canUsePatientApiPath ? '患者リンク' : null,
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
      const res = await fetch(buildTasksApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
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
    onError: (err: Error) => toast.error(messageFromError(err, '次回タスクの作成に失敗しました')),
  });

  const createReplyRequestMutation = useMutation({
    mutationFn: async () => {
      if (!report || !patientId) {
        throw new Error('報告書または患者情報を取得できませんでした');
      }
      if (!selectedAudienceCard?.recipientName) {
        throw new Error('共有相手が未登録です');
      }
      if (requestsQuery.isLoading || requestsQuery.isError) {
        throw new Error('返信状況を確認してから起票してください');
      }
      if (hasActiveAudienceRequest || requestCreated) {
        throw new Error('この相手への返信依頼は既に起票されています');
      }
      const input = buildShareCommunicationRequestInput({
        audience,
        patientId,
        caseId: report.case_id,
        patientName: report.patient_summary?.name ?? null,
        reportId: report.id,
        reportType: report.report_type,
        reportUpdatedAt: report.updated_at,
        recipientName: selectedAudienceCard.recipientName,
        recipientOrganizationName: selectedAudienceCard.recipientOrganizationName,
        sections,
      });
      const res = await fetch(buildCommunicationRequestsApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as { message?: string } | null)?.message ?? '返信依頼の起票に失敗しました',
        );
      }
      return res.json() as Promise<CreateCommunicationRequestResponse>;
    },
    onSuccess: async (result?: CreateCommunicationRequestResponse) => {
      setCreatedRequestAudiences((prev) => [...prev, audience]);
      const createdRequestId = result?.data?.id?.trim();
      if (createdRequestId) {
        setCreatedRequestIdsByAudience((prev) => ({
          ...prev,
          [audience]: createdRequestId,
        }));
      }
      toast.success('返信依頼を起票しました');
      await queryClient.invalidateQueries({
        queryKey: ['communication-requests', 'care_report', reportId, orgId],
      });
    },
    onError: (err: Error) => toast.error(messageFromError(err, '返信依頼の起票に失敗しました')),
  });

  if (isBootstrappingOrg || reportQuery.isLoading) {
    return <InterprofessionalShareLoadingState />;
  }

  if (reportQuery.error) {
    return (
      <PageScaffold>
        <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-4 text-state-confirm">
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
            className="mt-3 bg-background"
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
  const patientArchive = report.patient_summary?.archive ?? null;
  const patientDetailHref = patientId && canViewPatient ? tryBuildPatientHref(patientId) : null;
  const patientShareHref =
    patientId && canViewPatient && canUseShareOutput
      ? tryBuildPatientHref(patientId, '/share')
      : null;
  const introShortcuts = [
    { href: '/reports', label: '報告書一覧' },
    ...(patientDetailHref ? [{ href: patientDetailHref, label: '患者詳細' }] : []),
    { href: '/external', label: '外部連携' },
  ];
  const externalShareAction = patientShareHref ? (
    <Link
      href={patientShareHref}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-[44px] sm:min-h-0')}
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
            backHref={buildReportHref(report.id)}
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
          <ArchivedPatientShareNotice archive={patientArchive} patientName={patientName} />
          <div
            className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-4 text-state-confirm"
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
          backHref={buildReportHref(report.id)}
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

        <ArchivedPatientShareNotice archive={patientArchive} patientName={patientName} />

        {supportingDataErrors.length > 0 ? (
          <div
            className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-4 text-state-confirm"
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
                className="bg-background"
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

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
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
              variant="outline"
              data-testid="share-create-request-button"
              className="mt-4 w-full bg-background"
              disabled={
                !selectedAudienceCard?.recipientName ||
                requestsQuery.isLoading ||
                requestsQuery.isError ||
                createReplyRequestMutation.isPending ||
                hasActiveAudienceRequest ||
                requestCreated
              }
              onClick={() => createReplyRequestMutation.mutate()}
            >
              {hasActiveAudienceRequest || requestCreated ? (
                <>
                  <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                  返信依頼起票済み
                </>
              ) : (
                <>
                  <Send className="mr-1.5 size-4" aria-hidden="true" />
                  {createReplyRequestMutation.isPending ? '起票中...' : '返信依頼を起票'}
                </>
              )}
            </Button>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {!selectedAudienceCard?.recipientName
                ? 'ケアチームまたは連絡先に共有相手を登録すると、返信依頼を起票できます。'
                : requestsQuery.isError
                  ? '返信状況を取得できないため、重複防止のため起票を停止しています。'
                  : hasActiveAudienceRequest || requestCreated
                    ? 'この相手への返信依頼は既に連携依頼キューにあります。'
                    : '選択中の相手に、表示中の共有内容を確認してもらう返信待ち依頼を作成します。'}
            </p>
            {replyRequestQueueHref ? (
              <Link
                href={replyRequestQueueHref}
                data-testid="share-open-request-link"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'mt-3 w-full bg-background',
                )}
              >
                <MessageCircle className="mr-1.5 size-4" aria-hidden="true" />
                連携依頼を開く
              </Link>
            ) : null}

            <Button
              type="button"
              data-testid="share-next-task-button"
              className="mt-4 w-full"
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
