import { VisitStatus } from '@/phos/contracts/phos_contracts';
import type { VisitStep } from '@/phos/contracts/phos_contracts';

export function canCompleteVisit(input: {
  applicable_steps: VisitStep[];
  required_steps: VisitStep[];
  step_completed: Record<VisitStep, boolean>;
  blocking_unsynced_count: number;
  visit_status: VisitStatus;
}): boolean {
  const applicable = new Set(input.applicable_steps);
  return (
    input.required_steps.every(
      (step) => applicable.has(step) && input.step_completed[step] === true,
    ) &&
    input.blocking_unsynced_count === 0 &&
    input.visit_status === VisitStatus.IN_PROGRESS
  );
}
