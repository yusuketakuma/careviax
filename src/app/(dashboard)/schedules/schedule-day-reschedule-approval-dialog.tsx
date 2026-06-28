'use client';

import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  readImpactCount,
  readImpactedPatientNames,
  timeLabel,
  type Proposal,
  type VisitSchedule,
} from './day-view.shared';

export type ScheduleDayRescheduleApprovalTarget = {
  scheduleId: string;
  sourceLabel: string;
  patientName: string;
  currentScheduleLabel: string;
  proposedScheduleLabel: string | null;
  reason: string;
  impactCount: number | null;
  proposedReplacementCount: number | null;
  impactedPatientNames: string[];
};

export type ScheduleDayRescheduleApprovalDialogProps = {
  target: ScheduleDayRescheduleApprovalTarget | null;
  approving: boolean;
  onCancel: () => void;
  onConfirm: (scheduleId: string) => void;
};

export function ScheduleDayRescheduleApprovalDialog({
  target,
  approving,
  onCancel,
  onConfirm,
}: ScheduleDayRescheduleApprovalDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>変更承認の確認</DialogTitle>
          <DialogDescription>
            患者、対象予定、変更理由、影響範囲を確認してから承認します。
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <div className="space-y-4">
            <div className="rounded-xl border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-state-confirm">
              <p className="font-medium">{target.patientName}さんの確定済み訪問を変更します</p>
              <p className="mt-1 text-xs leading-5 text-state-confirm/90">
                承認すると、この予定の変更依頼を確定し、関連する候補・タスクが更新されます。
              </p>
            </div>

            <dl className="grid gap-3 text-sm">
              <div className="grid gap-1">
                <dt className="text-xs font-medium text-muted-foreground">呼び出し元</dt>
                <dd className="text-foreground">{target.sourceLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs font-medium text-muted-foreground">対象予定</dt>
                <dd className="text-foreground">{target.currentScheduleLabel}</dd>
              </div>
              {target.proposedScheduleLabel ? (
                <div className="grid gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">再提案候補</dt>
                  <dd className="text-foreground">{target.proposedScheduleLabel}</dd>
                </div>
              ) : null}
              <div className="grid gap-1">
                <dt className="text-xs font-medium text-muted-foreground">変更理由</dt>
                <dd className="text-foreground">{target.reason}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs font-medium text-muted-foreground">影響範囲</dt>
                <dd className="text-foreground">
                  影響予定 {target.impactCount ?? '未計算'} 件 / 再提案候補{' '}
                  {target.proposedReplacementCount ?? '未計算'} 件
                </dd>
              </div>
              {target.impactedPatientNames.length > 0 ? (
                <div className="grid gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">影響患者</dt>
                  <dd className="text-foreground">{target.impactedPatientNames.join('、')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={approving}>
            キャンセル
          </Button>
          <Button
            onClick={() => {
              if (target) onConfirm(target.scheduleId);
            }}
            disabled={!target || approving}
          >
            {approving || !target ? '承認中...' : `${target.patientName}さんの変更を承認`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function buildScheduleDayRescheduleApprovalTargetFromSchedule(
  schedule: VisitSchedule,
  sourceLabel: string,
): ScheduleDayRescheduleApprovalTarget {
  const impactSummary = schedule.override_request?.impact_summary;

  return {
    scheduleId: schedule.id,
    sourceLabel,
    patientName: schedule.case_.patient.name,
    currentScheduleLabel: formatScheduleLabel(
      schedule.scheduled_date,
      schedule.time_window_start,
      schedule.time_window_end,
    ),
    proposedScheduleLabel: null,
    reason: schedule.override_request?.reason || '理由未記録',
    impactCount: readImpactCount(impactSummary),
    proposedReplacementCount: readProposedReplacementCount(impactSummary),
    impactedPatientNames: readImpactedPatientNames(impactSummary),
  };
}

export function buildScheduleDayRescheduleApprovalTargetFromProposal(
  proposal: Proposal,
): ScheduleDayRescheduleApprovalTarget | null {
  const sourceScheduleId = proposal.reschedule_source_schedule_id;
  if (!sourceScheduleId) return null;

  const impactSummary = proposal.reschedule_source_schedule?.override_request?.impact_summary;

  return {
    scheduleId: sourceScheduleId,
    sourceLabel: '候補一覧',
    patientName: proposal.case_.patient.name,
    currentScheduleLabel: proposal.reschedule_source_schedule
      ? formatScheduleLabel(proposal.reschedule_source_schedule.scheduled_date, null, null)
      : '変更元予定を確認してください',
    proposedScheduleLabel: formatScheduleLabel(
      proposal.proposed_date,
      proposal.time_window_start,
      proposal.time_window_end,
    ),
    reason: proposal.proposal_reason || '理由未記録',
    impactCount: readImpactCount(impactSummary),
    proposedReplacementCount: readProposedReplacementCount(impactSummary),
    impactedPatientNames: readImpactedPatientNames(impactSummary),
  };
}

function formatScheduleLabel(date: string, start: string | null, end: string | null) {
  const dateLabel = format(parseISO(date), 'yyyy/MM/dd(E)', { locale: ja });
  return `${dateLabel} ${timeLabel(start, end)}`;
}

function readProposedReplacementCount(impactSummary: Record<string, unknown> | null | undefined) {
  if (!impactSummary) return null;
  const value = impactSummary.proposed_replacements;
  return typeof value === 'number' ? value : null;
}
