'use client';

import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import { ActionRail } from '@/components/ui/action-rail';
import { PageSection } from '@/components/layout/page-section';
import { SkeletonRows } from '@/components/ui/loading';
import {
  formatTaskDueLabel,
  taskPriorityClass,
  TASK_TYPE_LABELS,
  timeLabel,
  type Proposal,
  type ScheduleTask,
  type ScheduleTaskStatus,
  type VisitSchedule,
} from './day-view.shared';

type CallbackTaskStatusUpdate = Extract<ScheduleTaskStatus, 'in_progress' | 'completed'>;

export type ScheduleDayOperationalTasksPanelProps = {
  callbackTasks: ScheduleTask[];
  callbackTasksLoading: boolean;
  schedulingTasks: ScheduleTask[];
  tasksLoading: boolean;
  proposalById: ReadonlyMap<string, Proposal>;
  scheduleById: ReadonlyMap<string, VisitSchedule>;
  pharmacistNameById: ReadonlyMap<string, string>;
  callbackTaskPending: boolean;
  rescheduleApprovalPending: boolean;
  onRecordCallbackTask: (task: ScheduleTask, proposal: Proposal) => void;
  onUpdateCallbackTaskStatus: (taskId: string, status: CallbackTaskStatusUpdate) => void;
  onOpenPreparation: (schedule: VisitSchedule) => void;
  onApproveOverride: (schedule: VisitSchedule) => void;
  headingLevel?: 2 | 3;
};

export function ScheduleDayOperationalTasksPanel({
  callbackTasks,
  callbackTasksLoading,
  schedulingTasks,
  tasksLoading,
  proposalById,
  scheduleById,
  pharmacistNameById,
  callbackTaskPending,
  rescheduleApprovalPending,
  onRecordCallbackTask,
  onUpdateCallbackTaskStatus,
  onOpenPreparation,
  onApproveOverride,
  headingLevel = 2,
}: ScheduleDayOperationalTasksPanelProps) {
  const showEmptyState =
    !callbackTasksLoading &&
    !tasksLoading &&
    callbackTasks.length === 0 &&
    schedulingTasks.length === 0;

  return (
    <PageSection
      title="運用タスク"
      description="スケジュールに影響する未完了タスクを優先順で表示します"
      contentClassName="space-y-4"
      headingLevel={headingLevel}
    >
      {callbackTasksLoading ? (
        <TaskLoadingState label="再架電タスクを読み込んでいます..." />
      ) : callbackTasks.length > 0 ? (
        <div className="space-y-3">
          <div className="rounded-xl border-l-4 border-border/70 border-l-tag-info bg-card px-3 py-2 text-xs text-tag-info">
            架電結果の再記録や折返し対応が必要な候補です。
          </div>
          <ul aria-label="再架電タスク" className="space-y-3">
            {callbackTasks.map((task) => {
              const relatedProposal = task.related_entity_id
                ? (proposalById.get(task.related_entity_id) ?? null)
                : null;

              return (
                <CallbackTaskItem
                  key={task.id}
                  task={task}
                  relatedProposal={relatedProposal}
                  pharmacistNameById={pharmacistNameById}
                  callbackTaskPending={callbackTaskPending}
                  onRecordCallbackTask={onRecordCallbackTask}
                  onUpdateCallbackTaskStatus={onUpdateCallbackTaskStatus}
                />
              );
            })}
          </ul>
        </div>
      ) : null}

      {tasksLoading ? (
        <TaskLoadingState label="運用タスクを読み込んでいます..." />
      ) : schedulingTasks.length > 0 ? (
        <ul aria-label="スケジュール運用タスク" className="space-y-3">
          {schedulingTasks.map((task) => {
            const relatedSchedule =
              task.related_entity_type === 'visit_schedule' && task.related_entity_id
                ? (scheduleById.get(task.related_entity_id) ?? null)
                : null;

            return (
              <SchedulingTaskItem
                key={task.id}
                task={task}
                relatedSchedule={relatedSchedule}
                pharmacistNameById={pharmacistNameById}
                rescheduleApprovalPending={rescheduleApprovalPending}
                onOpenPreparation={onOpenPreparation}
                onApproveOverride={onApproveOverride}
              />
            );
          })}
        </ul>
      ) : showEmptyState ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          スケジュール関連の未完了タスクはありません
        </div>
      ) : null}
    </PageSection>
  );
}

function TaskLoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-live="polite"
      className="rounded-xl border border-dashed border-border bg-card px-3 py-4"
    >
      <SkeletonRows rows={2} cols={3} status={false} />
    </div>
  );
}

function CallbackTaskItem({
  task,
  relatedProposal,
  pharmacistNameById,
  callbackTaskPending,
  onRecordCallbackTask,
  onUpdateCallbackTaskStatus,
}: {
  task: ScheduleTask;
  relatedProposal: Proposal | null;
  pharmacistNameById: ReadonlyMap<string, string>;
  callbackTaskPending: boolean;
  onRecordCallbackTask: (task: ScheduleTask, proposal: Proposal) => void;
  onUpdateCallbackTaskStatus: (taskId: string, status: CallbackTaskStatusUpdate) => void;
}) {
  const targetLabel = buildCallbackTaskTargetLabel(task, relatedProposal);

  return (
    <li className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
      <TaskHeader
        task={task}
        pharmacistNameById={pharmacistNameById}
        trailingBadge={
          task.status === 'in_progress' ? (
            <StateBadge role="info">対応中</StateBadge>
          ) : (
            <StateBadge role="confirm">未着手</StateBadge>
          )
        }
      />

      {(relatedProposal || task.description) && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {relatedProposal ? (
            <p>{formatProposalContext(relatedProposal)}</p>
          ) : (
            <p>対象候補は現在の表示週外です。</p>
          )}
          {task.description && <p className="leading-5">{task.description}</p>}
        </div>
      )}

      <ActionRail align="start" className="pt-1">
        {relatedProposal && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRecordCallbackTask(task, relatedProposal)}
            disabled={callbackTaskPending}
            aria-label={`${targetLabel} の架電結果を記録`}
          >
            架電結果を記録
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onUpdateCallbackTaskStatus(task.id, 'in_progress')}
          disabled={callbackTaskPending || task.status === 'in_progress'}
          aria-label={`${targetLabel} を対応中にする`}
        >
          対応中にする
        </Button>
        <Button
          size="sm"
          onClick={() => onUpdateCallbackTaskStatus(task.id, 'completed')}
          disabled={callbackTaskPending}
          aria-label={`${targetLabel} を完了にする`}
        >
          完了
        </Button>
      </ActionRail>
    </li>
  );
}

function SchedulingTaskItem({
  task,
  relatedSchedule,
  pharmacistNameById,
  rescheduleApprovalPending,
  onOpenPreparation,
  onApproveOverride,
}: {
  task: ScheduleTask;
  relatedSchedule: VisitSchedule | null;
  pharmacistNameById: ReadonlyMap<string, string>;
  rescheduleApprovalPending: boolean;
  onOpenPreparation: (schedule: VisitSchedule) => void;
  onApproveOverride: (schedule: VisitSchedule) => void;
}) {
  const canApproveOverride =
    task.task_type === 'visit_schedule_override_approval' && relatedSchedule;
  const canOpenPreparation = task.task_type === 'visit_preparation' && relatedSchedule;
  const targetLabel = buildSchedulingTaskTargetLabel(task, relatedSchedule);

  return (
    <li className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
      <TaskHeader task={task} pharmacistNameById={pharmacistNameById} />

      {(relatedSchedule || task.description) && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {relatedSchedule && <p>{formatScheduleContext(relatedSchedule)}</p>}
          {task.description && <p className="leading-5">{task.description}</p>}
        </div>
      )}

      {task.task_type === 'visit_schedule_override_approval' &&
        task.related_entity_id &&
        !relatedSchedule && (
          <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-xs text-state-confirm">
            対象予定をこの週の予定一覧で確認してから変更承認してください。
          </div>
        )}

      {(canApproveOverride || canOpenPreparation) && (
        <ActionRail align="start" className="pt-1">
          {canOpenPreparation && relatedSchedule && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenPreparation(relatedSchedule)}
              aria-label={`${targetLabel} の準備チェックを開く`}
            >
              準備チェック
            </Button>
          )}
          {canApproveOverride && relatedSchedule && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onApproveOverride(relatedSchedule)}
              disabled={rescheduleApprovalPending}
              aria-label={`${targetLabel} の変更承認を確認`}
            >
              変更承認
            </Button>
          )}
        </ActionRail>
      )}
    </li>
  );
}

function TaskHeader({
  task,
  pharmacistNameById,
  trailingBadge,
}: {
  task: ScheduleTask;
  pharmacistNameById: ReadonlyMap<string, string>;
  trailingBadge?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{task.title}</h3>
          <Badge variant="outline">{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</Badge>
          <Badge variant="outline" className={taskPriorityClass(task.priority)}>
            {task.priority}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          期限 {formatTaskDueLabel(task)}
          {task.assigned_to
            ? ` / 担当 ${pharmacistNameById.get(task.assigned_to) ?? '未登録'}`
            : ''}
        </p>
      </div>
      {trailingBadge}
    </div>
  );
}

function formatProposalContext(proposal: Proposal) {
  return `${proposal.case_.patient.name} / ${format(parseISO(proposal.proposed_date), 'M/d', {
    locale: ja,
  })} ${timeLabel(proposal.time_window_start, proposal.time_window_end)}`;
}

function formatScheduleContext(schedule: VisitSchedule) {
  return `${schedule.case_.patient.name} / ${format(parseISO(schedule.scheduled_date), 'M/d', {
    locale: ja,
  })} ${timeLabel(schedule.time_window_start, schedule.time_window_end)}`;
}

function buildCallbackTaskTargetLabel(task: ScheduleTask, proposal: Proposal | null) {
  if (!proposal) return task.title;
  return `${proposal.case_.patient.name} ${format(parseISO(proposal.proposed_date), 'M/d', {
    locale: ja,
  })} ${timeLabel(proposal.time_window_start, proposal.time_window_end)}`;
}

function buildSchedulingTaskTargetLabel(task: ScheduleTask, schedule: VisitSchedule | null) {
  if (!schedule) return task.title;
  return `${schedule.case_.patient.name} ${format(parseISO(schedule.scheduled_date), 'M/d', {
    locale: ja,
  })} ${timeLabel(schedule.time_window_start, schedule.time_window_end)}`;
}
