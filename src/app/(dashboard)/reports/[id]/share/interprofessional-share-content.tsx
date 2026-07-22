'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ListTodo, MessageCircle, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import {
  PatientWriteAvailabilityNotice,
  PATIENT_WRITE_AVAILABILITY_DESCRIPTION_ID,
} from '@/components/features/patients/patient-write-availability-notice';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readApiJson } from '@/lib/api/client-json';
import {
  canRetainCachedDataAfterPrimaryQueryError,
  fetchPrimaryQueryJson,
} from '@/lib/api/primary-query-json';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { cn } from '@/lib/utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildCommunicationRequestApiPath,
  buildCommunicationRequestsApiPath,
} from '@/lib/communications/api-paths';
import { fetchAllShareCommunicationRequests } from '@/lib/communications/share-workspace-client';
import {
  buildShareCareTeamResponseSchema,
  buildShareContactsResponseSchema,
  buildShareReplyDetailResponseSchema,
  type ShareCareTeamResponse,
  type ShareContactsResponse,
  type ShareReplyDetailResponse,
} from '@/lib/communications/share-workspace-response-schemas';
import {
  createCommunicationRequestResponseSchema,
  type CreateCommunicationRequestResponse,
} from '@/lib/communications/response-schemas';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { isActiveReplyRequestStatus } from '@/lib/communications/request-status';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import {
  isPatientArchiveWritable,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
} from '@/lib/patient/archive-summary';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildCareReportApiPath } from '@/lib/reports/api-paths';
import { buildReportHref } from '@/lib/reports/navigation';
import { isShareableCareReportStatus } from '@/lib/reports/shareability';
import { buildTasksApiPath } from '@/lib/tasks/api-paths';
import { clientLog } from '@/lib/utils/client-log';
import {
  buildAudienceShareSections,
  buildNextCheckTaskInput,
  buildShareCommunicationRequestInput,
  buildShareAudienceCards,
  defaultAudienceForReportType,
  pickLatestAudienceRequest,
  pickLatestAudienceReplyRequest,
  shareAudienceLabel,
  type ShareAudienceKey,
} from './interprofessional-share.helpers';
import { buildInterprofessionalShareReportResponseSchema } from './interprofessional-share-response-schema';
import { InterprofessionalShareLoadingState } from './interprofessional-share-loading-state';
import {
  FOLLOWUP_TASK_CONFLICT_MESSAGE,
  FOLLOWUP_TASK_DESCRIPTION_ID,
  FOLLOWUP_TASK_FAILURE_MESSAGE,
  FOLLOWUP_TASK_PERMISSION_MESSAGE,
  REPLY_REQUEST_CONFLICT_MESSAGE,
  REPLY_REQUEST_FAILURE_MESSAGE,
  ShareMutationResponseError,
  getShareMutationResponseStatus,
  isDuplicateShareMutationConflict,
  isPatientArchivedWriteError,
  readShareMutationResponse,
  shouldReconcileFollowupTaskPermission,
  type FollowupTaskMutationInput,
  type ReplyRequestMutationInput,
} from './interprofessional-share-mutation';

/**
 * p1_05「他職種向け共有ページ」。
 * 外部公開ビュー(/shared/[token])の発行・閲覧とは別に、薬局側から
 * 「誰に・何が見えるか」をプレビューし、相手からの返信を次回タスクへつなげる画面。
 * 3 カラム: 共有する相手 / 相手に見える内容 / 返信・確認(主操作=次回タスクにする)。
 */

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

export function InterprofessionalShareContent({ reportId }: { reportId: string }) {
  const orgId = useOrgId();
  const currentUserId = useAuthStore((state) => state.currentUser.id);
  const currentUserRole = useAuthStore((state) => state.currentUser.role);
  return (
    <InterprofessionalShareWorkspace
      key={JSON.stringify([orgId, reportId, currentUserId, currentUserRole])}
      reportId={reportId}
      orgId={orgId}
      currentUserId={currentUserId}
      currentUserRole={currentUserRole}
    />
  );
}

function InterprofessionalShareWorkspace({
  reportId,
  orgId,
  currentUserId,
  currentUserRole,
}: {
  reportId: string;
  orgId: string;
  currentUserId: string | null;
  currentUserRole: string | null;
}) {
  const queryClient = useQueryClient();
  const isBootstrappingAuthorization = !orgId || !currentUserId || !currentUserRole;

  const [selectedAudience, setSelectedAudience] = useState<ShareAudienceKey | null>(null);
  const [createdResponseIds, setCreatedResponseIds] = useState<readonly string[]>([]);
  const [createdRequestAudiences, setCreatedRequestAudiences] = useState<
    readonly ShareAudienceKey[]
  >([]);
  const [createdRequestIdsByAudience, setCreatedRequestIdsByAudience] = useState<
    Partial<Record<ShareAudienceKey, string>>
  >({});
  const [archiveConflictDetected, setArchiveConflictDetected] = useState(false);
  const [followupEligibilityRecoveryPending, setFollowupEligibilityRecoveryPending] =
    useState(false);

  const reportQuery = useQuery({
    queryKey: ['care-report', reportId, orgId, currentUserId, currentUserRole],
    queryFn: async () => {
      return fetchPrimaryQueryJson(
        () =>
          fetch(buildCareReportApiPath(reportId), {
            headers: buildOrgHeaders(orgId),
            cache: 'no-store',
          }),
        {
          fallbackMessage: '報告書の取得に失敗しました',
          schema: buildInterprofessionalShareReportResponseSchema(reportId),
        },
      );
    },
    enabled: !isBootstrappingAuthorization && !!reportId,
  });
  const canRetainCachedReport =
    reportQuery.isRefetchError && canRetainCachedDataAfterPrimaryQueryError(reportQuery.error);
  const report = reportQuery.data?.data ?? null;
  const patientId = report?.patient_id ?? null;
  const patientArchive = report?.patient_summary?.archive ?? null;
  const effectivePatientArchive =
    archiveConflictDetected || followupEligibilityRecoveryPending || canRetainCachedReport
      ? null
      : patientArchive;
  const isPatientWritable = isPatientArchiveWritable(effectivePatientArchive);

  async function reconcilePatientArchiveAfterConflict() {
    setArchiveConflictDetected(true);
    const refreshed = await reportQuery.refetch().catch(() => null);
    if (refreshed?.isSuccess && refreshed.data.data.patient_summary?.archive) {
      setArchiveConflictDetected(false);
    }
  }

  async function reconcileFollowupEligibilityAfterRejection() {
    setFollowupEligibilityRecoveryPending(true);
    const refreshed = await reportQuery.refetch().catch(() => null);
    if (refreshed?.isSuccess) {
      setFollowupEligibilityRecoveryPending(false);
    }
  }
  const canSendReport = report?.permissions?.can_send === true;
  const canCreateExternalShare = report?.permissions?.can_create_external_share === true;
  const isShareableReportStatus = report ? isShareableCareReportStatus(report.status) : false;
  const canUseShareOutput = canSendReport && canCreateExternalShare && isShareableReportStatus;
  const canCreateFollowupTask = report?.permissions?.can_create_followup_task === true;
  const canViewPatient = report?.permissions?.can_view_patient === true;
  const canUsePatientApiPath = patientId ? canBuildPatientApiPath(patientId) : false;
  const canLoadPatientSupport = Boolean(
    patientId && canUsePatientApiPath && canViewPatient && canUseShareOutput,
  );

  const careTeamQuery = useQuery({
    queryKey: [
      'patient-care-team',
      patientId,
      report?.case_id,
      orgId,
      currentUserId,
      currentUserRole,
    ],
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
      return readApiJson<ShareCareTeamResponse>(res, {
        fallbackMessage: 'ケアチームの取得に失敗しました',
        schema: buildShareCareTeamResponseSchema({
          expectedPatientId: patientId,
          // Legacy case-less reports intentionally use the patient's default active case
          // for recipient discovery; patient_id still binds the response to this report.
          expectedCaseId: report?.case_id ?? undefined,
        }),
      });
    },
    enabled: !isBootstrappingAuthorization && canLoadPatientSupport,
  });

  const contactsQuery = useQuery({
    queryKey: ['patient-contacts', patientId, orgId, currentUserId, currentUserRole],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDがありません');
      const res = await fetch(buildPatientApiPath(patientId, '/contacts'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<ShareContactsResponse>(res, {
        fallbackMessage: '連絡先の取得に失敗しました',
        schema: buildShareContactsResponseSchema(patientId),
      });
    },
    enabled: !isBootstrappingAuthorization && canLoadPatientSupport,
  });

  const requestsQuery = useQuery({
    queryKey: [
      'communication-requests',
      'care_report',
      reportId,
      orgId,
      currentUserId,
      currentUserRole,
    ],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDがありません');
      return fetchAllShareCommunicationRequests({
        orgId,
        scope: {
          expectedPatientId: patientId,
          expectedRequestType: 'care_report_reply_request',
          expectedRelatedEntityType: 'care_report',
          expectedRelatedEntityId: reportId,
        },
        errorMessage: '返信状況の取得に失敗しました',
      });
    },
    enabled: !isBootstrappingAuthorization && !!reportId && !!patientId && canUseShareOutput,
  });

  const audience = selectedAudience ?? defaultAudienceForReportType(report?.report_type ?? null);
  const audienceLabel = shareAudienceLabel(audience);
  const audienceCards = buildShareAudienceCards(
    careTeamQuery.data?.data ?? [],
    contactsQuery.data?.data ?? [],
  );
  const selectedAudienceCard = audienceCards.find((card) => card.key === audience) ?? null;
  const sections = buildAudienceShareSections(report?.content ?? null, audience, {
    hasPdf: Boolean(report?.has_pdf && canUseShareOutput),
  });
  const audienceRequest = pickLatestAudienceRequest(requestsQuery.data?.data ?? [], audience);
  const replyRequest = pickLatestAudienceReplyRequest(requestsQuery.data?.data ?? [], audience);

  // 一覧 API の responses は本文を含まないため、対象依頼のみ詳細を取得する
  const replyDetailQuery = useQuery({
    queryKey: ['communication-request', replyRequest?.id, orgId, currentUserId, currentUserRole],
    queryFn: async () => {
      const requestId = replyRequest?.id;
      if (!requestId) throw new Error('返信依頼IDがありません');
      const res = await fetch(buildCommunicationRequestApiPath(requestId), {
        headers: buildOrgHeaders(orgId),
      });
      if (!patientId) throw new Error('患者IDがありません');
      return readApiJson<ShareReplyDetailResponse>(res, {
        fallbackMessage: '返信内容の取得に失敗しました',
        schema: buildShareReplyDetailResponseSchema({
          expectedRequestId: requestId,
          expectedPatientId: patientId,
          expectedRequestType: 'care_report_reply_request',
          expectedRelatedEntityType: 'care_report',
          expectedRelatedEntityId: reportId,
        }),
      });
    },
    enabled: !isBootstrappingAuthorization && !!replyRequest?.id && canUseShareOutput,
  });
  const latestReply = replyDetailQuery.data?.data.responses[0] ?? null;
  const taskCreated = Boolean(latestReply && createdResponseIds.includes(latestReply.id));
  const requestCreated = createdRequestAudiences.includes(audience);
  const activeAudienceRequest =
    audienceRequest && isActiveReplyRequestStatus(audienceRequest.status) ? audienceRequest : null;
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
    mutationFn: async (input: FollowupTaskMutationInput) => {
      if (!isPatientWritable) {
        throw new ShareMutationResponseError(
          409,
          PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
          'patient_archived',
        );
      }
      if (!canCreateFollowupTask) {
        throw new ShareMutationResponseError(403, FOLLOWUP_TASK_PERMISSION_MESSAGE);
      }
      const res = await fetch(buildTasksApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(input.payload),
      });
      return readShareMutationResponse<unknown>(res, FOLLOWUP_TASK_FAILURE_MESSAGE);
    },
    onSuccess: (_result, input) => {
      setCreatedResponseIds((prev) => [...prev, input.responseId]);
      toast.success('次回訪問の確認タスクを作成しました');
    },
    onError: async (error) => {
      const status = getShareMutationResponseStatus(error);
      clientLog.warn('care_report.interprofessional_share_followup_task_failed', error, {
        route: '/reports/:id/share',
        entityType: 'care_report_followup_task',
        status,
      });
      if (isPatientArchivedWriteError(error)) {
        await reconcilePatientArchiveAfterConflict();
        toast.error(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
        return;
      }
      if (shouldReconcileFollowupTaskPermission(error)) {
        await reconcileFollowupEligibilityAfterRejection();
      }
      toast.error(status === 409 ? FOLLOWUP_TASK_CONFLICT_MESSAGE : FOLLOWUP_TASK_FAILURE_MESSAGE);
    },
  });

  const createReplyRequestMutation = useMutation({
    mutationFn: async (input: ReplyRequestMutationInput) => {
      if (!isPatientWritable) {
        throw new ShareMutationResponseError(
          409,
          PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
          'patient_archived',
        );
      }
      const res = await fetch(buildCommunicationRequestsApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(input.payload),
      });
      return readShareMutationResponse<CreateCommunicationRequestResponse>(
        res,
        REPLY_REQUEST_FAILURE_MESSAGE,
        createCommunicationRequestResponseSchema,
      );
    },
    onSuccess: async (result: CreateCommunicationRequestResponse, input) => {
      setCreatedRequestAudiences((prev) => [...prev, input.audience]);
      setCreatedRequestIdsByAudience((prev) => ({
        ...prev,
        [input.audience]: result.data.id,
      }));
      toast.success('返信依頼を起票しました');
      await queryClient.invalidateQueries({
        queryKey: [
          'communication-requests',
          'care_report',
          reportId,
          orgId,
          currentUserId,
          currentUserRole,
        ],
      });
    },
    onError: async (error) => {
      const status = getShareMutationResponseStatus(error);
      clientLog.warn('care_report.interprofessional_share_reply_request_failed', error, {
        route: '/reports/:id/share',
        entityType: 'care_report_reply_request',
        status,
      });
      if (isPatientArchivedWriteError(error)) {
        await reconcilePatientArchiveAfterConflict();
        toast.error(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
        return;
      }
      if (status === 409) {
        await requestsQuery.refetch().catch(() => undefined);
        toast.error(REPLY_REQUEST_CONFLICT_MESSAGE);
        return;
      }
      toast.error(REPLY_REQUEST_FAILURE_MESSAGE);
    },
  });

  const createFollowupTask = () => {
    if (!isPatientWritable) return;
    if (!canCreateFollowupTask) return;
    if (!report || !latestReply || !replyRequest) return;
    createTaskMutation.mutate({
      audience,
      responseId: latestReply.id,
      payload: buildNextCheckTaskInput({
        audience,
        patientId: report.patient_id,
        patientName: report.patient_summary?.name ?? null,
        reportId: report.id,
        requestId: replyRequest.id,
        response: latestReply,
      }),
    });
  };

  const createReplyRequest = () => {
    if (!isPatientWritable) return;
    if (!report || !patientId || !selectedAudienceCard?.recipientName) return;
    if (requestsQuery.isLoading || requestsQuery.isError) return;
    if (hasActiveAudienceRequest || requestCreated) return;
    createReplyRequestMutation.mutate({
      audience,
      payload: buildShareCommunicationRequestInput({
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
      }),
    });
  };

  if (isBootstrappingAuthorization || reportQuery.isLoading) {
    return <InterprofessionalShareLoadingState />;
  }

  if (reportQuery.error && (!report || !canRetainCachedReport)) {
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
    isPatientWritable ? (
      <Link
        href={patientShareHref}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'min-h-[44px] sm:min-h-0',
        )}
      >
        <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
        外部共有リンクの発行
      </Link>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="min-h-[44px] sm:min-h-0"
        aria-describedby={PATIENT_WRITE_AVAILABILITY_DESCRIPTION_ID}
      >
        <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
        外部共有リンクの発行
      </Button>
    )
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
          {patientArchive?.archived ||
          archiveConflictDetected ||
          followupEligibilityRecoveryPending ||
          canRetainCachedReport ? (
            <PatientWriteAvailabilityNotice
              archive={effectivePatientArchive}
              patientName={patientName}
              unavailableReason={canViewPatient ? 'unknown' : 'permission_denied'}
              onRetry={
                followupEligibilityRecoveryPending
                  ? () => void reconcileFollowupEligibilityAfterRejection()
                  : archiveConflictDetected || reportQuery.isRefetchError
                    ? () => void reconcilePatientArchiveAfterConflict()
                    : undefined
              }
              isRetrying={reportQuery.isRefetching}
              isShowingCachedData={Boolean(
                reportQuery.data &&
                (archiveConflictDetected ||
                  followupEligibilityRecoveryPending ||
                  canRetainCachedReport),
              )}
              cachedDataUpdatedAt={reportQuery.dataUpdatedAt}
            />
          ) : null}
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

        <PatientWriteAvailabilityNotice
          archive={effectivePatientArchive}
          patientName={patientName}
          unavailableReason={canViewPatient ? 'unknown' : 'permission_denied'}
          onRetry={
            followupEligibilityRecoveryPending
              ? () => void reconcileFollowupEligibilityAfterRejection()
              : archiveConflictDetected || reportQuery.isRefetchError
                ? () => void reconcilePatientArchiveAfterConflict()
                : undefined
          }
          isRetrying={reportQuery.isRefetching}
          isShowingCachedData={Boolean(
            reportQuery.data &&
            (archiveConflictDetected ||
              followupEligibilityRecoveryPending ||
              canRetainCachedReport),
          )}
          cachedDataUpdatedAt={reportQuery.dataUpdatedAt}
        />

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
                !isPatientWritable ||
                !selectedAudienceCard?.recipientName ||
                requestsQuery.isLoading ||
                requestsQuery.isError ||
                createReplyRequestMutation.isPending ||
                hasActiveAudienceRequest ||
                requestCreated
              }
              aria-describedby={
                isPatientWritable ? undefined : PATIENT_WRITE_AVAILABILITY_DESCRIPTION_ID
              }
              onClick={createReplyRequest}
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
              {!isPatientWritable
                ? '患者が利用中と確認できるまで、返信依頼は起票できません。'
                : !selectedAudienceCard?.recipientName
                  ? 'ケアチームまたは連絡先に共有相手を登録すると、返信依頼を起票できます。'
                  : requestsQuery.isError
                    ? '返信状況を取得できないため、重複防止のため起票を停止しています。'
                    : hasActiveAudienceRequest || requestCreated
                      ? 'この相手への返信依頼は既に連携依頼キューにあります。'
                      : '選択中の相手に、表示中の共有内容を確認してもらう返信待ち依頼を作成します。'}
            </p>
            {createReplyRequestMutation.isError &&
            createReplyRequestMutation.variables?.audience === audience &&
            !isDuplicateShareMutationConflict(createReplyRequestMutation.error) &&
            !(
              isPatientWritable && isPatientArchivedWriteError(createReplyRequestMutation.error)
            ) ? (
              <ErrorState
                className="mt-3"
                title={
                  isPatientArchivedWriteError(createReplyRequestMutation.error)
                    ? '患者がアーカイブされています'
                    : '返信依頼を起票できませんでした'
                }
                cause={
                  isPatientArchivedWriteError(createReplyRequestMutation.error)
                    ? '患者の利用状態が変わったため、返信依頼は作成されていません。'
                    : '選択した共有相手への返信依頼は完了していません。'
                }
                nextAction={
                  isPatientArchivedWriteError(createReplyRequestMutation.error)
                    ? '患者を復元した後に、この画面を再読み込みしてください。'
                    : '連携依頼の状態を確認して、同じ依頼をもう一度起票してください。'
                }
                onRetry={
                  isPatientArchivedWriteError(createReplyRequestMutation.error)
                    ? undefined
                    : () => createReplyRequestMutation.mutate(createReplyRequestMutation.variables)
                }
                retryLabel="返信依頼を再試行"
                headingLevel={3}
              />
            ) : null}
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
                !isPatientWritable ||
                !canCreateFollowupTask ||
                !latestReply ||
                createTaskMutation.isPending ||
                taskCreated
              }
              aria-describedby={FOLLOWUP_TASK_DESCRIPTION_ID}
              onClick={createFollowupTask}
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
            <p
              id={FOLLOWUP_TASK_DESCRIPTION_ID}
              className="mt-2 text-xs leading-5 text-muted-foreground"
            >
              {!isPatientWritable
                ? '患者が利用中と確認できるまで、次回タスクは作成できません。'
                : canCreateFollowupTask
                  ? '返信内容を次回訪問の確認タスク(運用タスク)として登録します。登録後はダッシュボードのタスク一覧に表示されます。'
                  : '運用タスクの作成権限がないため、返信内容は閲覧のみできます。'}
            </p>
            {createTaskMutation.isError &&
            createTaskMutation.variables?.audience === audience &&
            (isPatientArchivedWriteError(createTaskMutation.error)
              ? patientArchive?.archived === true
              : isPatientWritable && canCreateFollowupTask) ? (
              <ErrorState
                className="mt-3"
                title={
                  isPatientArchivedWriteError(createTaskMutation.error)
                    ? '患者がアーカイブされています'
                    : getShareMutationResponseStatus(createTaskMutation.error) === 409
                      ? '次回タスクの作成状態を確認してください'
                      : '次回タスクを作成できませんでした'
                }
                cause={
                  isPatientArchivedWriteError(createTaskMutation.error)
                    ? '患者の利用状態が変わったため、次回タスクは作成されていません。'
                    : '確認中の返信を次回訪問のタスクに登録できたか確認できていません。'
                }
                nextAction={
                  isPatientArchivedWriteError(createTaskMutation.error)
                    ? '患者を復元した後に、この画面を再読み込みしてください。'
                    : getShareMutationResponseStatus(createTaskMutation.error) === 409
                      ? 'タスク一覧で重複がないか確認してから操作してください。'
                      : 'タスク一覧を確認して、同じ返信からもう一度作成してください。'
                }
                onRetry={
                  !isPatientWritable ||
                  !canCreateFollowupTask ||
                  getShareMutationResponseStatus(createTaskMutation.error) === 409
                    ? undefined
                    : () => createTaskMutation.mutate(createTaskMutation.variables)
                }
                retryLabel="次回タスク作成を再試行"
                headingLevel={3}
              />
            ) : null}
          </section>
        </div>
      </div>
    </PageScaffold>
  );
}
