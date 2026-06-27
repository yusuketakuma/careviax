export function buildDispenseTaskHref(taskId: string) {
  return `/dispense?taskId=${encodeURIComponent(taskId)}`;
}
