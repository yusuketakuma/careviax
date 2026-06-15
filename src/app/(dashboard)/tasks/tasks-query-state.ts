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
  initialWorkRequestType?: string;
  initialWorkRequestTitle?: string;
  initialWorkRequestDescription?: string;
  initialRelatedEntityType?: string;
  initialRelatedEntityId?: string;
};

export function readTasksState(params: SearchParamRecord): TasksInitialState {
  const assigned = typeof params?.assigned === 'string' ? params.assigned : null;
  const status = typeof params?.status === 'string' ? params.status : null;
  const taskType = typeof params?.task_type === 'string' ? params.task_type : null;
  const priority = typeof params?.priority === 'string' ? params.priority : null;
  const context = typeof params?.context === 'string' ? params.context : null;
  const workRequestType =
    typeof params?.work_request_type === 'string' ? params.work_request_type : null;
  const workRequestTitle =
    typeof params?.work_request_title === 'string' ? params.work_request_title : null;
  const workRequestDescription =
    typeof params?.work_request_description === 'string' ? params.work_request_description : null;
  const relatedEntityType =
    typeof params?.related_entity_type === 'string' ? params.related_entity_type : null;
  const relatedEntityId =
    typeof params?.related_entity_id === 'string' ? params.related_entity_id : null;

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
    initialWorkRequestType:
      workRequestType === 'staff_work_request_visit' ||
      workRequestType === 'staff_work_request_audit' ||
      workRequestType === 'staff_work_request_general'
        ? workRequestType
        : undefined,
    initialWorkRequestTitle: workRequestTitle?.trim() || undefined,
    initialWorkRequestDescription: workRequestDescription?.trim() || undefined,
    initialRelatedEntityType: relatedEntityType?.trim() || undefined,
    initialRelatedEntityId: relatedEntityId?.trim() || undefined,
  };
}
