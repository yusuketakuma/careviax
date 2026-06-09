'use client';

import {
  PhosCommunicationTargetTypeLabel,
  PhosDeliveryMethodLabel,
  PhosDecisionReasonLabel,
  PhosSupportBriefCopy,
  PhosSupportTaskCodeLabel,
} from '@/phos/contracts/phos_copy.ja';
import type { SupportBrief } from '@/phos/contracts/phos_contracts';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';

export type SupportBriefPanelProps = {
  brief?: SupportBrief;
};

function supportItemCount(brief: SupportBrief | undefined): number {
  if (!brief) return 0;
  return (
    brief.support_tasks.length +
    brief.missing_contacts.length +
    brief.delivery_targets.length +
    brief.schedule_candidates.length +
    brief.missing_evidences.length +
    brief.waiting_replies.length +
    brief.pharmacist_review_reasons.length
  );
}

export function SupportBriefPanel({ brief }: SupportBriefPanelProps) {
  if (!brief) return null;

  const itemCount = supportItemCount(brief);

  return (
    <aside className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{PhosSupportBriefCopy.TITLE}</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {itemCount}
          {PhosSupportBriefCopy.COUNT_SUFFIX}
        </span>
      </div>

      {itemCount === 0 ? (
        <p className="text-sm text-muted-foreground">{PhosSupportBriefCopy.EMPTY}</p>
      ) : (
        <>
          {brief.support_tasks.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-tasks">
              <h4 id="support-brief-tasks" className="text-sm font-semibold text-foreground">
                {PhosSupportBriefCopy.TASKS_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.support_tasks.map((task) => (
                  <li
                    key={`${task.task_code}:${task.related_blocker_code ?? 'none'}`}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">
                      {task.label || PhosSupportTaskCodeLabel[task.task_code]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.enabled ? PhosSupportBriefCopy.ENABLED : PhosSupportBriefCopy.BLOCKED}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.missing_contacts.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-missing-contacts">
              <h4
                id="support-brief-missing-contacts"
                className="text-sm font-semibold text-foreground"
              >
                {PhosSupportBriefCopy.MISSING_CONTACTS_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.missing_contacts.map((contact) => (
                  <li
                    key={contact.contact_id}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{contact.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PhosSupportBriefCopy.TARGET_PREFIX}:{' '}
                      {PhosCommunicationTargetTypeLabel[contact.target_type]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PhosSupportBriefCopy.MISSING_FIELDS_PREFIX}:{' '}
                      {contact.required_field_keys.length}
                      {PhosSupportBriefCopy.MISSING_FIELDS_SUFFIX}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.delivery_targets.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-delivery-targets">
              <h4
                id="support-brief-delivery-targets"
                className="text-sm font-semibold text-foreground"
              >
                {PhosSupportBriefCopy.DELIVERY_TARGETS_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.delivery_targets.map((target) => (
                  <li
                    key={target.target_id}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{target.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PhosCommunicationTargetTypeLabel[target.target_type]} /{' '}
                      {PhosSupportBriefCopy.METHOD_PREFIX}:{' '}
                      {PhosDeliveryMethodLabel[target.delivery_method]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {target.ready ? PhosSupportBriefCopy.READY : PhosSupportBriefCopy.NOT_READY}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.schedule_candidates.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-schedules">
              <h4 id="support-brief-schedules" className="text-sm font-semibold text-foreground">
                {PhosSupportBriefCopy.SCHEDULE_CANDIDATES_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.schedule_candidates.map((candidate) => (
                  <li
                    key={candidate.candidate_id}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{candidate.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PhosSupportBriefCopy.SCHEDULE_PREFIX}: {candidate.date}{' '}
                      {candidate.start_time}-{candidate.end_time}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.missing_evidences.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-evidences">
              <h4 id="support-brief-evidences" className="text-sm font-semibold text-foreground">
                {PhosSupportBriefCopy.MISSING_EVIDENCES_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.missing_evidences.map((evidence) => (
                  <li
                    key={evidence.evidence_key}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{evidence.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {evidence.required
                        ? PhosSupportBriefCopy.REQUIRED
                        : PhosSupportBriefCopy.OPTIONAL}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.waiting_replies.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-waiting-replies">
              <h4
                id="support-brief-waiting-replies"
                className="text-sm font-semibold text-foreground"
              >
                {PhosSupportBriefCopy.WAITING_REPLIES_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.waiting_replies.map((reply) => (
                  <li
                    key={reply.delivery_id}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{reply.target_label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {reply.stale_minutes}
                      {PhosSupportBriefCopy.STALE_MINUTES_SUFFIX}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.pharmacist_review_reasons.length > 0 ? (
            <section className="space-y-2" aria-labelledby="support-brief-pharmacist-review">
              <h4
                id="support-brief-pharmacist-review"
                className="text-sm font-semibold text-foreground"
              >
                {PhosSupportBriefCopy.PHARMACIST_REVIEW_HEADING}
              </h4>
              <ul className="space-y-2">
                {brief.pharmacist_review_reasons.map((reason) => (
                  <li
                    key={`${reason.reason_code}:${reason.label}`}
                    className="space-y-2 rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{reason.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {PhosDecisionReasonLabel[reason.reason_code]}
                    </p>
                    {reason.source_refs.length > 0 ? (
                      <SourceRefList sources={reason.source_refs} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}
