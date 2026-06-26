'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { PageSection } from '@/components/layout/page-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { ActionRail } from '@/components/ui/action-rail';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { encodePathSegment } from '@/lib/http/path-segment';
import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import {
  buildCommunicationRequestsHref,
  resolveCommunicationEntityLink,
} from '@/lib/communications/navigation';
import { toast } from 'sonner';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

type CommunicationRequestRow = {
  id: string;
  request_type: string;
  subject: string;
  status: string;
  requested_at: string;
  updated_at: string;
  due_date: string | null;
  patient_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  recipient_name: string | null;
  recipient_role: string | null;
  responses: Array<{
    id: string;
    responder_name: string;
    responded_at: string;
  }>;
};

const RECIPIENT_ROLE_LABELS: Record<string, string> = {
  physician: '主治医',
  doctor: '主治医',
  care_manager: 'ケアマネ',
  nurse: '訪問看護',
  visiting_nurse: '訪問看護',
  facility: '施設',
  family: '家族',
};

function formatRecipientLabel(
  item: Pick<CommunicationRequestRow, 'recipient_role' | 'recipient_name'>,
) {
  const roleLabel = item.recipient_role ? RECIPIENT_ROLE_LABELS[item.recipient_role] : null;
  return [roleLabel, item.recipient_name ?? '宛先未設定'].filter(Boolean).join('：');
}

const FILTER_TABS = [
  { value: '', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'sent', label: '返信待ち' },
  { value: 'received', label: '受信済み' },
  { value: 'in_progress', label: '対応中' },
  { value: 'responded', label: '返信済み' },
  { value: 'escalated', label: 'エスカレ' },
  { value: 'closed', label: '完了' },
];

// フォーカスモードの「返信待ち」: 未完了かつ取消・下書きでない依頼に絞り込む
const FOLLOWUP_OPEN_STATUSES = new Set([
  'sent',
  'received',
  'in_progress',
  'responded',
  'escalated',
]);

const DEFAULT_FOCUSED_FORM = {
  // 返信内容（responder_name は宛先名で初期化）
  responder_name: '',
  content: '',
  // 次回カードへ残すこと（運用タスクとして残す任意メモ）
  followup: '',
};

// フォーカスモード左ペインの経過/期限バッジ。色だけに依存せずアイコン+テキストを併用。
function resolveFollowupDueDisplay(item: CommunicationRequestRow): {
  role: 'hazard' | 'confirm' | 'waiting' | 'done';
  label: string;
} {
  if (item.responses.length > 0) {
    return { role: 'done', label: '返信あり' };
  }
  if (item.due_date) {
    const days = differenceInCalendarDays(parseISO(item.due_date), new Date());
    if (days < 0) {
      return { role: 'hazard', label: `期限${-days}日超過` };
    }
    if (days === 0) {
      return { role: 'hazard', label: '本日期限' };
    }
    if (days <= 2) {
      return { role: 'confirm', label: `期限まで${days}日` };
    }
  }
  const elapsedDays = differenceInCalendarDays(new Date(), parseISO(item.requested_at));
  return {
    role: 'waiting',
    label: elapsedDays <= 0 ? '本日依頼' : `${elapsedDays}日経過`,
  };
}

type CommunicationRequestsContentProps = {
  initialStatus?: string | null;
  initialPatientId?: string | null;
  initialRelatedEntityType?: string | null;
  initialRelatedEntityId?: string | null;
  initialContext?: string | null;
};

export function CommunicationRequestsContent({
  initialStatus,
  initialPatientId,
  initialRelatedEntityType,
  initialRelatedEntityId,
  initialContext,
}: CommunicationRequestsContentProps) {
  const replaceRequestsUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState(initialStatus ?? '');
  const [focusedSelectedId, setFocusedSelectedId] = useState<string | null>(null);
  const [focusedForm, setFocusedForm] = useState(DEFAULT_FOCUSED_FORM);
  const patientFilter = initialPatientId ?? '';
  const relatedEntityTypeFilter = initialRelatedEntityType ?? '';
  const relatedEntityIdFilter = initialRelatedEntityId ?? '';
  const relatedEntityLink = resolveCommunicationEntityLink({
    entityType: relatedEntityTypeFilter || null,
    entityId: relatedEntityIdFilter || null,
  });
  // 患者フィルタの詳細リンクも同じ query/描画境界 resolver を通す。query 由来の
  // patientFilter が '.'/'..' 等で buildPatientHref が RangeError を投げても、resolver が
  // null へ縮退し描画を壊さない(リンク非表示=なし)。API フィルタ用の生 patientFilter は別途維持。
  const patientFilterLink = resolveCommunicationEntityLink({
    entityType: 'patient',
    entityId: patientFilter || null,
  });
  const contextSummary =
    initialContext === 'dashboard_home'
      ? statusFilter === 'sent'
        ? 'ホームから返信待ちの依頼・照会にフォーカスして開いています。'
        : 'ホームから依頼・照会の対応キューにフォーカスして開いています。'
      : null;

  // フォーカスモードの「対応済みにする」: 返信内容、次回カード、完了化を一括記録する。
  const resolveFocusedMutation = useMutation({
    mutationFn: async ({
      item,
      responderName,
      content,
      followup,
    }: {
      item: CommunicationRequestRow;
      responderName: string;
      content: string;
      followup: string;
    }) => {
      const jsonHeaders = buildOrgJsonHeaders(orgId);

      const res = await fetch(
        `/api/communication-requests/${encodePathSegment(item.id)}/resolve-followup`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            expected_updated_at: item.updated_at,
            ...(content
              ? {
                  response: {
                    responder_name: responderName || item.recipient_name || '担当者',
                    content,
                    responded_at: new Date().toISOString(),
                  },
                }
              : {}),
            ...(followup ? { followup } : {}),
          }),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '対応の記録に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success('対応済みにしました');
      setFocusedSelectedId(null);
      setFocusedForm(DEFAULT_FOCUSED_FORM);
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '対応の記録に失敗しました');
    },
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      'communication-requests',
      orgId,
      statusFilter,
      patientFilter,
      relatedEntityTypeFilter,
      relatedEntityIdFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (patientFilter) params.set('patient_id', patientFilter);
      if (relatedEntityTypeFilter) params.set('related_entity_type', relatedEntityTypeFilter);
      if (relatedEntityIdFilter) params.set('related_entity_id', relatedEntityIdFilter);
      return fetchAllCursorPages<
        CommunicationRequestRow,
        {
          data: CommunicationRequestRow[];
          hasMore: boolean;
        }
      >({
        path: '/api/communication-requests',
        params,
        init: { headers: buildOrgHeaders(orgId) },
        errorMessage: '依頼一覧の取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });
  const isInitialLoading = isLoading && !data;

  // フォーカスモード: 未完了の返信待ち依頼のみ（期限の近い順）
  const focusedRequests = useMemo(() => {
    const rows = (data?.data ?? []).filter((row) => FOLLOWUP_OPEN_STATUSES.has(row.status));
    return rows.sort((a, b) => {
      const aDue = a.due_date ? parseISO(a.due_date).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.due_date ? parseISO(b.due_date).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return parseISO(a.requested_at).getTime() - parseISO(b.requested_at).getTime();
    });
  }, [data?.data]);

  const focusedSelected =
    focusedRequests.find((row) => row.id === focusedSelectedId) ?? focusedRequests[0] ?? null;

  const selectFocusedRequest = (item: CommunicationRequestRow) => {
    setFocusedSelectedId(item.id);
    setFocusedForm({
      responder_name: item.recipient_name ?? '',
      content: '',
      followup: '',
    });
  };

  return (
    <div className="space-y-6">
      {contextSummary ? (
        <Alert
          className="border-tag-info/30 bg-tag-info/10 text-tag-info"
          data-testid="communications-context-banner"
        >
          <AlertTriangle className="size-4 text-tag-info" aria-hidden="true" />
          <AlertDescription className="text-tag-info">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <PageSection
        title="返信待ち・フォロー"
        description="返信待ちの依頼を1件ずつ確認し、返信内容と次回カードへ残すことを記録して対応済みにします。"
        tone="subtle"
        contentClassName={
          isError || isInitialLoading ? undefined : 'grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]'
        }
      >
        {isError ? (
          <ErrorState
            variant="server"
            title="依頼一覧を表示できません"
            description="返信待ち、対応中、患者文脈の依頼取得に失敗しました。通信状態を確認して再試行してください。"
            detail="取得失敗時は、返信待ちがないものとして扱わず、対応済み操作を停止しています。"
            action={{ label: '再試行', onClick: () => void refetch() }}
            headingLevel={3}
          />
        ) : isInitialLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground"
          >
            依頼一覧を読み込み中...
          </div>
        ) : (
          <>
            <div
              className="space-y-2"
              role="listbox"
              aria-label="返信待ちの依頼"
              data-testid="reply-followup-list"
            >
              <h3 className="px-1 text-sm font-semibold text-foreground">返信待ち</h3>
              {isLoading ? (
                <p className="px-1 text-sm text-muted-foreground">読み込み中...</p>
              ) : focusedRequests.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  返信待ちの依頼はありません。
                </p>
              ) : (
                focusedRequests.map((item) => {
                  const due = resolveFollowupDueDisplay(item);
                  const isSelected = focusedSelected?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectFocusedRequest(item)}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
                      }`}
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {formatRecipientLabel(item)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.subject}
                      </p>
                      <div className="mt-2">
                        <StateBadge role={due.role}>{due.label}</StateBadge>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              {focusedSelected ? (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">返信内容と次の対応</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatRecipientLabel(focusedSelected)} / {focusedSelected.subject}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="focused_response_content">返信内容</Label>
                    <Textarea
                      id="focused_response_content"
                      rows={5}
                      placeholder="返信内容を記録します（任意）"
                      value={focusedForm.content}
                      onChange={(event) =>
                        setFocusedForm((current) => ({ ...current, content: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="focused_followup">次回カードへ残すこと</Label>
                    <Textarea
                      id="focused_followup"
                      rows={3}
                      placeholder="例: 夕食後薬の飲み忘れを確認"
                      aria-describedby="focused_followup_help"
                      className="bg-state-done/5"
                      value={focusedForm.followup}
                      onChange={(event) =>
                        setFocusedForm((current) => ({ ...current, followup: event.target.value }))
                      }
                    />
                    <p id="focused_followup_help" className="text-xs text-muted-foreground">
                      入力すると報告返信待ちフォローの運用タスクとして残します。
                    </p>
                  </div>

                  <div className="flex justify-start pt-1">
                    <Button
                      className="!h-auto !min-h-[44px] bg-state-done text-white hover:bg-state-done/90"
                      onClick={() =>
                        resolveFocusedMutation.mutate({
                          item: focusedSelected,
                          responderName: focusedForm.responder_name.trim(),
                          content: focusedForm.content.trim(),
                          followup: focusedForm.followup.trim(),
                        })
                      }
                      disabled={resolveFocusedMutation.isPending}
                    >
                      対応済みにする
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  左の返信待ちリストから依頼を選択してください。
                </p>
              )}
            </div>
          </>
        )}
      </PageSection>

      <PageSection
        title="表示条件"
        description="必要な時だけ状態や患者文脈で絞り込みます。主作業は上の返信フォローで続けられます。"
        tone="subtle"
      >
        <div className="flex flex-wrap gap-2 border-b border-border/70 pb-3">
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? 'default' : 'ghost'}
              size="sm"
              className="!h-auto !min-h-[44px]"
              onClick={() => {
                setStatusFilter(tab.value);
                replaceRequestsUrl({ status: tab.value || null });
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {patientFilter || relatedEntityTypeFilter || relatedEntityIdFilter ? (
          <FilterSummaryBar
            items={[
              {
                label: '患者',
                value: patientFilterLink ? (
                  <Link
                    href={patientFilterLink.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-primary underline-offset-4 hover:underline"
                  >
                    詳細
                  </Link>
                ) : (
                  'なし'
                ),
              },
              ...(relatedEntityTypeFilter
                ? [{ label: '関連種別', value: relatedEntityTypeFilter }]
                : []),
              ...(relatedEntityIdFilter ? [{ label: '関連ID', value: relatedEntityIdFilter }] : []),
            ]}
            actions={
              <ActionRail>
                {relatedEntityLink ? (
                  <Link
                    href={relatedEntityLink.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {relatedEntityLink.label}
                  </Link>
                ) : null}
                <Link
                  href={buildCommunicationRequestsHref({ status: statusFilter || null })}
                  className="inline-flex min-h-11 min-w-11 items-center text-sm text-primary underline-offset-4 hover:underline"
                >
                  文脈をクリア
                </Link>
              </ActionRail>
            }
          />
        ) : null}
      </PageSection>
    </div>
  );
}
