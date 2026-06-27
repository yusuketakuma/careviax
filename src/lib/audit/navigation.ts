export function buildAuditTaskHref(taskId: string) {
  return `/audit?taskId=${encodeURIComponent(taskId)}`;
}
