import { describe, expect, it } from 'vitest';
import { VisitStatus, VisitStep } from '@/phos/contracts/phos_contracts';
import { canCompleteVisit } from './resolveVisitMode';

const allIncomplete = Object.fromEntries(
  Object.values(VisitStep).map((step) => [step, false]),
) as Record<VisitStep, boolean>;

describe('canCompleteVisit', () => {
  it('allows completion when every required applicable step is complete and blocking sync is clear', () => {
    expect(
      canCompleteVisit({
        applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.EVIDENCE_UPLOAD],
        required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.EVIDENCE_UPLOAD],
        step_completed: {
          ...allIncomplete,
          [VisitStep.ARRIVAL_CONFIRM]: true,
          [VisitStep.EVIDENCE_UPLOAD]: true,
        },
        blocking_unsynced_count: 0,
        visit_status: VisitStatus.IN_PROGRESS,
      }),
    ).toBe(true);
  });

  it('blocks completion when a required step is incomplete', () => {
    expect(
      canCompleteVisit({
        applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.EVIDENCE_UPLOAD],
        required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.EVIDENCE_UPLOAD],
        step_completed: { ...allIncomplete, [VisitStep.ARRIVAL_CONFIRM]: true },
        blocking_unsynced_count: 0,
        visit_status: VisitStatus.IN_PROGRESS,
      }),
    ).toBe(false);
  });

  it('blocks completion when required evidence is still unsynced', () => {
    expect(
      canCompleteVisit({
        applicable_steps: [VisitStep.ARRIVAL_CONFIRM],
        required_steps: [VisitStep.ARRIVAL_CONFIRM],
        step_completed: { ...allIncomplete, [VisitStep.ARRIVAL_CONFIRM]: true },
        blocking_unsynced_count: 1,
        visit_status: VisitStatus.IN_PROGRESS,
      }),
    ).toBe(false);
  });

  it('blocks completion when the server returns a required step outside applicable_steps', () => {
    expect(
      canCompleteVisit({
        applicable_steps: [VisitStep.ARRIVAL_CONFIRM],
        required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.EVIDENCE_UPLOAD],
        step_completed: {
          ...allIncomplete,
          [VisitStep.ARRIVAL_CONFIRM]: true,
          [VisitStep.EVIDENCE_UPLOAD]: true,
        },
        blocking_unsynced_count: 0,
        visit_status: VisitStatus.IN_PROGRESS,
      }),
    ).toBe(false);
  });

  it('blocks completion when the visit is not in progress', () => {
    expect(
      canCompleteVisit({
        applicable_steps: [VisitStep.ARRIVAL_CONFIRM],
        required_steps: [VisitStep.ARRIVAL_CONFIRM],
        step_completed: { ...allIncomplete, [VisitStep.ARRIVAL_CONFIRM]: true },
        blocking_unsynced_count: 0,
        visit_status: VisitStatus.SCHEDULED,
      }),
    ).toBe(false);
  });
});
