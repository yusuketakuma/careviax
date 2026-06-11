'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { PatientMcsSummaryCard } from '@/components/patient-mcs/patient-mcs-summary-card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  parsePatientMcsSyncResult,
  type PatientMcsViewData,
  type PatientMcsViewLink,
  type PatientMcsViewMessage,
} from '@/lib/patient-mcs/dto';
import { groupPatientMcsMessagesByDay, orderPatientMcsMessages } from '@/lib/patient-mcs/messages';
import {
  createPatientMcsQueryKey,
  createPatientMcsQueryKeyPrefix,
  fetchPatientMcsOverview,
} from '@/lib/patient-mcs/query';
import {
  resolvePatientMcsOpenTargets,
  resolvePatientMcsSourceValidationError,
  resolvePatientMcsSyncSource,
} from '@/lib/patient-mcs/source';
import { describePatientMcsStatus, describePatientMcsSyncResult } from '@/lib/patient-mcs/status';
import { formatDateTimeLabel } from '@/lib/ui/date-format';
import { cn } from '@/lib/utils';

function isOtherProfessionalRole(role: string | null) {
  if (!role) return false;
  return !/薬剤師/.test(role);
}

async function syncPatientMcs(patientId: string, orgId: string, sourceUrl?: string) {
  const response = await fetch(`/api/patients/${patientId}/mcs-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify(sourceUrl ? { source_url: sourceUrl } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? 'MCS 同期に失敗しました');
  }

  return parsePatientMcsSyncResult(await response.json());
}

function PatientMcsSyncPanel({
  link,
  isLoading,
  isSyncing,
  onSync,
}: {
  link: PatientMcsViewLink | null;
  isLoading: boolean;
  isSyncing: boolean;
  onSync: (sourceUrl?: string) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState(link?.sourceUrl ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const status = describePatientMcsStatus(link);
  const hasOverride = sourceUrl.trim() !== '' && sourceUrl.trim() !== (link?.sourceUrl ?? '');
  const sourceValidationError = resolvePatientMcsSourceValidationError(sourceUrl);
  const resolvedSourceUrl = resolvePatientMcsSyncSource(sourceUrl, link?.sourceUrl ?? null);
  const openTargets = resolvePatientMcsOpenTargets(link, sourceUrl);
  const needsSetup = resolvedSourceUrl === null && sourceValidationError === null;

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
          <Link2 className="size-4" aria-hidden="true" />
          MCS 連携状況
        </h2>
        <CardDescription>{status.description}</CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSync(resolvedSourceUrl ?? undefined)}
            disabled={
              isSyncing || isLoading || resolvedSourceUrl === null || !!sourceValidationError
            }
          >
            <RefreshCw
              className={cn('mr-1.5 size-4', isSyncing && 'animate-spin')}
              aria-hidden="true"
            />
            {isSyncing ? '同期中...' : '今すぐ同期'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {link?.memberCount !== null && link?.memberCount !== undefined ? (
            <Badge variant="outline">
              <Users className="size-3" aria-hidden="true" />
              参加者 {link.memberCount} 人
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            最終試行 {formatDateTimeLabel(link?.lastSyncAttemptAt ?? null, { fallback: '未記録' })}
          </span>
          {link?.lastSyncedAt ? (
            <span className="text-xs text-muted-foreground">
              最終成功 {formatDateTimeLabel(link.lastSyncedAt, { fallback: '未記録' })}
            </span>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <label htmlFor="mcs-source-url" className="text-sm font-medium">
              MCS 連携元 URL
            </label>
            <Input
              id="mcs-source-url"
              ref={inputRef}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://www.medical-care.net/patients/..."
              aria-invalid={!!sourceValidationError}
              aria-describedby={sourceValidationError ? 'mcs-source-url-error' : undefined}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>患者 URL または医療・介護側タイムライン URL を指定します。</span>
              {hasOverride ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={() => setSourceUrl(link?.sourceUrl ?? '')}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  保存済み URL に戻す
                </button>
              ) : null}
            </div>
            {sourceValidationError ? (
              <p id="mcs-source-url-error" className="text-xs text-destructive" role="alert">
                {sourceValidationError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div>
              <p className="text-xs text-muted-foreground">連携先プロジェクト</p>
              <p className="text-sm font-medium">{link?.projectTitle ?? '未設定'}</p>
            </div>
            {link?.projectMemo ? (
              <p className="text-xs text-muted-foreground">{link.projectMemo}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {openTargets.mcsUrl ? (
                <Link
                  href={openTargets.mcsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
                  MCS で開く
                </Link>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
                  MCS で開く
                </Button>
              )}
              {openTargets.patientUrl ? (
                <Link
                  href={openTargets.patientUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  患者ページ
                </Link>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  患者ページ
                </Button>
              )}
            </div>
            {needsSetup ? (
              <p className="text-xs text-muted-foreground">
                URL を入力するとボタンが有効になり、同期後にメッセージ時系列と AI
                要約が表示されます。
              </p>
            ) : sourceValidationError ? (
              <p className="text-xs text-destructive">
                URL の形式を直すまで、外部導線と同期は利用できません。
              </p>
            ) : null}
          </div>
        </div>

        {needsSetup ? (
          <div
            className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4"
            data-testid="patient-mcs-setup-guide"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-foreground">最初に必要な設定</p>
                <ol className="space-y-1 text-sm text-muted-foreground">
                  <li>
                    1. MCS の患者ページ URL か医療・介護側タイムライン URL を上に貼り付けます。
                  </li>
                  <li>2. 「今すぐ同期」を押して、患者との連携先を保存します。</li>
                  <li>3. 同期完了後、このページに時系列メッセージと AI 要約が表示されます。</li>
                </ol>
              </div>
              <Button type="button" size="sm" onClick={() => inputRef.current?.focus()}>
                URL を入力する
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              例: `https://www.medical-care.net/patients/...` または
              `https://www.medical-care.net/projects/medical/...`
            </p>
          </div>
        ) : null}

        {link?.lastSyncError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{link.lastSyncError}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PatientMcsMessagesPanel({
  messages,
  isLoading,
  isSyncing,
  canSync,
  onSync,
}: {
  messages: PatientMcsViewMessage[];
  isLoading: boolean;
  isSyncing: boolean;
  canSync: boolean;
  onSync: () => void;
}) {
  const groups = groupPatientMcsMessagesByDay(messages);

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
          <MessageSquareText className="size-4" aria-hidden="true" />
          取り込み済みメッセージ
        </h2>
        <CardDescription>
          他職種からの MCS 投稿の直近30件を、保存済みデータから古い順に並べています。現在{' '}
          {messages.length} 件を表示中です。
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">古い順</Badge>
          <Badge variant="outline">直近 30 件</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loading label="MCS メッセージを読み込み中..." />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="MCS メッセージはまだありません"
            description={
              canSync
                ? '連携元 URL を設定して同期すると、他職種の投稿がここに表示されます。'
                : '先に連携元 URL を保存または入力してから同期してください。'
            }
            action={
              canSync
                ? {
                    label: isSyncing ? '同期中...' : '同期を実行',
                    onClick: onSync,
                  }
                : undefined
            }
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.dayLabel} className="space-y-3">
                <div className="sticky top-0 z-10 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                  {group.dayLabel}
                </div>
                {group.messages.map((message) => (
                  <article key={message.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{message.authorName}</h3>
                          {message.authorRole ? (
                            <Badge variant="outline">{message.authorRole}</Badge>
                          ) : null}
                          {isOtherProfessionalRole(message.authorRole) ? (
                            <Badge variant="secondary">他職種</Badge>
                          ) : null}
                          {message.authorOrganization ? (
                            <span className="text-xs text-muted-foreground">
                              {message.authorOrganization}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {message.postedAtLabel || formatDateTimeLabel(message.postedAt, { fallback: '未記録' })}
                        </p>
                      </div>

                      <Link
                        href={message.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
                        原文を開く
                      </Link>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                      {message.body}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>返信 {message.replyCount} 件</span>
                      <span>リアクション {message.reactionCount} 件</span>
                      <span>ID {message.sourceMessageId}</span>
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PatientMcsSummaryPanel({
  summary,
  link,
}: {
  summary: PatientMcsViewData['summary'];
  link: PatientMcsViewLink | null;
}) {
  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
            <Sparkles className="size-4" aria-hidden="true" />
            MCS要点サマリー
          </h2>
          <CardDescription>
            同期に成功すると、他職種発信の要点をここに保存して表示します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="要約はまだありません"
            description={
              link?.lastSyncedAt
                ? '保存済みメッセージはありますが、次回同期後に要約を再生成します。'
                : 'MCS を同期すると、他職種共有の要点と確認事項をここに表示します。'
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {link?.lastSyncError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          同期エラー中のため、以下は前回成功時点の MCS 要約です。
        </p>
      ) : null}
      <PatientMcsSummaryCard
        summary={summary}
        title="MCS要点サマリー"
        description="他職種発信の要点、確認事項、次アクションを保存済みデータから整理しています。"
      />
    </div>
  );
}

export function PatientMcsContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const queryKey = createPatientMcsQueryKey(patientId, orgId, 30);
  const queryKeyPrefix = createPatientMcsQueryKeyPrefix(patientId, orgId);

  const mcsQuery = useQuery<PatientMcsViewData>({
    queryKey,
    queryFn: () => fetchPatientMcsOverview(patientId, orgId, 30),
    enabled: orgId.length > 0,
  });

  const syncMutation = useMutation({
    mutationFn: (sourceUrl?: string) => syncPatientMcs(patientId, orgId, sourceUrl),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeyPrefix });
      toast.success(
        describePatientMcsSyncResult({
          importedCount: result.importedCount,
          projectTitle: result.projectTitle,
          summary: result.summary
            ? {
                isFallback: result.summary.isFallback,
                otherProfessionalMessageCount: result.summary.otherProfessionalMessageCount,
              }
            : null,
        }),
      );
    },
    onError: async (error: Error) => {
      await queryClient.invalidateQueries({ queryKey: queryKeyPrefix });
      toast.error(error.message);
    },
  });

  if (orgId.length === 0) {
    return <Loading label="MCS 連携情報を読み込み中..." />;
  }

  if (mcsQuery.isError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-2">
          <p>{mcsQuery.error.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => mcsQuery.refetch()}>
            再読み込み
          </Button>
        </div>
      </div>
    );
  }

  const link = mcsQuery.data?.link ?? null;
  const summary = mcsQuery.data?.summary ?? null;
  const messages = orderPatientMcsMessages(mcsQuery.data?.messages ?? [], 'asc');
  const canSync = Boolean(link?.sourceUrl);

  return (
    <div className="space-y-6">
      <PatientMcsSyncPanel
        key={link?.sourceUrl ?? 'empty'}
        link={link}
        isLoading={mcsQuery.isLoading}
        isSyncing={syncMutation.isPending}
        onSync={(sourceUrl) => syncMutation.mutate(sourceUrl)}
      />
      <PatientMcsSummaryPanel summary={summary} link={link} />
      <PatientMcsMessagesPanel
        messages={messages}
        isLoading={mcsQuery.isLoading}
        isSyncing={syncMutation.isPending}
        canSync={canSync}
        onSync={() => syncMutation.mutate(undefined)}
      />
    </div>
  );
}
