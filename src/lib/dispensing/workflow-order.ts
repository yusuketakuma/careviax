type TimestampValue = Date | string | null | undefined;

function toMillis(value: TimestampValue) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function getDispenseWorkflowPriorityWeight(priority: string) {
  switch (priority) {
    case 'emergency':
      return 0;
    case 'urgent':
      return 1;
    default:
      return 2;
  }
}

export function compareDispenseWorkflowOrder<
  T extends {
    priority: string;
    due_date: TimestampValue;
    created_at?: TimestampValue;
    updated_at?: TimestampValue;
    is_overdue?: boolean;
  },
>(
  left: T,
  right: T,
  options?: {
    timestampField?: 'created_at' | 'updated_at';
    includeOverdue?: boolean;
  },
) {
  const priorityDiff =
    getDispenseWorkflowPriorityWeight(left.priority) -
    getDispenseWorkflowPriorityWeight(right.priority);
  if (priorityDiff !== 0) return priorityDiff;

  if (options?.includeOverdue && Boolean(left.is_overdue) !== Boolean(right.is_overdue)) {
    return left.is_overdue ? -1 : 1;
  }

  const leftDue = toMillis(left.due_date);
  const rightDue = toMillis(right.due_date);
  if (leftDue != null && rightDue != null && leftDue !== rightDue) {
    return leftDue - rightDue;
  }
  if (leftDue != null) return -1;
  if (rightDue != null) return 1;

  const timestampField = options?.timestampField ?? 'created_at';
  const leftFallback = toMillis(left[timestampField]);
  const rightFallback = toMillis(right[timestampField]);
  if (leftFallback != null && rightFallback != null && leftFallback !== rightFallback) {
    return leftFallback - rightFallback;
  }
  if (leftFallback != null) return -1;
  if (rightFallback != null) return 1;

  return 0;
}
