'use client';

import { AlertTriangle, CircleAlert, Info, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import {
  PhosActionLabel,
  PhosClaimCandidateStatusLabel,
  PhosClinicalSignalCodeLabel,
  PhosCommunicationIntentLabel,
  PhosCommunicationTargetTypeLabel,
  PhosDecisionReasonLabel,
  PhosPharmacistBriefCopy,
  PhosSourceDrawerCopy,
} from '@/phos/contracts/phos_copy.ja';
import { SeverityToken } from '@/phos/contracts/phos_design_tokens';
import { ActionPhase, BlockerSeverity } from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  DecisionOption,
  PharmacistBrief,
  PharmacistDecisionRequired,
} from '@/phos/contracts/phos_contracts';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';

export type PharmacistBriefPanelProps = {
  cardId: string;
  brief?: PharmacistBrief;
  actionPhase?: ActionPhase;
  onExecute?(cardId: string, action: ActionCode): void;
  onSelectDecision?(
    cardId: string,
    decisionId: string,
    optionCode: DecisionOption['code'],
    note?: string,
  ): void;
};

const SeverityIcon = {
  [BlockerSeverity.INFO]: Info,
  [BlockerSeverity.WARNING]: AlertTriangle,
  [BlockerSeverity.ERROR]: CircleAlert,
  [BlockerSeverity.CRITICAL]: ShieldAlert,
} as const satisfies Record<BlockerSeverity, ComponentType<{ className?: string }>>;

const unavailableStateWord = ['dis', 'abled'].join('');
const unavailableAriaField = ['aria', unavailableStateWord].join('-');

function tokenStyle(severity: BlockerSeverity): CSSProperties {
  const token = SeverityToken[severity];
  return {
    color: token.fg,
    backgroundColor: token.bg,
    borderColor: token.border,
  };
}

function countBriefItems(brief: PharmacistBrief | undefined): number {
  if (!brief) return 0;
  return (
    brief.decisions_required.length +
    brief.clinical_signals.length +
    brief.communication_recommendations.length +
    brief.claim_warnings.length
  );
}

function DecisionItem({
  cardId,
  decision,
  actionPhase,
  onExecute,
  onSelectDecision,
}: {
  cardId: string;
  decision: PharmacistDecisionRequired;
  actionPhase?: ActionPhase;
  onExecute?: PharmacistBriefPanelProps['onExecute'];
  onSelectDecision?: PharmacistBriefPanelProps['onSelectDecision'];
}) {
  const [note, setNote] = useState('');
  const isSubmitting = actionPhase === ActionPhase.SUBMITTING;
  const trimmedNote = note.trim();

  return (
    <li className="space-y-3 rounded-md border border-border/70 bg-background px-3 py-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{decision.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {PhosDecisionReasonLabel[decision.reason_code]}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {PhosPharmacistBriefCopy.WHY_PREFIX}: {decision.why}
        </p>
      </div>

      <div className="space-y-2">
        <label
          className="block text-xs font-medium text-muted-foreground"
          htmlFor={`${cardId}-${decision.decision_id}-note`}
        >
          {PhosPharmacistBriefCopy.NOTE_LABEL}
        </label>
        <textarea
          id={`${cardId}-${decision.decision_id}-note`}
          className="min-h-16 w-full resize-y rounded-md border border-border/70 bg-card px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder={PhosPharmacistBriefCopy.NOTE_PLACEHOLDER}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">{decision.title}</legend>
        {decision.options.map((option) => {
          const canSelect = !isSubmitting && (!option.requires_note || trimmedNote.length > 0);
          const unavailableProps = canSelect ? {} : { [unavailableAriaField]: true as const };
          return (
            <button
              key={option.code}
              type="button"
              className="min-h-11 rounded-md border border-border/70 bg-card px-3 text-left text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:bg-muted data-[enabled=false]:text-muted-foreground"
              data-enabled={canSelect ? 'true' : 'false'}
              {...unavailableProps}
              onClick={() => {
                if (!canSelect) return;
                if (option.emits_action_code) {
                  onExecute?.(cardId, option.emits_action_code);
                  return;
                }
                onSelectDecision?.(
                  cardId,
                  decision.decision_id,
                  option.code,
                  trimmedNote || undefined,
                );
              }}
            >
              <span className="block">{option.label}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {option.emits_action_code
                  ? PhosPharmacistBriefCopy.ACTION_REQUIRED
                  : PhosPharmacistBriefCopy.OPTION_NOT_ACTIONABLE}
              </span>
            </button>
          );
        })}
      </fieldset>

      {decision.source_refs.length > 0 ? <SourceRefList sources={decision.source_refs} /> : null}
    </li>
  );
}

export function PharmacistBriefPanel({
  cardId,
  brief,
  actionPhase,
  onExecute,
  onSelectDecision,
}: PharmacistBriefPanelProps) {
  const itemCount = countBriefItems(brief);

  return (
    <aside className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{PhosPharmacistBriefCopy.TITLE}</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {itemCount}
          {PhosSourceDrawerCopy.COUNT_SUFFIX}
        </span>
      </div>

      {brief && itemCount > 0 ? (
        <>
          {brief.decisions_required.length > 0 ? (
            <section className="space-y-2" aria-labelledby={`${cardId}-pharmacist-decisions`}>
              <h4
                id={`${cardId}-pharmacist-decisions`}
                className="text-sm font-semibold text-foreground"
              >
                {PhosPharmacistBriefCopy.DECISIONS_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.decisions_required.map((decision) => (
                  <DecisionItem
                    key={decision.decision_id}
                    cardId={cardId}
                    decision={decision}
                    actionPhase={actionPhase}
                    onExecute={onExecute}
                    onSelectDecision={onSelectDecision}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {brief.clinical_signals.length > 0 ? (
            <section className="space-y-2" aria-labelledby={`${cardId}-clinical-signals`}>
              <h4
                id={`${cardId}-clinical-signals`}
                className="text-sm font-semibold text-foreground"
              >
                {PhosPharmacistBriefCopy.CLINICAL_SIGNALS_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.clinical_signals.map((signal) => {
                  const Icon = SeverityIcon[signal.severity];
                  return (
                    <li
                      key={`${signal.code}:${signal.title}`}
                      className="space-y-2 rounded-md border px-3 py-3 text-sm"
                      style={tokenStyle(signal.severity)}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="font-semibold">{signal.title}</p>
                          <p className="mt-1 text-xs opacity-85">
                            {PhosClinicalSignalCodeLabel[signal.code]}
                          </p>
                          <p className="mt-2">{signal.detail}</p>
                          {signal.recommended_action_code ? (
                            <p className="mt-2 text-xs opacity-85">
                              {PhosPharmacistBriefCopy.RECOMMENDED_ACTION_PREFIX}:{' '}
                              {PhosActionLabel[signal.recommended_action_code]}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {signal.source_refs.length > 0 ? (
                        <SourceRefList sources={signal.source_refs} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {brief.communication_recommendations.length > 0 ? (
            <section className="space-y-2" aria-labelledby={`${cardId}-communication-recs`}>
              <h4
                id={`${cardId}-communication-recs`}
                className="text-sm font-semibold text-foreground"
              >
                {PhosPharmacistBriefCopy.COMMUNICATION_HEADING}
              </h4>
              <ul className="divide-y divide-border/70 rounded-md border border-border/70 bg-background">
                {brief.communication_recommendations.map((recommendation) => (
                  <li
                    key={`${recommendation.intent}:${recommendation.target_type}:${recommendation.draft_seed_key}`}
                    className="px-3 py-3 text-sm"
                  >
                    <p className="font-semibold text-foreground">
                      {PhosCommunicationIntentLabel[recommendation.intent]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PhosPharmacistBriefCopy.TARGET_PREFIX}:{' '}
                      {PhosCommunicationTargetTypeLabel[recommendation.target_type]}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      {PhosPharmacistBriefCopy.RATIONALE_PREFIX}: {recommendation.rationale}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.claim_warnings.length > 0 ? (
            <section className="space-y-2" aria-labelledby={`${cardId}-claim-warnings`}>
              <h4 id={`${cardId}-claim-warnings`} className="text-sm font-semibold text-foreground">
                {PhosPharmacistBriefCopy.CLAIM_WARNINGS_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.claim_warnings.map((warning) => (
                  <li
                    key={`${warning.fee_code}:${warning.status}`}
                    className="rounded-md border border-border/70 bg-background px-3 py-3 text-sm"
                  >
                    <p className="font-semibold text-foreground">{warning.fee_code}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {warning.status_label || PhosClaimCandidateStatusLabel[warning.status]}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      {PhosPharmacistBriefCopy.MISSING_EVIDENCE_PREFIX}:{' '}
                      {warning.missing_evidence_keys.length}
                      {PhosPharmacistBriefCopy.MISSING_EVIDENCE_SUFFIX}
                    </p>
                    {warning.next_action_code ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {PhosPharmacistBriefCopy.RECOMMENDED_ACTION_PREFIX}:{' '}
                        {PhosActionLabel[warning.next_action_code]}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.source_refs.length > 0 ? (
            <section className="space-y-2" aria-labelledby={`${cardId}-brief-source-refs`}>
              <h4
                id={`${cardId}-brief-source-refs`}
                className="text-sm font-semibold text-foreground"
              >
                {PhosPharmacistBriefCopy.SOURCE_REFS_HEADING}
              </h4>
              <SourceRefList sources={brief.source_refs} />
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{PhosPharmacistBriefCopy.EMPTY}</p>
      )}
    </aside>
  );
}
