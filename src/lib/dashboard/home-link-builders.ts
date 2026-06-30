export type MyDayFocus = 'urgent' | 'visits' | 'tasks';
export type MyDayVisitFilter = 'all' | 'unprepared' | 'in_progress';
export type MyDayTaskFilter = 'all' | 'urgent' | 'pending';
export type HomeLinkContext = 'dashboard_home';

export function buildMyDayHref(args?: {
  focus?: MyDayFocus;
  visitFilter?: MyDayVisitFilter;
  taskFilter?: MyDayTaskFilter;
  context?: HomeLinkContext;
}) {
  const params = new URLSearchParams();
  if (args?.focus) params.set('focus', args.focus);
  if (args?.visitFilter && args.visitFilter !== 'all') {
    params.set('visit_filter', args.visitFilter);
  }
  if (args?.taskFilter && args.taskFilter !== 'all') {
    params.set('task_filter', args.taskFilter);
  }
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/my-day?${query}` : '/my-day';
}

export type TasksAssignedFilter = 'all' | 'me';
export type TasksStatusFilter = '' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TasksPriorityFilter = '' | 'urgent' | 'high' | 'normal' | 'low';

export function buildTasksHref(args?: {
  assigned?: TasksAssignedFilter;
  status?: TasksStatusFilter;
  taskType?: string;
  priority?: TasksPriorityFilter;
  relatedEntityType?: string;
  relatedEntityId?: string;
  context?: HomeLinkContext;
}) {
  const params = new URLSearchParams();
  if (args?.assigned && args.assigned !== 'all') params.set('assigned', args.assigned);
  if (args?.status !== undefined) params.set('status', args.status);
  if (args?.taskType) params.set('task_type', args.taskType);
  if (args?.priority) params.set('priority', args.priority);
  if (args?.relatedEntityType) params.set('related_entity_type', args.relatedEntityType);
  if (args?.relatedEntityId) params.set('related_entity_id', args.relatedEntityId);
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/tasks?${query}` : '/tasks';
}

export type WorkflowFocus = 'control_center' | 'communication' | 'workbench' | 'exceptions';

export function buildWorkflowHref(args?: { focus?: WorkflowFocus; context?: HomeLinkContext }) {
  const params = new URLSearchParams();
  if (args?.focus) params.set('focus', args.focus);
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/workflow?${query}` : '/workflow';
}

export type NotificationTab = 'unread' | 'all';
export type NotificationTypeFilter = 'all' | 'urgent' | 'business' | 'reminder' | 'system';

export function buildNotificationsHref(args?: {
  tab?: NotificationTab;
  type?: NotificationTypeFilter;
  context?: HomeLinkContext;
}) {
  const params = new URLSearchParams();
  if (args?.tab && args.tab !== 'unread') params.set('tab', args.tab);
  if (args?.type && args.type !== 'all') params.set('type', args.type);
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/notifications?${query}` : '/notifications';
}

export type HandoffFilter = 'all' | 'unread';

export function buildHandoffHref(_args?: {
  date?: string;
  filter?: HandoffFilter;
  context?: HomeLinkContext;
}) {
  void _args;
  return '/handoff';
}

export type ReportsFocus = 'reports' | 'tracing' | 'delivery';

export function buildReportsHref(args?: {
  focus?: ReportsFocus;
  deliveryStatus?: string;
  context?: HomeLinkContext;
}) {
  const params = new URLSearchParams();
  if (args?.focus) params.set('focus', args.focus);
  if (args?.deliveryStatus) params.set('delivery_status', args.deliveryStatus);
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/reports?${query}` : '/reports';
}

export type ExternalFocus = 'shares' | 'self_reports' | 'activities';

export function buildExternalHref(args?: { focus?: ExternalFocus; context?: HomeLinkContext }) {
  const params = new URLSearchParams();
  if (args?.focus) params.set('focus', args.focus);
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/external?${query}` : '/external';
}

export type ConferencesFocus = 'notes' | 'activities';

export function buildConferencesHref(args?: {
  focus?: ConferencesFocus;
  context?: HomeLinkContext;
}) {
  const params = new URLSearchParams();
  if (args?.focus) params.set('focus', args.focus);
  if (args?.context) params.set('context', args.context);

  const query = params.toString();
  return query ? `/conferences?${query}` : '/conferences';
}
