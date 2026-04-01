import { deriveFacilityLabel } from '@/lib/utils/facility';

type ResidenceLike = {
  building_id?: string | null;
  address?: string | null;
};

type DispenseTaskLike = {
  priority: string;
  due_date: Date | null;
  created_at?: Date;
  updated_at?: Date;
  cycle: {
    case_: {
      patient: {
        residences: ResidenceLike[];
      };
    };
  };
};

const PRIORITY_WEIGHT: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

export function sortDispenseTasks<T extends DispenseTaskLike>(
  tasks: T[],
  tieBreaker: 'created_at' | 'updated_at',
) {
  return [...tasks].sort((left, right) => {
    const leftWeight = PRIORITY_WEIGHT[left.priority] ?? 2;
    const rightWeight = PRIORITY_WEIGHT[right.priority] ?? 2;
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    if (left.due_date && right.due_date) {
      return left.due_date.getTime() - right.due_date.getTime();
    }
    if (left.due_date) return -1;
    if (right.due_date) return 1;
    const leftTie = left[tieBreaker]?.getTime() ?? 0;
    const rightTie = right[tieBreaker]?.getTime() ?? 0;
    return leftTie - rightTie;
  });
}

export function annotateDispenseTask<T extends DispenseTaskLike>(
  task: T,
  now = new Date(),
) {
  const residence = task.cycle.case_.patient.residences[0] ?? null;
  return {
    ...task,
    facility_label: deriveFacilityLabel(residence ?? null),
    is_overdue: task.due_date != null && task.due_date.getTime() < now.getTime(),
  };
}
