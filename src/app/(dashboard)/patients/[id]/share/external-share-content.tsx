'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Link2,
  ListTodo,
  MessageCircle,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { ActionRail } from '@/components/ui/action-rail';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildNextCheckTaskInput,
  buildShareAudienceCards,
  pickLatestAudienceRequest,
  pickLatestAudienceReplyRequest,
  type CareTeamMemberSummary,
  type ContactPartySummary,
  type ShareCommunicationRequest,
} from '@/app/(dashboard)/reports/[id]/share/interprofessional-share.helpers';
import {
  SHARE_AUDIENCES,
  shareAudienceLabel,
  type ShareAudienceKey,
} from '@/lib/communications/share-audience';
import {
  buildCommunicationRequestApiPath,
  buildCommunicationRequestsApiPath,
} from '@/lib/communications/api-paths';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildTasksApiPath } from '@/lib/tasks/api-paths';
import {
  buildPatientShareCommunicationRequestInput,
  buildPatientShareSections,
  type PatientShareSnapshot,
} from './patient-share.helpers';

/**
 * p1_05「他職種向け共有ページ」(患者文脈 /patients/[id]/share)。
 * 3 カラム構成:
 * - 左 共有する相手: 主治医/ケアマネ/訪問看護/施設/家族 の宛先切り替え + 外部共有リンクの発行
 * - 中央 相手に見える内容: 患者の共有事実を相手別にプレビュー(服薬状況/残薬/お願い/次回確認/添付)
 * - 右 返信・確認: 選択中の相手からの返信を表示し「次回タスクにする」で運用タスク化
 *
 * 外部公開ビュー(/shared/[token])の発行・閲覧とは別に、薬局側から「誰に・何が見えるか」を
 * プレビューし、相手からの返信を次回訪問の確認タスクへつなげる画面。
 */

// --- Types ---

type ScopeItem = {
  key: string;
  label: string;
  description: string;
};

type GeneratedGrant = {
  shareUrl: string;
  otp: string;
  expiresAt: string;
  otpDelivery: 'sms' | 'manual';
  otpDeliveryDestination: string | null;
};

type ExternalShareOverview = {
  name?: string | null;
  external_shares: Array<{
    id: string;
    granted_to_name: string;
    expires_at: string;
    accessed_at: string | null;
  }>;
  self_reports: Array<{
    id: string;
    subject: string;
    category?: string | null;
    content?: string;
    created_at: string;
    status: string;
  }>;
  current_medications?: Array<{
    drug_name: string;
    dose: string | null;
    frequency: string | null;
  }>;
  visit_schedules?: Array<{
    scheduled_date: string;
    schedule_status: string | null;
  }>;
  care_reports?: Array<{
    report_type: string;
    created_at: string;
    status: string;
  }>;
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

type ShareFormErrors = {
  grantedToName?: string;
  scope?: string;
};

function ExternalShareLoadingState() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="患者共有ワークスペースを読み込み中"
      aria-live="polite"
    >
      <div className="flex items-start gap-3 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-4 py-3">
        <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-4 w-full max-w-3xl" />
          <Skeleton className="h-4 w-3/4 max-w-2xl" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
        {Array.from({ length: 3 }).map((_, columnIndex) => (
          <Card key={columnIndex} className="border-border shadow-sm" aria-hidden="true">
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-full max-w-xs" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: columnIndex === 1 ? 5 : 4 }).map((__, rowIndex) => (
                <div key={rowIndex} className="space-y-2 rounded-md border border-border/70 p-3">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      <span className="sr-only">患者共有ワークスペースを読み込み中</span>
    </div>
  );
}

// --- Constants ---

const SCOPE_ITEMS: ScopeItem[] = [
  { key: 'medication_list', label: '服薬情報', description: '処方薬・用法・用量の一覧' },
  { key: 'visit_schedule', label: '訪問スケジュール', description: '直近の訪問予定' },
  { key: 'care_reports', label: '服薬指導報告書', description: '直近3件の報告書' },
  {
    key: 'inbound_communication_summary',
    label: '他職種受信サマリー',
    description: '確認済み受信連絡の件数・種別',
  },
  { key: 'allergy_info', label: 'アレルギー情報', description: '登録済みアレルギー' },
];

const EXPIRY_OPTIONS = [
  { value: '24', label: '24時間' },
  { value: '48', label: '48時間' },
  { value: '72', label: '72時間' },
];

// --- Main ---

export function ExternalShareContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const isBootstrappingOrg = !orgId;
  const [selectedAudience, setSelectedAudience] = useState<ShareAudienceKey>('care_manager');
  const [grantedToName, setGrantedToName] = useState('');
  const [grantedToContact, setGrantedToContact] = useState('');
  const [expiryHours, setExpiryHours] = useState('72');
  const [selectedScope, setSelectedScope] = useState<Set<string>>(new Set(['medication_list']));
  const [generated, setGenerated] = useState<GeneratedGrant | null>(null);
  const [createdResponseIds, setCreatedResponseIds] = useState<readonly string[]>([]);
  const [createdRequestAudiences, setCreatedRequestAudiences] = useState<
    readonly ShareAudienceKey[]
  >([]);
  const [createdRequestIdsByAudience, setCreatedRequestIdsByAudience] = useState<
    Partial<Record<ShareAudienceKey, string>>
  >({});
  const [shareFormErrors, setShareFormErrors] = useState<ShareFormErrors>({});

  const overviewQuery = useQuery<ExternalShareOverview>({
    queryKey: ['external-share-overview', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId), {
        headers: buildOrgHeaders(orgId),
        cache: 'no-store',
      });

      const payload = await readApiJson<{ data: ExternalShareOverview }>(
        response,
        '共有状況を取得できませんでした',
      );
      const overview = payload.data;
      return {
        name: overview.name ?? null,
        external_shares: overview.external_shares ?? [],
        self_reports: overview.self_reports ?? [],
        current_medications: overview.current_medications ?? [],
        visit_schedules: overview.visit_schedules ?? [],
        care_reports: overview.care_reports ?? [],
      };
    },
  });

  // 共有する相手カード(主治医/ケアマネ/訪問看護/施設/家族)の該当者名を埋めるための
  // ケアチーム + 連絡先。報告書文脈(/reports/[id]/share)と同じ taxonomy を再利用する。
  const careTeamQuery = useQuery({
    queryKey: ['patient-care-team', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/care-team'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: CareTeamMemberSummary[] }>(res, 'ケアチームの取得に失敗しました');
    },
  });

  const contactsQuery = useQuery({
    queryKey: ['patient-contacts', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/contacts'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: ContactPartySummary[] }>(res, '連絡先の取得に失敗しました');
    },
  });

  // 患者単位の連携依頼(返信突合のため related_entity_type=patient を取得)。
  const requestsQuery = useQuery({
    queryKey: ['communication-requests', 'patient', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const res = await fetch(
        buildCommunicationRequestsApiPath({
          requestType: 'patient_share_reply_request',
          relatedEntityType: 'patient',
          relatedEntityId: patientId,
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
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/external-access', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          patient_id: patientId,
          granted_to_name: grantedToName,
          granted_to_contact: grantedToContact || null,
          scope: Object.fromEntries(
            SCOPE_ITEMS.map((item) => [item.key, selectedScope.has(item.key)]),
          ),
          expires_hours: parseInt(expiryHours, 10),
        }),
      });
      if (!res.ok) throw new Error('共有リンクの生成に失敗しました');
      const payload = (await res.json()) as {
        data: {
          token: string;
          otp: string;
          expires_at: string;
          otp_delivery: 'sms' | 'manual';
          otp_delivery_destination: string | null;
        };
      };
      return {
        data: {
          shareUrl: `${window.location.origin}/shared/${payload.data.token}`,
          otp: payload.data.otp,
          expiresAt: payload.data.expires_at,
          otpDelivery: payload.data.otp_delivery,
          otpDeliveryDestination: payload.data.otp_delivery_destination,
        },
      } satisfies { data: GeneratedGrant };
    },
    onSuccess: (result) => {
      setGenerated(result.data);
      toast.success('共有リンクを発行しました');
    },
    onError: () => toast.error('共有リンクの生成に失敗しました'),
  });

  const audience = selectedAudience;
  const audienceLabel = shareAudienceLabel(audience);

  const audienceCards = useMemo(
    () => buildShareAudienceCards(careTeamQuery.data?.data ?? [], contactsQuery.data?.data ?? []),
    [careTeamQuery.data?.data, contactsQuery.data?.data],
  );
  const selectedAudienceCard = audienceCards.find((card) => card.key === audience) ?? null;

  const snapshot = useMemo<PatientShareSnapshot>(() => {
    const overview = overviewQuery.data;
    const careReports = overview?.care_reports ?? [];
    return {
      medications: (overview?.current_medications ?? []).map((item) => ({
        drug_name: item.drug_name,
        dose: item.dose,
        frequency: item.frequency,
      })),
      visits: (overview?.visit_schedules ?? []).map((item) => ({
        scheduled_date: item.scheduled_date,
        schedule_status: item.schedule_status,
      })),
      careReports: careReports.map((item) => ({
        report_type: item.report_type,
        created_at: item.created_at,
        status: item.status,
      })),
      selfReports: (overview?.self_reports ?? []).map((item) => ({
        subject: item.subject,
        category: item.category ?? null,
        content: item.content ?? '',
        created_at: item.created_at,
      })),
      hasShareableReport: careReports.some(
        (report) => report.status === 'sent' || report.status === 'confirmed',
      ),
    };
  }, [overviewQuery.data]);

  const sections = useMemo(
    () => buildPatientShareSections(snapshot, audience),
    [snapshot, audience],
  );

  const audienceRequest = pickLatestAudienceRequest(requestsQuery.data?.data ?? [], audience);
  const replyRequest = pickLatestAudienceReplyRequest(requestsQuery.data?.data ?? [], audience);

  // 一覧 API の responses は本文を含まないため、対象依頼のみ詳細を取得する。
  const replyDetailQuery = useQuery({
    queryKey: ['communication-request', replyRequest?.id, orgId],
    enabled: Boolean(orgId && replyRequest?.id),
    queryFn: async () => {
      const requestId = replyRequest?.id;
      if (!requestId) throw new Error('返信依頼IDがありません');
      const res = await fetch(buildCommunicationRequestApiPath(requestId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: ShareReplyDetail }>(res, '返信内容の取得に失敗しました');
    },
  });
  const latestReply = replyDetailQuery.data?.data?.responses?.[0] ?? null;
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
        requestType: 'patient_share_reply_request',
        patientId,
        requestId: focusedReplyRequestId,
        relatedEntityType: 'patient',
        relatedEntityId: patientId,
      })
    : null;
  const supportingDataErrors = [
    careTeamQuery.isError ? 'ケアチーム' : null,
    contactsQuery.isError ? '患者連絡先' : null,
    requestsQuery.isError ? '返信状況' : null,
    replyDetailQuery.isError ? '返信内容' : null,
  ].filter((label): label is string => Boolean(label));

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!latestReply || !replyRequest) {
        throw new Error('タスク化できる返信がありません');
      }
      const input = buildNextCheckTaskInput({
        audience,
        patientId,
        patientName: overviewQuery.data?.name ?? null,
        // 患者文脈では報告書 ID を持たないため related_entity_id(患者)を出典に使う。
        reportId: patientId,
        requestId: replyRequest.id,
        response: latestReply,
      });
      const res = await fetch(buildTasksApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(input),
      });
      return readApiJson<unknown>(res, '次回タスクの作成に失敗しました');
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
      if (!selectedAudienceCard?.recipientName) {
        throw new Error('共有相手が未登録です');
      }
      if (requestsQuery.isLoading || requestsQuery.isError) {
        throw new Error('返信状況を確認してから起票してください');
      }
      if (hasActiveAudienceRequest || requestCreated) {
        throw new Error('この相手への返信依頼は既に起票されています');
      }
      const input = buildPatientShareCommunicationRequestInput({
        audience,
        patientId,
        patientName: overviewQuery.data?.name ?? null,
        recipientName: selectedAudienceCard.recipientName,
        recipientOrganizationName: selectedAudienceCard.recipientOrganizationName,
        sections,
      });
      const res = await fetch(buildCommunicationRequestsApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(input),
      });
      return readApiJson<CreateCommunicationRequestResponse>(res, '返信依頼の起票に失敗しました');
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
        queryKey: ['communication-requests', 'patient', patientId, orgId],
      });
    },
    onError: (err: Error) => toast.error(messageFromError(err, '返信依頼の起票に失敗しました')),
  });

  function toggleScope(key: string) {
    setSelectedScope((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setShareFormErrors((prev) => ({ ...prev, scope: undefined }));
  }

  function handleCopyUrl() {
    if (!generated?.shareUrl) return;
    navigator.clipboard
      .writeText(generated.shareUrl)
      .then(() => {
        toast.success('URLをコピーしました');
      })
      .catch(() => {
        toast.error('コピーに失敗しました');
      });
  }

  function handleCopyOtp() {
    if (!generated?.otp) return;
    navigator.clipboard
      .writeText(generated.otp)
      .then(() => {
        toast.success('OTPをコピーしました');
      })
      .catch(() => {
        toast.error('コピーに失敗しました');
      });
  }

  function handleGenerate() {
    const nextErrors: ShareFormErrors = {};

    if (!grantedToName.trim()) {
      nextErrors.grantedToName = '共有先氏名は必須です';
    }
    if (selectedScope.size === 0) {
      nextErrors.scope = '共有する情報を1つ以上選択してください';
    }

    setShareFormErrors(nextErrors);

    const firstError = nextErrors.grantedToName ?? nextErrors.scope;
    if (firstError) {
      toast.error(firstError);
      return;
    }

    generateMutation.mutate();
  }

  if (isBootstrappingOrg || overviewQuery.isLoading) {
    return <ExternalShareLoadingState />;
  }

  if (overviewQuery.isError) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="共有状況を表示できません"
          description="共有状況の取得に失敗しました。再試行してください。"
          detail={overviewQuery.error instanceof Error ? overviewQuery.error.message : undefined}
          onRetry={() => void overviewQuery.refetch()}
          live="polite"
        />
      </div>
    );
  }

  const recentShares = overviewQuery.data?.external_shares ?? [];
  const recentSelfReports = overviewQuery.data?.self_reports ?? [];

  return (
    <div className="space-y-4">
      {/* Warning */}
      <div className="flex items-start gap-3 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-4 py-3 text-sm text-state-confirm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">個人情報の外部共有には十分注意してください</p>
          <p className="mt-0.5 text-state-confirm">
            相手区分ごとに「相手に見える内容」を確認してから共有してください。発行されたリンクは有効期限内に限り閲覧可能で、共有先連絡先に電話番号を入れると
            OTP を SMS 送信し、それ以外は別経路で手動共有します。
          </p>
        </div>
      </div>

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
                void careTeamQuery.refetch();
                void contactsQuery.refetch();
                void requestsQuery.refetch();
                if (replyRequest?.id) {
                  void replyDetailQuery.refetch();
                }
              }}
            >
              再取得
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* 左: 共有する相手 */}
        <section
          aria-labelledby="share-audience-heading"
          data-testid="share-audience-column"
          className="space-y-4"
        >
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <h2 id="share-audience-heading" className="text-base font-bold text-foreground">
              共有する相手
            </h2>
            <ul className="mt-3 space-y-2.5" role="list">
              {SHARE_AUDIENCES.map((audienceOption) => {
                const card = audienceCards.find((item) => item.key === audienceOption.key);
                const active = audienceOption.key === audience;
                return (
                  <li key={audienceOption.key}>
                    <button
                      type="button"
                      data-testid="share-audience-card"
                      data-audience={audienceOption.key}
                      aria-pressed={active}
                      onClick={() => setSelectedAudience(audienceOption.key)}
                      className={cn(
                        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                        'min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        active
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background hover:bg-muted/40',
                      )}
                    >
                      <span className="block text-sm font-bold text-foreground">
                        {audienceOption.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {card?.memberLabel ?? 'ケアチーム未登録'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 外部共有リンクの発行(共有設定) */}
          {!generated && (
            <Card>
              <CardHeader>
                <h2 className="font-heading text-base leading-snug font-medium">共有設定</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="granted-to-name">共有先氏名</Label>
                  <Input
                    id="granted-to-name"
                    value={grantedToName}
                    onChange={(e) => {
                      setGrantedToName(e.target.value);
                      if (e.target.value.trim()) {
                        setShareFormErrors((prev) => ({ ...prev, grantedToName: undefined }));
                      }
                    }}
                    placeholder="例: 田中ケアマネジャー"
                    aria-invalid={Boolean(shareFormErrors.grantedToName)}
                    aria-describedby={
                      shareFormErrors.grantedToName ? 'granted-to-name-error' : undefined
                    }
                  />
                  {shareFormErrors.grantedToName ? (
                    <p id="granted-to-name-error" role="alert" className="text-xs text-destructive">
                      {shareFormErrors.grantedToName}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="granted-to-contact">共有先連絡先（任意）</Label>
                  <Input
                    id="granted-to-contact"
                    value={grantedToContact}
                    onChange={(e) => setGrantedToContact(e.target.value)}
                    placeholder="電話番号またはメールアドレス"
                  />
                </div>

                <div
                  role="group"
                  aria-labelledby="share-scope-label"
                  aria-describedby={shareFormErrors.scope ? 'share-scope-error' : undefined}
                  className="space-y-2"
                >
                  <Label id="share-scope-label">共有する情報</Label>
                  {SCOPE_ITEMS.map((item) => (
                    <div key={item.key} className="flex items-start gap-2">
                      <Checkbox
                        id={`scope-${item.key}`}
                        checked={selectedScope.has(item.key)}
                        onCheckedChange={() => toggleScope(item.key)}
                      />
                      <label htmlFor={`scope-${item.key}`} className="cursor-pointer space-y-0.5">
                        <span className="text-sm font-medium">{item.label}</span>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </label>
                    </div>
                  ))}
                  {shareFormErrors.scope ? (
                    <p id="share-scope-error" role="alert" className="text-xs text-destructive">
                      {shareFormErrors.scope}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="expiry">有効期限</Label>
                  <Select value={expiryHours} onValueChange={(v) => setExpiryHours(v ?? '72')}>
                    <SelectTrigger id="expiry">
                      <SelectValue>
                        {EXPIRY_OPTIONS.find((opt) => opt.value === expiryHours)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <ActionRail>
                  <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <Link2 className="mr-1.5 size-4" aria-hidden="true" />
                    {generateMutation.isPending ? '生成中...' : '共有リンクを発行'}
                  </Button>
                </ActionRail>
              </CardContent>
            </Card>
          )}

          {/* Generated result */}
          {generated && (
            <Card className="border-state-done/30">
              <CardHeader>
                <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium text-state-done">
                  <CheckCircle2 className="size-5" aria-hidden="true" />
                  共有リンクを発行しました
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>共有URL</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={generated.shareUrl}
                      readOnly
                      className="font-mono text-xs"
                      aria-label="共有URL"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleCopyUrl}
                      aria-label="URLをコピー"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>OTP（別経路で伝達）</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={generated.otp}
                      readOnly
                      className="font-mono text-xl tracking-widest text-center"
                      aria-label="OTP"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleCopyOtp}
                      aria-label="OTPをコピー"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden="true" />
                  有効期限: {new Date(generated.expiresAt).toLocaleString('ja-JP')}
                </div>

                {generated.otpDelivery === 'sms' ? (
                  <div className="flex items-start gap-2 rounded-md border border-state-done/30 bg-state-done/10 px-3 py-2 text-xs text-state-done">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    OTP を {generated.otpDeliveryDestination ?? '共有先連絡先'} に SMS
                    送信しました。必要に応じて下の控え用 OTP を確認してください。
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-xs text-state-confirm">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    OTPは電話・SMSなど共有URLとは別の手段で伝達してください。
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setGenerated(null)}
                >
                  新しい共有リンクを発行する
                </Button>
              </CardContent>
            </Card>
          )}
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
          className="space-y-4"
        >
          <div className="rounded-lg border border-border/70 bg-card p-4">
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
                    : '選択中の相手に、表示中の患者共有内容を確認してもらう返信待ち依頼を作成します。'}
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
              disabled={!latestReply || createTaskMutation.isPending || taskCreated}
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
              返信内容を次回訪問の確認タスク（運用タスク）として登録します。登録後はダッシュボードのタスク一覧に表示されます。
            </p>
          </div>

          {/* 共有済みリンクと連絡文脈 */}
          <Card>
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                共有済みリンクと連絡文脈
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">最近の共有先</p>
                {recentShares.length > 0 ? (
                  recentShares.slice(0, 3).map((share) => (
                    <div
                      key={share.id}
                      className="rounded-lg border border-border/70 px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-foreground">{share.granted_to_name}</p>
                      <p className="text-xs text-muted-foreground">
                        有効期限 {new Date(share.expires_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">共有済みリンクはまだありません。</p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">直近の自己申告・連絡メモ</p>
                {recentSelfReports.length > 0 ? (
                  recentSelfReports.slice(0, 3).map((report) => (
                    <div
                      key={report.id}
                      className="rounded-lg border border-border/70 px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-foreground">{report.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(report.created_at).toLocaleString('ja-JP')} / {report.status}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">自己申告はまだありません。</p>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
