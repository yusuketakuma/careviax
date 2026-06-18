const DEDICATED_COMPLETION_TASK_TYPES = new Set([
  'visit_preparation',
  'visit_contact_followup',
  'visit_schedule_override_approval',
]);

export function canCompleteTaskInline(task: { task_type: string }) {
  return !DEDICATED_COMPLETION_TASK_TYPES.has(task.task_type);
}

export function requiresDedicatedTaskCompletion(task: { task_type: string }) {
  return !canCompleteTaskInline(task);
}
