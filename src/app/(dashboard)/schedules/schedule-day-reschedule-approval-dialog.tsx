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
  buildSafeMedicationConfirmationFacts,
  readImpactCount,
  readImpactedPatientNames,
  splitProposalReason,
  timeLabel,
  type Proposal,
  type SafeMedicationConfirmationFact,
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
  medicationSummary: SafeMedicationConfirmationFact[];
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
            患者、対象予定、変更理由、影響範囲、薬剤判断サマリーを確認してから承認します。
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
              {target.medicationSummary.length > 0 ? (
                <div className="grid gap-2 rounded-lg border border-state-confirm/25 bg-state-confirm/5 px-3 py-2">
                  {target.medicationSummary.map((fact) => (
                    <div key={fact.label} className="grid gap-1">
                      <dt className="text-xs font-medium text-state-confirm">
                        薬剤判断: {fact.label}
                      </dt>
                      <dd className="text-foreground">{fact.value}</dd>
                    </div>
                  ))}
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
    medicationSummary: [],
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
    reason: buildSafeRescheduleProposalReason(proposal.proposal_reason),
    impactCount: readImpactCount(impactSummary),
    proposedReplacementCount: readProposedReplacementCount(impactSummary),
    impactedPatientNames: readImpactedPatientNames(impactSummary),
    medicationSummary: buildSafeMedicationConfirmationFacts(proposal),
  };
}

function buildSafeRescheduleProposalReason(reason: string | null | undefined) {
  const safeReasons = splitProposalReason(reason).filter(isSafeOperationalRescheduleReason);
  return safeReasons.length > 0
    ? safeReasons.join(' / ')
    : '薬剤・処方理由は薬剤判断サマリーで確認';
}

function isSafeOperationalRescheduleReason(reason: string) {
  if (
    /処方|薬剤(?!師)|薬歴|服薬|算定|患者条件|変更|新規|開始|増量|減量|用法|用量|錠|mg|ｍｇ|mL|ml|包|貼付|注射|内服|外用|頓服|残薬|アレルギー/u.test(
      reason,
    )
  ) {
    return false;
  }

  return /緊急訪問|再提案|患者都合|患者連絡|連絡|不在|キャンセル|天候|交通|移動|ルート|訪問順|時間帯|日程|予定|勤務|担当|薬剤師|施設|振替|枠/u.test(
    reason,
  );
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
