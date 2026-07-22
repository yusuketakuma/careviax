'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Clipboard,
  ExternalLink,
  Link2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { PatientMcsSummaryCard } from '@/components/patient-mcs/patient-mcs-summary-card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  type PatientMcsViewData,
  type PatientMcsViewCheckLog,
  type PatientMcsViewLink,
  type PatientMcsViewMessage,
  type PatientMcsViewProfile,
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
import { clientLog } from '@/lib/utils/client-log';
import {
  MCS_CHECK_LOG_FAILURE_MESSAGE,
  MCS_COPY_URL_FAILURE_MESSAGE,
  MCS_COUNTERPART_ROLE_OPTIONS,
  MCS_LINKED_STATUS_OPTIONS,
  MCS_LOG_CATEGORY_OPTIONS,
  MCS_OVERVIEW_ERROR_TITLE,
  MCS_PARTICIPATION_STATUS_OPTIONS,
  MCS_PROFILE_FAILURE_MESSAGE,
  MCS_SYNC_CONFLICT_MESSAGE,
  MCS_SYNC_FAILURE_MESSAGE,
  copyTextToClipboard,
  createPatientMcsCheckLog,
  currentDateTimeLocalValue,
  fromDateTimeLocalValue,
  getPatientMcsMutationFailureMessage,
  getPatientMcsMutationStatus,
  getPatientMcsOverviewFailureState,
  isOtherProfessionalRole,
  patientMcsLogContext,
  splitParticipants,
  syncPatientMcs,
  toDateTimeLocalValue,
  updatePatientMcsProfile,
  type PatientMcsCheckLogInput,
  type PatientMcsProfileInput,
} from './mcs-content-model';

function PatientMcsOverviewLoadingState() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="MCS 連携情報を読み込み中"
      aria-live="polite"
    >
      <Card aria-hidden="true">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Skeleton className="h-10 w-full rounded-md" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-10 w-28 rounded-md" />
              <Skeleton className="h-10 w-24 rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index} aria-hidden="true">
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full max-w-sm" />
            </CardHeader>
            <CardContent className="space-y-3">
              <SkeletonRows rows={3} cols={2} status={false} />
            </CardContent>
          </Card>
        ))}
      </div>
      <span className="sr-only">MCS 連携情報を読み込み中</span>
    </div>
  );
}

function PatientMcsMessagesLoadingState() {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-label="MCS メッセージを読み込み中"
      aria-live="polite"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border p-4" aria-hidden="true">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full max-w-xl" />
              <Skeleton className="h-4 w-5/6 max-w-lg" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
      <span className="sr-only">MCS メッセージを読み込み中</span>
    </div>
  );
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
              {openTargets.mcsUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const mcsUrl = openTargets.mcsUrl;
                    if (!mcsUrl) return;
                    copyTextToClipboard(mcsUrl)
                      .then(() => toast.success('MCS URLをコピーしました'))
                      .catch((error: unknown) => {
                        clientLog.warn('patient_mcs.copy_url_failed', error, {
                          ...patientMcsLogContext('patient_mcs'),
                        });
                        toast.error(MCS_COPY_URL_FAILURE_MESSAGE);
                      });
                  }}
                >
                  <Clipboard className="mr-1.5 size-4" aria-hidden="true" />
                  URLをコピー
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  <Clipboard className="mr-1.5 size-4" aria-hidden="true" />
                  URLをコピー
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

function PatientMcsProfilePanel({
  profile,
  isSaving,
  onSave,
}: {
  profile: PatientMcsViewProfile | null;
  isSaving: boolean;
  onSave: (input: PatientMcsProfileInput) => void;
}) {
  const [linkedStatus, setLinkedStatus] = useState(profile?.linkedStatus ?? 'unknown');
  const [participationStatus, setParticipationStatus] = useState(
    profile?.participationStatus ?? 'unknown',
  );
  const [pharmacyParticipants, setPharmacyParticipants] = useState(
    profile?.pharmacyParticipants.join('\n') ?? '',
  );
  const [counterpartRoles, setCounterpartRoles] = useState<string[]>(
    profile?.counterpartRoles ?? [],
  );
  const [lastCheckedAt, setLastCheckedAt] = useState(
    toDateTimeLocalValue(profile?.lastCheckedAt ?? null),
  );
  const [note, setNote] = useState(profile?.note ?? '');

  const toggleCounterpartRole = (value: string) => {
    setCounterpartRoles((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
  };
  const buildInput = (lastCheckedAtValue = lastCheckedAt) => ({
    linkedStatus,
    participationStatus,
    pharmacyParticipants: splitParticipants(pharmacyParticipants),
    counterpartRoles,
    lastCheckedAt: fromDateTimeLocalValue(lastCheckedAtValue),
    note: note.trim() || null,
  });

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
          <Users className="size-4" aria-hidden="true" />
          MCS 参加情報
        </h2>
        <CardDescription>
          MCS の連携有無、参加状態、薬局側参加者、主な連携先を保存します。
        </CardDescription>
        {profile?.updatedAt ? (
          <CardAction>
            <span className="text-xs text-muted-foreground">
              更新 {formatDateTimeLabel(profile.updatedAt, { fallback: '未記録' })}
            </span>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="mcs-linked-status" className="text-sm font-medium">
              MCS連携
            </label>
            <select
              id="mcs-linked-status"
              className="min-h-11 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring"
              value={linkedStatus}
              onChange={(event) => setLinkedStatus(event.target.value)}
            >
              {MCS_LINKED_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mcs-participation-status" className="text-sm font-medium">
              参加状況
            </label>
            <select
              id="mcs-participation-status"
              className="min-h-11 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring"
              value={participationStatus}
              onChange={(event) => setParticipationStatus(event.target.value)}
            >
              {MCS_PARTICIPATION_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mcs-pharmacy-participants" className="text-sm font-medium">
              薬局側参加者
            </label>
            <Textarea
              id="mcs-pharmacy-participants"
              value={pharmacyParticipants}
              onChange={(event) => setPharmacyParticipants(event.target.value)}
              placeholder="例: 薬剤師 佐藤、事務 鈴木"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mcs-last-checked-at" className="text-sm font-medium">
              最終確認日時
            </label>
            <Input
              id="mcs-last-checked-at"
              type="datetime-local"
              value={lastCheckedAt}
              onChange={(event) => setLastCheckedAt(event.target.value)}
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">主な連携先</legend>
          <div className="flex flex-wrap gap-2">
            {MCS_COUNTERPART_ROLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={counterpartRoles.includes(option.value)}
                  onChange={() => toggleCounterpartRole(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor="mcs-profile-note" className="text-sm font-medium">
            備考
          </label>
          <Textarea
            id="mcs-profile-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例: 招待は完了。訪問看護とケアマネの投稿を毎朝確認。"
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="mr-2"
            onClick={() => {
              const now = currentDateTimeLocalValue();
              setLastCheckedAt(now);
              onSave(buildInput(now));
            }}
            disabled={isSaving}
          >
            最終確認を今に更新
          </Button>
          <Button type="button" onClick={() => onSave(buildInput())} disabled={isSaving}>
            <Save className="mr-1.5 size-4" aria-hidden="true" />
            {isSaving ? '保存中...' : '参加情報を保存'}
          </Button>
        </div>
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
          <PatientMcsMessagesLoadingState />
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
                          {message.postedAtLabel ||
                            formatDateTimeLabel(message.postedAt, { fallback: '未記録' })}
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

function PatientMcsCheckLogPanel({
  logs,
  isSaving,
  onCreate,
}: {
  logs: PatientMcsViewCheckLog[];
  isSaving: boolean;
  onCreate: (input: PatientMcsCheckLogInput, onConfirmed: () => void) => void;
}) {
  const [contentType, setContentType] = useState('report');
  const [summary, setSummary] = useState('');
  const [nextAction, setNextAction] = useState('');
  const canSubmit = summary.trim().length > 0 && !isSaving;

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
          <Clipboard className="size-4" aria-hidden="true" />
          MCS 確認ログ
        </h2>
        <CardDescription>
          MCS を開いて確認した内容、区分、次アクションを PH-OS 側に残します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <label htmlFor="mcs-log-content-type" className="text-sm font-medium">
              内容区分
            </label>
            <select
              id="mcs-log-content-type"
              className="min-h-11 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring"
              value={contentType}
              onChange={(event) => setContentType(event.target.value)}
            >
              {MCS_LOG_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mcs-log-summary" className="text-sm font-medium">
              要約
            </label>
            <Textarea
              id="mcs-log-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="例: 訪看から食欲低下の共有。次回訪問時に水分量を確認する。"
            />
          </div>
          <div className="space-y-1.5 lg:col-start-2">
            <label htmlFor="mcs-log-next-action" className="text-sm font-medium">
              次アクション
            </label>
            <Input
              id="mcs-log-next-action"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="例: 医師へ服薬状況を確認"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              onCreate({ contentType, summary, nextAction }, () => {
                setSummary('');
                setNextAction('');
              });
            }}
            disabled={!canSubmit}
          >
            {isSaving ? '登録中...' : '確認ログを登録'}
          </Button>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">直近の確認ログ</h3>
          {logs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              MCS 確認ログはまだありません。
            </p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li key={log.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{log.subject ?? 'MCS 確認'}</p>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTimeLabel(log.occurredAt, { fallback: '未記録' })}
                    </span>
                  </div>
                  {log.content ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {log.content}
                    </p>
                  ) : null}
                  {log.counterpartName ? (
                    <p className="mt-2 text-xs text-muted-foreground">{log.counterpartName}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
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
        <p className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-xs text-state-confirm">
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
  const lastLoggedOverviewErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mcsQuery.isError) {
      lastLoggedOverviewErrorRef.current = null;
      return;
    }
    if (lastLoggedOverviewErrorRef.current === mcsQuery.error) return;
    lastLoggedOverviewErrorRef.current = mcsQuery.error;
    clientLog.warn('patient_mcs.overview_fetch_failed', mcsQuery.error, {
      ...patientMcsLogContext('patient_mcs'),
    });
  }, [mcsQuery.error, mcsQuery.isError]);

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
    onError: async (error: unknown) => {
      await queryClient.invalidateQueries({ queryKey: queryKeyPrefix });
      const status = getPatientMcsMutationStatus(error);
      clientLog.warn('patient_mcs.sync_failed', error, {
        ...patientMcsLogContext('patient_mcs_sync', status),
      });
      toast.error(
        getPatientMcsMutationFailureMessage(error, MCS_SYNC_FAILURE_MESSAGE, {
          conflictMessage: MCS_SYNC_CONFLICT_MESSAGE,
        }),
      );
    },
  });

  const checkLogMutation = useMutation({
    mutationFn: (input: PatientMcsCheckLogInput) =>
      createPatientMcsCheckLog(patientId, orgId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeyPrefix });
      toast.success('MCS 確認ログを登録しました');
    },
    onError: (error: unknown) => {
      const status = getPatientMcsMutationStatus(error);
      clientLog.warn('patient_mcs.check_log_create_failed', error, {
        ...patientMcsLogContext('patient_mcs_check_log', status),
      });
      toast.error(getPatientMcsMutationFailureMessage(error, MCS_CHECK_LOG_FAILURE_MESSAGE));
    },
  });

  const profileMutation = useMutation({
    mutationFn: (input: PatientMcsProfileInput) => updatePatientMcsProfile(patientId, orgId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeyPrefix });
      toast.success('MCS 参加情報を保存しました');
    },
    onError: (error: unknown) => {
      const status = getPatientMcsMutationStatus(error);
      clientLog.warn('patient_mcs.profile_save_failed', error, {
        ...patientMcsLogContext('patient_mcs_profile', status),
      });
      toast.error(getPatientMcsMutationFailureMessage(error, MCS_PROFILE_FAILURE_MESSAGE));
    },
  });

  if (orgId.length === 0) {
    return <PatientMcsOverviewLoadingState />;
  }

  const overviewFailure = mcsQuery.isError
    ? getPatientMcsOverviewFailureState(mcsQuery.error)
    : null;

  if (overviewFailure) {
    return (
      <ErrorState
        variant={overviewFailure.variant}
        title={MCS_OVERVIEW_ERROR_TITLE}
        cause={overviewFailure.cause}
        nextAction={overviewFailure.nextAction}
        onRetry={() => void mcsQuery.refetch()}
        retryLabel="再読み込み"
        retryVariant="outline"
        retrySize="sm"
        live="assertive"
      />
    );
  }

  const link = mcsQuery.data?.link ?? null;
  const profile = mcsQuery.data?.profile ?? null;
  const summary = mcsQuery.data?.summary ?? null;
  const messages = orderPatientMcsMessages(mcsQuery.data?.messages ?? [], 'asc');
  const checkLogs = mcsQuery.data?.checkLogs ?? [];
  const canSync = Boolean(link?.sourceUrl);

  return (
    <div className="space-y-6">
      <PatientMcsSyncPanel
        key={link?.sourceUrl ? `sync:${link.sourceUrl}` : 'sync:empty'}
        link={link}
        isLoading={mcsQuery.isLoading}
        isSyncing={syncMutation.isPending}
        onSync={(sourceUrl) => syncMutation.mutate(sourceUrl)}
      />
      <PatientMcsProfilePanel
        key={profile?.updatedAt ? `profile:${profile.updatedAt}` : 'profile:empty'}
        profile={profile}
        isSaving={profileMutation.isPending}
        onSave={(input) => profileMutation.mutate(input)}
      />
      <PatientMcsSummaryPanel summary={summary} link={link} />
      <PatientMcsCheckLogPanel
        logs={checkLogs}
        isSaving={checkLogMutation.isPending}
        onCreate={(input, onConfirmed) =>
          checkLogMutation.mutate(input, { onSuccess: onConfirmed })
        }
      />
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
