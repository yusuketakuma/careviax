'use client';

import Link from 'next/link';
import { AlertTriangle, ClipboardList, Clock3, RefreshCw, ShieldAlert, UserX } from 'lucide-react';
import { z } from 'zod';
import { PageSection } from '@/components/layout/page-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { SkeletonRows } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import { PRIORITY_ROLE } from '@/lib/constants/status-labels';
import { formatDateLabel } from '@/lib/ui/date-format';

const taskHealthRefSchema = z.object({
  task_id: z.string(),
  display_id: z.string().nullable(),
  task_type: z.string(),
  priority: z.string(),
  due_at: z.string().nullable(),
  action_href: z.string(),
});

const taskHealthGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number(),
  urgent_count: z.number(),
  high_count: z.number(),
});

const taskHealthBoardSchema = z.object({
  generated_at: z.string(),
  scope: z.enum(['role_default', 'mine', 'team']),
  scan: z.object({
    statuses: z.array(z.string()),
    limit: z.number(),
    scanned_count: z.number(),
    truncated: z.boolean(),
  }),
  summary: z.object({
    open_count: z.number(),
    overdue_count: z.number(),
    sla_overdue_count: z.number(),
    unassigned_count: z.number(),
    patient_safety_count: z.number(),
    billing_close_count: z.number(),
    report_delay_count: z.number(),
    risk_task_count: z.number(),
    stale_risk_task_count: z.number(),
    orphan_risk_task_count: z.number(),
  }),
  task_type_groups: z.array(taskHealthGroupSchema),
  risk_domain_groups: z.array(taskHealthGroupSchema),
  orphan_audit: z.object({
    checked_count: z.number(),
    orphan_count: z.number(),
    reasons: z.array(
      z.object({
        reason: z.string(),
        count: z.number(),
      }),
    ),
    tasks: z.array(taskHealthRefSchema),
  }),
  attention: z.object({
    overdue_tasks: z.array(taskHealthRefSchema),
    sla_overdue_tasks: z.array(taskHealthRefSchema),
    unassigned_tasks: z.array(taskHealthRefSchema),
    stale_risk_tasks: z.array(taskHealthRefSchema),
  }),
});

export const taskHealthBoardEnvelopeSchema = z.object({
  data: taskHealthBoardSchema,
});

export type TaskHealthBoard = z.infer<typeof taskHealthBoardSchema>;
type TaskHealthRef = z.infer<typeof taskHealthRefSchema>;

type TaskHealthBoardPanelProps = {
  board: TaskHealthBoard | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

const SCOPE_LABELS: Record<TaskHealthBoard['scope'], string> = {
  role_default: 'ロール既定',
  mine: '自分',
  team: 'チーム',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  staff_work_request_visit: '訪問依頼',
  staff_work_request_audit: '監査依頼',
  staff_work_request_general: '業務依頼',
  visit_demand: '訪問候補',
  visit_preparation: '訪問準備',
  management_plan_review: '計画書',
  report_delivery_followup: '報告送達',
  report_response_followup: '報告返信待ち',
  communication_request_followup: '連携返信待ち',
  handoff_confirmation: '申し送り確認',
  conference_action_item: 'カンファレンス',
  emergency_coverage_gap: '当番体制',
  inquiry_workbench: '疑義照会',
  risk_resolution_medication: '薬剤リスク',
  risk_resolution_billing: '請求リスク',
  risk_resolution_report_delivery: '報告リスク',
  risk_resolution_consent_plan: '同意・計画リスク',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '緊急',
  high: '高',
  normal: '通常',
  low: '低',
};

const ORPHAN_REASON_LABELS: Record<string, string> = {
  invalid_metadata_source: 'source不整合',
  invalid_risk_domain: 'domain不整合',
  task_type_domain_mismatch: '種別不整合',
  missing_risk_key: 'risk_key欠落',
  invalid_dedupe_key: 'dedupe不整合',
  missing_owner_reference: '所有者欠落',
  related_entity_mismatch: '関連先不整合',
};

function priorityRole(priority: string) {
  return PRIORITY_ROLE[priority as keyof typeof PRIORITY_ROLE] ?? 'neutral';
}

function PriorityBadge({ priority }: { priority: string }) {
  const role = priorityRole(priority);
  const label = PRIORITY_LABELS[priority] ?? priority;
  if (role === 'neutral') {
    return (
      <Badge variant="outline" className="text-[11px] text-muted-foreground">
        {label}
      </Badge>
    );
  }
  return (
    <StateBadge role={role} showIcon={false} className="text-[11px]">
      {label}
    </StateBadge>
  );
}

function taskTypeLabel(taskType: string) {
  return TASK_TYPE_LABELS[taskType] ?? taskType;
}

function collectAttentionTasks(board: TaskHealthBoard): Array<TaskHealthRef & { reason: string }> {
  const seen = new Set<string>();
  const candidates: Array<{ reason: string; tasks: TaskHealthRef[] }> = [
    { reason: 'SLA超過', tasks: board.attention.sla_overdue_tasks },
    { reason: '期限超過', tasks: board.attention.overdue_tasks },
    { reason: '未割当', tasks: board.attention.unassigned_tasks },
    { reason: '古いrisk', tasks: board.attention.stale_risk_tasks },
    { reason: '孤児risk', tasks: board.orphan_audit.tasks },
  ];

  const results: Array<TaskHealthRef & { reason: string }> = [];
  for (const candidate of candidates) {
    for (const task of candidate.tasks) {
      if (seen.has(task.task_id)) continue;
      seen.add(task.task_id);
      results.push({ ...task, reason: candidate.reason });
      if (results.length >= 5) return results;
    }
  }
  return results;
}

function buildMetricItems(board: TaskHealthBoard) {
  return [
    {
      label: '未処理',
      value: board.summary.open_count,
      detail: `スキャン${board.scan.scanned_count}件`,
      tone: 'neutral' as const,
      icon: ClipboardList,
    },
    {
      label: 'SLA超過',
      value: board.summary.sla_overdue_count,
      detail: '先に処理',
      tone: board.summary.sla_overdue_count > 0 ? ('blocked' as const) : ('neutral' as const),
      icon: Clock3,
    },
    {
      label: '期限超過',
      value: board.summary.overdue_count,
      detail: 'due_date',
      tone: board.summary.overdue_count > 0 ? ('confirm' as const) : ('neutral' as const),
      icon: AlertTriangle,
    },
    {
      label: '未割当',
      value: board.summary.unassigned_count,
      detail: '担当なし',
      tone: board.summary.unassigned_count > 0 ? ('confirm' as const) : ('neutral' as const),
      icon: UserX,
    },
    {
      label: '患者安全',
      value: board.summary.patient_safety_count,
      detail: 'safety flag',
      tone: board.summary.patient_safety_count > 0 ? ('blocked' as const) : ('neutral' as const),
      icon: ShieldAlert,
    },
    {
      label: '孤児リスク',
      value: board.summary.orphan_risk_task_count,
      detail: `監査${board.orphan_audit.checked_count}件`,
      tone: board.summary.orphan_risk_task_count > 0 ? ('blocked' as const) : ('neutral' as const),
      icon: AlertTriangle,
    },
  ];
}

function metricClass(tone: 'neutral' | 'confirm' | 'blocked') {
  if (tone === 'blocked') return 'border-state-blocked/40 bg-state-blocked/10 text-state-blocked';
  if (tone === 'confirm') return 'border-state-confirm/40 bg-state-confirm/10 text-state-confirm';
  return 'border-border/70 bg-background text-foreground';
}

export function TaskHealthBoardPanel({
  board,
  isLoading,
  isError,
  onRetry,
}: TaskHealthBoardPanelProps) {
  const attentionTasks = board ? collectAttentionTasks(board) : [];
  const metricItems = board ? buildMetricItems(board) : [];
  const topRiskGroups = board?.risk_domain_groups.slice(0, 5) ?? [];
  const orphanReasons = board?.orphan_audit.reasons.slice(0, 4) ?? [];

  return (
    <PageSection
      title="オペレーショナル タスクヘルスボード"
      description="SLA、担当未割当、患者安全、請求・報告遅延、孤児 risk task をスキャン対象で集計します。"
      tone="subtle"
      actions={
        isError ? null : (
          <Button type="button" variant="outline" onClick={onRetry} className="!h-11 !min-h-[44px]">
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            ヘルス再読み込み
          </Button>
        )
      }
      contentClassName="space-y-4"
    >
      {isLoading ? (
        <div role="status" aria-label="タスクヘルスボードを読み込み中" aria-live="polite">
          <SkeletonRows rows={3} cols={6} status={false} />
        </div>
      ) : isError ? (
        <ErrorState
          size="inline"
          description="タスクヘルスボードを取得できませんでした。表示済み一覧の0件とは扱わず、再読み込みしてください。"
          onRetry={onRetry}
          retryLabel="ヘルス再読み込み"
        />
      ) : board ? (
        <>
          {board.scan.truncated ? (
            <Alert
              className="border-state-confirm/40 bg-state-confirm/10 text-state-confirm"
              role="alert"
            >
              <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
              <AlertDescription className="text-state-confirm">
                先頭{board.scan.limit}件で集計 / 未読込あり。件数はスキャン範囲内の下限です。
              </AlertDescription>
            </Alert>
          ) : null}

          <FilterSummaryBar
            items={[
              { label: '範囲', value: SCOPE_LABELS[board.scope] },
              { label: '状態', value: board.scan.statuses.join(' / ') },
              { label: 'スキャン', value: `${board.scan.scanned_count}件` },
              { label: 'risk task', value: `${board.summary.risk_task_count}件` },
              { label: '請求締め', value: `${board.summary.billing_close_count}件` },
              { label: '報告遅延', value: `${board.summary.report_delay_count}件` },
            ]}
          />

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {metricItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`rounded-lg border p-3 ${metricClass(item.tone)}`}
                  data-testid={`task-health-metric-${item.label}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </div>
                    {item.tone === 'blocked' ? (
                      <StateBadge role="blocked" showIcon={false} className="text-[11px]">
                        要対応
                      </StateBadge>
                    ) : item.tone === 'confirm' ? (
                      <StateBadge role="confirm" showIcon={false} className="text-[11px]">
                        確認
                      </StateBadge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-3xl font-semibold tabular-nums">{item.value}</p>
                  <p className="mt-1 text-xs opacity-80">{item.detail}</p>
                </div>
              );
            })}
          </div>

          {board.summary.open_count === 0 ? (
            <div className="rounded-md border border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
              スキャン対象に未処理タスクはありません。
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="space-y-3 rounded-lg border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">リスクドメイン別</h3>
                  <Badge variant="outline" className="text-xs">
                    上位{topRiskGroups.length}件
                  </Badge>
                </div>
                <div className="space-y-2">
                  {topRiskGroups.length > 0 ? (
                    topRiskGroups.map((group) => (
                      <div
                        key={group.key}
                        className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{group.label}</p>
                          <p className="text-xs text-muted-foreground">
                            緊急{group.urgent_count} / 高{group.high_count}
                          </p>
                        </div>
                        <span className="text-xl font-semibold tabular-nums">{group.count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      リスクドメイン付きタスクはありません。
                    </p>
                  )}
                </div>
                {orphanReasons.length > 0 ? (
                  <div className="rounded-md border border-state-blocked/30 bg-state-blocked/10 p-3 text-sm text-state-blocked">
                    <p className="font-medium">孤児risk理由</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {orphanReasons.map((reason) => (
                        <Badge
                          key={reason.reason}
                          variant="outline"
                          className="border-state-blocked/30 text-state-blocked"
                        >
                          {ORPHAN_REASON_LABELS[reason.reason] ?? reason.reason}: {reason.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">要注意タスクサンプル</h3>
                  <span className="text-xs text-muted-foreground">PHIを含まない参照だけ表示</span>
                </div>
                {attentionTasks.length > 0 ? (
                  <div className="space-y-2">
                    {attentionTasks.map((task) => (
                      <div
                        key={`${task.reason}:${task.task_id}`}
                        className="grid gap-2 border-b border-border/60 py-2 text-sm last:border-b-0 sm:grid-cols-[110px_1fr_auto]"
                      >
                        <div className="font-medium text-primary">
                          {task.display_id ?? task.task_id}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <PriorityBadge priority={task.priority} />
                            <Badge variant="outline" className="text-[11px]">
                              {task.reason}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {taskTypeLabel(task.task_type)} / 期限{' '}
                            {formatDateLabel(task.due_at, { pattern: 'MM/dd HH:mm' })}
                          </p>
                        </div>
                        <Button asChild variant="outline" className="!h-11 !min-h-[44px]">
                          <Link href={task.action_href}>確認</Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-border/70 px-3 py-3 text-sm text-muted-foreground">
                    要注意サンプルはありません。
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-md border border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
          タスクヘルスボードはまだ取得されていません。
        </div>
      )}
    </PageSection>
  );
}
