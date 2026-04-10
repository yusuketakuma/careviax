import type {
  HomeLinkContext,
  TasksAssignedFilter,
  TasksPriorityFilter,
  TasksStatusFilter,
} from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type TasksInitialState = {
  initialAssigned?: TasksAssignedFilter;
  initialStatus?: TasksStatusFilter;
  initialTaskType?: string;
  initialPriority?: TasksPriorityFilter;
  initialContext?: HomeLinkContext | null;
};

export function readTasksState(params: SearchParamRecord): TasksInitialState {
  const assigned = typeof params?.assigned === 'string' ? params.assigned : null;
  const status = typeof params?.status === 'string' ? params.status : null;
  const taskType = typeof params?.task_type === 'string' ? params.task_type : null;
  const priority = typeof params?.priority === 'string' ? params.priority : null;
  const context = typeof params?.context === 'string' ? params.context : null;

  return {
    initialAssigned: assigned === 'me' || assigned === 'all' ? assigned : undefined,
    initialStatus:
      status === 'pending' ||
      status === 'in_progress' ||
      status === 'completed' ||
      status === 'cancelled' ||
      status === ''
        ? status
        : undefined,
    initialTaskType: taskType ?? undefined,
    initialPriority:
      priority === 'urgent' ||
      priority === 'high' ||
      priority === 'normal' ||
      priority === 'low' ||
      priority === ''
        ? priority
        : undefined,
    initialContext: context === 'dashboard_home' ? context : null,
  };
}
