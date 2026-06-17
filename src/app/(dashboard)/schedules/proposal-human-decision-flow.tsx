'use client';

import { CheckCircle2, CircleDashed, LockKeyhole, PhoneCall, Route, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Proposal } from './day-view.shared';

type HumanDecisionStepState = 'done' | 'current' | 'blocked' | 'stopped';

function humanDecisionStepClass(state: HumanDecisionStepState) {
  if (state === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (state === 'current') return 'border-sky-200 bg-sky-50 text-sky-900';
  if (state === 'stopped') return 'border-rose-200 bg-rose-50 text-rose-900';
  return 'border-border/70 bg-muted/30 text-muted-foreground';
}

function humanDecisionStepBadge(state: HumanDecisionStepState) {
  if (state === 'done') return '完了';
  if (state === 'current') return '次に対応';
  if (state === 'stopped') return '終了';
  return '待機';
}

function humanDecisionStepIconClass(state: HumanDecisionStepState) {
  if (state === 'done') return 'bg-emerald-600 text-white';
  if (state === 'current') return 'bg-sky-600 text-white';
  if (state === 'stopped') return 'bg-rose-600 text-white';
  return 'bg-muted text-muted-foreground';
}

function HumanDecisionStepIcon({ state }: { state: HumanDecisionStepState }) {
  if (state === 'done') return <CheckCircle2 className="size-3.5" aria-hidden="true" />;
  if (state === 'current') return <CircleDashed className="size-3.5" aria-hidden="true" />;
  if (state === 'stopped') return <LockKeyhole className="size-3.5" aria-hidden="true" />;
  return <LockKeyhole className="size-3.5" aria-hidden="true" />;
}

function getHumanDecisionSteps(proposal: Proposal) {
  const isRejected = ['rejected', 'superseded', 'expired'].includes(proposal.proposal_status);
  const approved =
    proposal.proposal_status === 'patient_contact_pending' ||
    proposal.proposal_status === 'confirmed' ||
    Boolean(proposal.finalized_schedule_id);
  const phoneConfirmed = proposal.patient_contact_status === 'confirmed';
  const finalized =
    proposal.proposal_status === 'confirmed' || Boolean(proposal.finalized_schedule_id);

  return [
    {
      key: 'proposal',
      label: 'システム提案',
      description: '住所・服薬期限・優先度・シフトから候補化',
      state: (isRejected && !approved ? 'stopped' : 'done') as HumanDecisionStepState,
    },
    {
      key: 'approval',
      label: '人間承認',
      description:
        proposal.assignment_mode === 'fallback'
          ? '担当不可のため代替薬剤師候補を確認'
          : '担当薬剤師の候補として確認',
      state: (isRejected ? 'stopped' : approved ? 'done' : 'current') as HumanDecisionStepState,
    },
    {
      key: 'contact',
      label: '患者電話確認',
      description: '患者・家族へ連絡し、了承結果を記録',
      state: (isRejected
        ? 'stopped'
        : phoneConfirmed
          ? 'done'
          : approved
            ? 'current'
            : 'blocked') as HumanDecisionStepState,
    },
    {
      key: 'finalize',
      label: '日時確定',
      description: '電話確認済みの候補だけ予定へ反映',
      state: (isRejected
        ? 'stopped'
        : finalized
          ? 'done'
          : phoneConfirmed && approved
            ? 'current'
            : 'blocked') as HumanDecisionStepState,
    },
  ];
}

function humanDecisionNextAction(proposal: Proposal) {
  if (['rejected', 'superseded', 'expired'].includes(proposal.proposal_status)) {
    return 'この候補は終了しています。必要な場合は条件を変えて再提案してください。';
  }
  if (proposal.proposal_status === 'confirmed' || proposal.finalized_schedule_id) {
    return '電話確認済みの内容で確定され、訪問予定へ反映済みです。';
  }
  if (proposal.patient_contact_status === 'change_requested') {
    return '患者から変更希望があります。希望条件に合わせて再提案してください。';
  }
  if (proposal.proposal_status === 'patient_contact_pending') {
    if (proposal.patient_contact_status === 'confirmed') {
      return '患者確認済みです。日時確定で訪問予定に反映できます。';
    }
    if (proposal.patient_contact_status === 'unreachable') {
      return '不在・不通です。再架電予定を残してから確定判断してください。';
    }
    return '患者へ電話し、結果を「確認済み」で保存すると日時確定できます。';
  }
  return '人間が候補を承認すると、患者連絡待ちに進みます。';
}

function assignmentSummary(proposal: Proposal) {
  if (proposal.assignment_mode === 'fallback') {
    return {
      label: '代替薬剤師',
      detail:
        proposal.escalation_reason ??
        '担当薬剤師が公休・不在・対応不可のため、代替候補として提示されています。',
    };
  }

  return {
    label: '担当薬剤師',
    detail: '登録済みの担当薬剤師を優先して候補化しています。',
  };
}

function contactSummary(proposal: Proposal) {
  if (proposal.patient_contact_status === 'confirmed') {
    return {
      label: '電話確認済み',
      detail: '患者または家族の了承が記録されています。',
    };
  }
  if (proposal.patient_contact_status === 'change_requested') {
    return {
      label: '変更希望',
      detail: '患者希望に合わせて再提案が必要です。',
    };
  }
  if (proposal.patient_contact_status === 'unreachable') {
    return {
      label: '不在・不通',
      detail: '再架電予定を残してから確定判断します。',
    };
  }
  if (proposal.patient_contact_status === 'declined') {
    return {
      label: '辞退',
      detail: 'この候補では確定できません。',
    };
  }
  if (proposal.patient_contact_status === 'attempted') {
    return {
      label: '架電済み',
      detail: '了承が未記録のため、日時確定はまだできません。',
    };
  }

  return {
    label: '未確認',
    detail: 'システム提案後、人間の電話確認が必要です。',
  };
}

function finalizationSummary(proposal: Proposal) {
  if (proposal.proposal_status === 'confirmed' || proposal.finalized_schedule_id) {
    return {
      label: '予定反映済み',
      detail: '確定済みの訪問予定として扱います。',
    };
  }
  if (proposal.patient_contact_status === 'confirmed') {
    return {
      label: '確定可能',
      detail: '日時確定で訪問予定に反映できます。',
    };
  }
  if (proposal.patient_contact_status === 'change_requested') {
    return {
      label: '再提案が必要',
      detail: '変更希望に合わせた別候補を作成してください。',
    };
  }
  return {
    label: '電話確認が必要',
    detail: '患者了承が記録されるまで確定できません。',
  };
}

export function ProposalHumanDecisionFlow({
  proposal,
  compact = false,
}: {
  proposal: Proposal;
  compact?: boolean;
}) {
  const steps = getHumanDecisionSteps(proposal);
  const currentStep = steps.find((step) => step.state === 'current') ?? steps[steps.length - 1];
  const assignment = assignmentSummary(proposal);
  const contact = contactSummary(proposal);
  const finalization = finalizationSummary(proposal);
  const facts = [
    {
      key: 'assignment',
      label: '訪問担当',
      value: assignment.label,
      detail: assignment.detail,
      icon: UserRound,
    },
    {
      key: 'contact',
      label: '患者連絡',
      value: contact.label,
      detail: contact.detail,
      icon: PhoneCall,
    },
    {
      key: 'finalization',
      label: '確定条件',
      value: finalization.label,
      detail: finalization.detail,
      icon: Route,
    },
  ];

  return (
    <section
      aria-label="訪問候補の人間決定フロー"
      className={cn(
        'rounded-2xl border border-border/70 bg-card shadow-sm',
        compact ? 'space-y-3 px-3 py-3' : 'space-y-5 p-4',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-base')}>
            提案から確定まで
          </h3>
          <p
            className={cn('mt-1 leading-5 text-muted-foreground', compact ? 'text-xs' : 'text-sm')}
          >
            {humanDecisionNextAction(proposal)}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            proposal.assignment_mode === 'fallback'
              ? 'border-orange-200 bg-orange-50 text-orange-700'
              : 'border-sky-200 bg-sky-50 text-sky-700'
          }
        >
          {proposal.assignment_mode === 'fallback'
            ? '代替薬剤師へエスカレーション'
            : '担当薬剤師優先'}
        </Badge>
      </div>

      {currentStep ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sky-950">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-sky-300 bg-white/80 text-sky-800">
              今やること
            </Badge>
            <p className="text-sm font-semibold">{currentStep.label}</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-sky-900/80">{currentStep.description}</p>
        </div>
      ) : null}

      <dl className={cn('grid gap-2', compact ? 'md:grid-cols-3' : 'md:grid-cols-3')}>
        {facts.map((fact) => {
          const Icon = fact.icon;
          return (
            <div
              key={fact.key}
              className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
            >
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                {fact.label}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">{fact.value}</dd>
              {!compact ? (
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">{fact.detail}</dd>
              ) : null}
            </div>
          );
        })}
      </dl>

      <ol
        className={cn('grid gap-2', compact ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-4')}
      >
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={cn('rounded-xl border px-3 py-2.5', humanDecisionStepClass(step.state))}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full',
                  humanDecisionStepIconClass(step.state),
                )}
              >
                <HumanDecisionStepIcon state={step.state} />
              </span>
              <span className="text-[11px] font-medium">{humanDecisionStepBadge(step.state)}</span>
            </div>
            <p className={cn('mt-1 font-semibold', compact ? 'text-xs' : 'text-sm')}>
              {index + 1}. {step.label}
            </p>
            {!compact || step.state === 'current' ? (
              <p className="mt-1 text-xs leading-5 opacity-80">{step.description}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
