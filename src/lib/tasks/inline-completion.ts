import { RISK_TASK_REGISTRY } from '@/lib/tasks/task-registry';

const DEDICATED_COMPLETION_TASK_TYPES = new Set([
  'visit_preparation',
  'visit_contact_followup',
  'visit_schedule_override_approval',
  'handoff_confirmation',
  'handoff_supervision_review',
  ...Object.values(RISK_TASK_REGISTRY).map((entry) => entry.task_type),
]);

export function canCompleteTaskInline(task: { task_type: string }) {
  return !DEDICATED_COMPLETION_TASK_TYPES.has(task.task_type);
}

export function requiresDedicatedTaskCompletion(task: { task_type: string }) {
  return !canCompleteTaskInline(task);
}
