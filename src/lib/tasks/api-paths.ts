import { encodePathSegment } from '@/lib/http/path-segment';

export const TASKS_API_PATH = '/api/tasks';
export const TASKS_HEALTH_BOARD_API_PATH = `${TASKS_API_PATH}/health-board`;

type TasksHealthBoardApiPathParams = {
  scope?: 'role_default' | 'mine' | 'team' | null;
  limit?: number | null;
  task_type?: string | null;
  risk_domain?: string | null;
};

export function buildTasksApiPath() {
  return TASKS_API_PATH;
}

export function buildTaskApiPath(taskId: string) {
  return `${TASKS_API_PATH}/${encodePathSegment(taskId)}`;
}

export function buildTasksHealthBoardApiPath(params: TasksHealthBoardApiPathParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.scope) searchParams.set('scope', params.scope);
  if (typeof params.limit === 'number') searchParams.set('limit', String(params.limit));
  if (params.task_type) searchParams.set('task_type', params.task_type);
  if (params.risk_domain) searchParams.set('risk_domain', params.risk_domain);

  const queryString = searchParams.toString();
  return queryString
    ? `${TASKS_HEALTH_BOARD_API_PATH}?${queryString}`
    : TASKS_HEALTH_BOARD_API_PATH;
}
