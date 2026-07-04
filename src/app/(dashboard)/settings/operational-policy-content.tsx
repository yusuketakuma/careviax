'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, History, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { buildDailyOpsBlockedReasons } from '@/lib/workspace/daily-ops-rail';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';
import {
  groupSystemSettingCandidates,
  SYSTEM_SETTING_STATUS_LABELS,
  SYSTEM_SETTING_STATUS_TONE,
} from '@/lib/settings/system-settings-inventory';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';

/**
 * new_14_settings(docs/design-gap-analysis-new.md 14_settings)の薬局運用ポリシー。
 * メイン2列(安全/働き方 + 通知/影響範囲バナー)。
 * 補助3点セット(次にやること/止まっている理由/根拠・記録)は右ドロワーで開く。
 * 安全に関わるロック項目は「🔒 変更できません」で隠さず明示する。
 * 変更可能な項目は保存前に影響範囲(誰の・どの画面が変わるか)を確認してから反映する。
 */

export type SensitivityLevel = 'low' | 'standard' | 'high';

export type OperationalPolicy = {
  safety_sign_sensitivity: SensitivityLevel;
  slack_auto_calc: boolean;
  interrupt_guard: boolean;
  wait_release_notification: boolean;
  quiet_hours: boolean;
};

export type OperationalPolicyResponse = {
  generated_at: string;
  pharmacy_label: string;
  can_edit: boolean;
  policy: OperationalPolicy;
  locked_items: Array<{ key: string; label: string; reason: string }>;
  wip_revision_label: string;
  change_log_count_this_month: number;
};

async function fetchOperationalPolicy(orgId: string): Promise<OperationalPolicyResponse> {
  const res = await fetch('/api/settings/operational-policy', {
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('運用ポリシーの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function patchOperationalPolicy(
  orgId: string,
  values: Partial<OperationalPolicy>,
): Promise<OperationalPolicyResponse> {
  const res = await fetch('/api/settings/operational-policy', {
    method: 'PATCH',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? '運用ポリシーの更新に失敗しました');
  }
  const json = await res.json();
  return json.data;
}

async function fetchCockpitForRail(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('当日の優先タスク取得に失敗しました');
  const json = await res.json();
  return json.data;
}

// ---------------------------------------------------------------------------
// 行コントロール(ロックピル / 低・標準・高 / ON-OFF ピル)
// ---------------------------------------------------------------------------

function LockedPill() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
      data-testid="policy-locked-pill"
    >
      <Lock className="size-3" aria-hidden="true" />
      変更できません
    </span>
  );
}

const SENSITIVITY_OPTIONS: Array<{ value: SensitivityLevel; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'standard', label: '標準' },
  { value: 'high', label: '高' },
];

function sensitivityLabel(value: SensitivityLevel) {
  return SENSITIVITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function SensitivitySegment({
  value,
  disabled,
  onSelect,
}: {
  value: SensitivityLevel;
  disabled: boolean;
  onSelect: (next: SensitivityLevel) => void;
}) {
  return (
    <div
      role="group"
      aria-label="安全サインの感度"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/70 bg-card p-0.5"
    >
      {SENSITIVITY_OPTIONS.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            title={disabled ? '管理者のみ変更できます' : undefined}
            onClick={() => {
              if (!isActive) onSelect(option.value);
            }}
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function OnOffPill({
  on,
  disabled,
  label,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={disabled ? '管理者のみ変更できます' : undefined}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full border px-3 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        on
          ? 'border-state-done/30 bg-state-done/10 text-state-done'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {on ? 'ON' : 'OFF'}
    </button>
  );
}

function PolicyRow({
  title,
  description,
  control,
  meta,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <li className="rounded-md border border-border/70 bg-card px-3 py-2.5" data-testid="policy-row">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-foreground">{title}</p>
        <span className="flex shrink-0 items-center gap-2">
          {meta}
          {control}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </li>
  );
}

function PolicyCard({
  title,
  note,
  children,
  testId,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-label={title}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <ul className="mt-3 space-y-2" role="list">
        {children}
      </ul>
    </section>
  );
}

function PolicyPrimaryStrip({
  lockedCount,
  changeLogCount,
  nextAction,
  blockedReasons,
  cockpitError,
}: {
  lockedCount: number;
  changeLogCount: number;
  nextAction: NextActionPanelProps;
  blockedReasons: BlockedReason[];
  cockpitError: boolean;
}) {
  const topBlockedReason = blockedReasons[0] ?? null;

  return (
    <section
      className="mt-4 overflow-hidden rounded-lg border border-border/70 bg-card"
      aria-label="設定変更の安全確認"
      data-testid="policy-primary-strip"
    >
      <div className="grid divide-y divide-border/70 md:grid-cols-[1.05fr_1fr_1.2fr] md:divide-x md:divide-y-0">
        <div className="flex gap-3 p-3.5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-state-done" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">保存前に影響範囲を確認</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              変更前後・対象画面・ロック項目を確認してから反映します。
            </p>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {lockedCount}項目ロック / 今月{changeLogCount}件の変更履歴
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-3.5" data-testid="policy-blocked-summary">
          {cockpitError ? (
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-state-blocked"
              aria-hidden="true"
            />
          ) : topBlockedReason ? (
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-state-confirm"
              aria-hidden="true"
            />
          ) : (
            <History className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">止まっている理由</p>
            <p
              className={cn(
                'mt-1 text-xs leading-5',
                cockpitError ? 'font-semibold text-state-blocked' : 'text-muted-foreground',
              )}
            >
              {cockpitError
                ? '取得に失敗しました。「止まっている作業はありません」ではありません。再試行してください。'
                : topBlockedReason
                  ? `${topBlockedReason.label}${topBlockedReason.ageLabel ? ` / ${topBlockedReason.ageLabel}` : ''}`
                  : 'いま期限で止まっている作業はありません。'}
            </p>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {cockpitError
                ? '—'
                : blockedReasons.length > 0
                  ? `${blockedReasons.length}件を補助パネルで確認`
                  : '補助パネルに根拠を保持'}
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-3.5">
          <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">次にやること</p>
            {nextAction.description ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {nextAction.description}
              </p>
            ) : null}
            {nextAction.actionHref ? (
              <Button
                asChild
                className="mt-3 h-11 min-h-11 w-full justify-center sm:h-11 sm:min-h-11"
              >
                <Link href={nextAction.actionHref}>{nextAction.actionLabel}</Link>
              </Button>
            ) : (
              <Button
                type="button"
                className="mt-3 h-11 min-h-11 w-full justify-center sm:h-11 sm:min-h-11"
                onClick={nextAction.onAction}
                disabled={nextAction.actionDisabled}
              >
                {nextAction.actionLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 影響範囲の確認(保存前)
// ---------------------------------------------------------------------------

type PendingChange = {
  values: Partial<OperationalPolicy>;
  title: string;
  impact: string;
  currentLabel: string;
  nextLabel: string;
  affectedScreens: string[];
};

function ConfirmSummary({
  change,
  lockedItemLabels,
}: {
  change: PendingChange;
  lockedItemLabels: string[];
}) {
  return (
    <div className="space-y-3" data-testid="policy-change-summary">
      <p className="text-sm leading-6 text-muted-foreground">{change.impact}</p>
      <div className="grid gap-2 rounded-md border border-border/70 bg-muted/30 p-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">変更前</p>
          <p className="mt-1 font-bold text-foreground">{change.currentLabel}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground">変更後</p>
          <p className="mt-1 font-bold text-foreground">{change.nextLabel}</p>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground">影響する画面</p>
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="影響する画面">
          {change.affectedScreens.map((screen) => (
            <li
              key={screen}
              className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs font-semibold text-foreground"
            >
              {screen}
            </li>
          ))}
        </ul>
      </div>
      <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        ロック項目({lockedItemLabels.join('・')})はこの変更では動きません。
      </p>
    </div>
  );
}

const SETTING_CANDIDATE_GROUPS = groupSystemSettingCandidates();

function SettingsCandidateInventory() {
  const totalCount = SETTING_CANDIDATE_GROUPS.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="settings-candidate-inventory-heading"
      data-testid="settings-candidate-inventory"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="settings-candidate-inventory-heading" className="text-base font-bold">
            設定に寄せる候補
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            コード全体の設定値・端末保存・環境変数・固定値をスキャンし、運用画面へ集約すべき項目をジャンル別に整理しています。
          </p>
        </div>
        <span className="rounded-full border border-border/70 bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          {SETTING_CANDIDATE_GROUPS.length}ジャンル / {totalCount}項目
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {SETTING_CANDIDATE_GROUPS.map((group) => (
          <section
            key={group.genre}
            className="rounded-md border border-border/70 bg-background p-3"
            aria-label={group.label}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-foreground">{group.label}</h3>
              <span className="text-xs font-semibold text-muted-foreground">
                {group.items.length}項目
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {group.items.map((item) => (
                <li key={item.id} className="rounded-md border border-border/60 bg-card p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground">{item.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        現在: {item.currentSurface}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
                        SYSTEM_SETTING_STATUS_TONE[item.status],
                      )}
                    >
                      {SYSTEM_SETTING_STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-foreground">{item.recommendation}</p>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    根拠: {item.evidence.join(' / ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function PolicySkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      role="status"
      aria-label="設定読み込み中"
    >
      {Array.from({ length: 2 }).map((_, columnIndex) => (
        <div key={columnIndex} className="space-y-4">
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function OperationalPolicyContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);

  const policyQuery = useQuery({
    queryKey: ['operational-policy', orgId],
    queryFn: () => fetchOperationalPolicy(orgId),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
  const cockpitQuery = useQuery({
    queryKey: ['settings-rail-cockpit', orgId],
    queryFn: () => fetchCockpitForRail(orgId),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (values: Partial<OperationalPolicy>) => patchOperationalPolicy(orgId, values),
    onSuccess: (data) => {
      queryClient.setQueryData(['operational-policy', orgId], data);
      toast.success('運用ポリシーを更新しました');
    },
    onError: (error) => {
      toast.error(messageFromError(error, '運用ポリシーの更新に失敗しました'));
    },
  });

  const data = policyQuery.data ?? null;
  const cockpitError = cockpitQuery.isError;
  const cockpit = cockpitError ? null : (cockpitQuery.data ?? null);
  const canEdit = data?.can_edit ?? false;
  const lockedCount = data?.locked_items.length ?? 0;

  function requestChange(change: PendingChange) {
    setPendingChange(change);
  }

  function confirmPendingChange() {
    if (pendingChange) {
      updateMutation.mutate(pendingChange.values);
    }
    setPendingChange(null);
  }

  // 右レール: 次にやること(主操作の青はこの1つ)/止まっている理由/根拠・記録
  const topAudit = cockpit?.audit_queue[0] ?? null;
  const auditVisit = topAudit
    ? (cockpit?.today_visits.find(
        (visit) => visit.time_start && visit.patient_name === topAudit.patient_name,
      ) ?? null)
    : null;
  const nextAction: NextActionPanelProps = cockpitError
    ? {
        actionLabel: '再試行する',
        description:
          '当日の優先タスクを取得できませんでした(取得失敗)。「止まっている作業はありません」ではありません。',
        onAction: () => void cockpitQuery.refetch(),
      }
    : topAudit
      ? {
          actionLabel: topAudit.due_at
            ? `${topAudit.has_narcotic ? '麻薬監査' : '監査'}を開始 — ${formatTimeOfDay(topAudit.due_at)}期限`
            : `${topAudit.has_narcotic ? '麻薬監査' : '監査'}を開始する`,
          description: auditVisit?.time_start
            ? `${formatTimeOfDay(auditVisit.time_start)}訪問(${topAudit.patient_name}様)の持参薬です。完了で午後の予定がすべて確定します。`
            : `${topAudit.patient_name}様の監査が待ちです。完了で次の工程が動き出します。`,
          actionHref: '/audit',
        }
      : {
          actionLabel: '今日の予定を確認する',
          description: 'いま期限で止まっている作業はありません。',
          actionHref: '/schedules',
        };
  const blockedReasons: BlockedReason[] = buildDailyOpsBlockedReasons(cockpit);
  const evidence: EvidenceItem[] = [
    {
      id: 'change-log',
      label: '設定の変更履歴',
      meta: `今月${data?.change_log_count_this_month ?? 0}件`,
      href: '/admin/audit-logs',
    },
    {
      id: 'permissions',
      label: '権限',
      meta: '管理者のみ変更可の項目あり',
      href: '/admin/staff',
    },
  ];

  return (
    <section aria-label="薬局運用ポリシー" data-testid="operational-policy">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-foreground">設定</h1>
        <span
          className="inline-flex min-h-7 max-w-full items-center rounded-full border border-border/70 bg-card px-3 text-sm font-medium text-muted-foreground"
          data-testid="policy-pharmacy-chip"
        >
          薬局: {data?.pharmacy_label ?? '—'}
        </span>
        <span
          className="inline-flex min-h-7 items-center gap-1 rounded-full border border-state-done/25 bg-state-done/10 px-3 text-sm font-semibold text-state-done"
          data-testid="policy-lock-summary"
        >
          <Lock className="size-3.5" aria-hidden="true" />
          安全{lockedCount}項目ロック
        </span>
      </div>

      <div className="mt-4">
        {!orgId || policyQuery.isLoading ? (
          <PolicySkeleton />
        ) : policyQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="設定を表示できません"
              description="運用ポリシーの取得に失敗しました。再試行してください。"
              detail={policyQuery.error instanceof Error ? policyQuery.error.message : undefined}
              onRetry={() => void policyQuery.refetch()}
            />
          </div>
        ) : (
          <>
            <PolicyPrimaryStrip
              lockedCount={lockedCount}
              changeLogCount={data.change_log_count_this_month}
              nextAction={nextAction}
              blockedReasons={blockedReasons}
              cockpitError={cockpitError}
            />

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {/* 左列: 安全 / 働き方 */}
              <div className="min-w-0 space-y-4">
                <PolicyCard
                  title="安全"
                  note="下げられない項目はロック表示"
                  testId="policy-safety-card"
                >
                  <PolicyRow
                    title="安全タグの表示"
                    description="麻薬・冷所・アレルギー等のタグはすべての画面で常時表示されます"
                    control={<LockedPill />}
                  />
                  <PolicyRow
                    title="安全サインの感度"
                    description="「気になるサイン」の通知頻度は調整できますが、安全タグより下げることはできません"
                    control={
                      <SensitivitySegment
                        value={data.policy.safety_sign_sensitivity}
                        disabled={!canEdit || updateMutation.isPending}
                        onSelect={(next) =>
                          requestChange({
                            values: { safety_sign_sensitivity: next },
                            title: '安全サインの感度を変更',
                            currentLabel: sensitivityLabel(data.policy.safety_sign_sensitivity),
                            nextLabel: sensitivityLabel(next),
                            affectedScreens: ['通知', 'ダッシュボード', '患者カード'],
                            impact:
                              '「気になるサイン」の通知頻度が変わります。対象: チーム全員の通知とダッシュボード表示。安全タグの常時表示は変わりません。',
                          })
                        }
                      />
                    }
                  />
                  <PolicyRow
                    title="二人制監査"
                    description="調剤者と監査者の同一人チェック"
                    control={<LockedPill />}
                  />
                </PolicyCard>

                <PolicyCard title="働き方" testId="policy-workstyle-card">
                  <PolicyRow
                    title="WIP目安"
                    description="工程ごとの仕掛かり上限(超過で赤表示)。変更はチーム全員のダッシュボードに影響します"
                    meta={
                      <span className="text-xs font-semibold text-state-confirm">
                        {data.wip_revision_label}
                      </span>
                    }
                    control={
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-11 min-h-11 sm:h-11 sm:min-h-11"
                      >
                        <Link href="/dashboard#dashboard-process-now">→ 詰まり管理へ</Link>
                      </Button>
                    }
                  />
                  <PolicyRow
                    title="余白の計算"
                    description="確定予定と移動時間から自動計算。手動の「ブロック時間」も余白から除外されます"
                    control={
                      <OnOffPill
                        on={data.policy.slack_auto_calc}
                        disabled={!canEdit || updateMutation.isPending}
                        label="余白の計算"
                        onToggle={() =>
                          requestChange({
                            values: { slack_auto_calc: !data.policy.slack_auto_calc },
                            title: '余白の計算を変更',
                            currentLabel: data.policy.slack_auto_calc ? 'ON' : 'OFF',
                            nextLabel: data.policy.slack_auto_calc ? 'OFF' : 'ON',
                            affectedScreens: ['スケジュール', 'ダッシュボード'],
                            impact:
                              'スケジュールの「余白」表示の計算方法が変わります。対象: チーム全員のスケジュール画面とダッシュボード。',
                          })
                        }
                      />
                    }
                  />
                  <PolicyRow
                    title="割り込み防護"
                    description="調剤・監査中は緊急(赤)以外の通知で画面を切り替えません"
                    control={
                      <OnOffPill
                        on={data.policy.interrupt_guard}
                        disabled={!canEdit || updateMutation.isPending}
                        label="割り込み防護"
                        onToggle={() =>
                          requestChange({
                            values: { interrupt_guard: !data.policy.interrupt_guard },
                            title: '割り込み防護を変更',
                            currentLabel: data.policy.interrupt_guard ? 'ON' : 'OFF',
                            nextLabel: data.policy.interrupt_guard ? 'OFF' : 'ON',
                            affectedScreens: ['調剤', '監査', '通知'],
                            impact:
                              '調剤・監査中の通知の出方が変わります。対象: チーム全員の調剤・監査画面。緊急(赤)の通知は常に表示されます。',
                          })
                        }
                      />
                    }
                  />
                </PolicyCard>
              </div>

              {/* 中央列: 通知 + 影響範囲バナー */}
              <div className="min-w-0 space-y-4">
                <PolicyCard title="通知" testId="policy-notification-card">
                  <PolicyRow
                    title="緊急(赤)の通知"
                    description="期限・安全に関わる通知 — 常にONです"
                    control={<LockedPill />}
                  />
                  <PolicyRow
                    title="待ち解除の通知"
                    description="止まっていた仕事が再開可能になったとき(照会回答の到着など)"
                    control={
                      <OnOffPill
                        on={data.policy.wait_release_notification}
                        disabled={!canEdit || updateMutation.isPending}
                        label="待ち解除の通知"
                        onToggle={() =>
                          requestChange({
                            values: {
                              wait_release_notification: !data.policy.wait_release_notification,
                            },
                            title: '待ち解除の通知を変更',
                            currentLabel: data.policy.wait_release_notification ? 'ON' : 'OFF',
                            nextLabel: data.policy.wait_release_notification ? 'OFF' : 'ON',
                            affectedScreens: ['通知', '工程の今', 'ハンドオフ'],
                            impact:
                              '止まっていた仕事が再開できるようになったときの通知が変わります。対象: チーム全員の通知。',
                          })
                        }
                      />
                    }
                  />
                  <PolicyRow
                    title="静かな時間"
                    description="訪問モード中は緊急以外をまとめて後で表示"
                    control={
                      <OnOffPill
                        on={data.policy.quiet_hours}
                        disabled={!canEdit || updateMutation.isPending}
                        label="静かな時間"
                        onToggle={() =>
                          requestChange({
                            values: { quiet_hours: !data.policy.quiet_hours },
                            title: '静かな時間を変更',
                            currentLabel: data.policy.quiet_hours ? 'ON' : 'OFF',
                            nextLabel: data.policy.quiet_hours ? 'OFF' : 'ON',
                            affectedScreens: ['訪問', '通知', 'モード表示'],
                            impact:
                              '訪問モード中の通知の出方が変わります。対象: 訪問担当者の画面。緊急(赤)の通知は常に表示されます。',
                          })
                        }
                      />
                    }
                  />
                </PolicyCard>

                <p
                  className="rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2.5 text-sm leading-6 text-state-confirm"
                  data-testid="policy-impact-banner"
                >
                  設定の変更は保存前に<strong className="font-bold">影響範囲</strong>
                  (誰の・どの画面が変わるか)を表示します。「いつの間にか変わっていた」を起こさないためです。
                </p>
              </div>

              <WorkspaceActionRail
                nextAction={nextAction}
                blockedReasons={blockedReasons}
                blockedReasonsEmptyLabel={
                  cockpitError
                    ? '取得に失敗しました(取得エラー)。再試行してください。'
                    : '止まっている作業はありません'
                }
                evidence={evidence}
                evidenceOpenLabel="開く"
              />
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        <SettingsCandidateInventory />
      </div>

      {/* 保存前の影響範囲確認(バナーの約束と挙動を一致させる) */}
      <AlertDialog
        open={pendingChange != null}
        onOpenChange={(open) => {
          if (!open) setPendingChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingChange?.title ?? '設定を変更'}</AlertDialogTitle>
            <AlertDialogDescription>
              変更内容、影響する画面、動かないロック項目を確認してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingChange ? (
            <ConfirmSummary
              change={pendingChange}
              lockedItemLabels={(data?.locked_items ?? []).map((item) => item.label)}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction disabled={updateMutation.isPending} onClick={confirmPendingChange}>
              {updateMutation.isPending ? '反映中' : '保存して反映'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
