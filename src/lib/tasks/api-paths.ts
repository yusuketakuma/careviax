import { encodePathSegment } from '@/lib/http/path-segment';

export const TASKS_API_PATH = '/api/tasks';

export function buildTasksApiPath() {
  return TASKS_API_PATH;
}

export function buildTaskApiPath(taskId: string) {
  return `${TASKS_API_PATH}/${encodePathSegment(taskId)}`;
}
