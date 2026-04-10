import type { MyDayFocus, MyDayTaskFilter, MyDayVisitFilter } from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type MyDayInitialState = {
  initialFocus?: MyDayFocus;
  initialVisitFilter?: MyDayVisitFilter;
  initialTaskFilter?: MyDayTaskFilter;
  initialContext?: string | null;
};

export function readMyDayState(params: SearchParamRecord): MyDayInitialState {
  const focus = typeof params?.focus === 'string' ? params.focus : null;
  const visitFilter = typeof params?.visit_filter === 'string' ? params.visit_filter : null;
  const taskFilter = typeof params?.task_filter === 'string' ? params.task_filter : null;
  const context = typeof params?.context === 'string' ? params.context : null;

  return {
    initialFocus:
      focus === 'urgent' || focus === 'visits' || focus === 'tasks' ? focus : undefined,
    initialVisitFilter:
      visitFilter === 'unprepared' || visitFilter === 'in_progress' || visitFilter === 'all'
        ? visitFilter
        : undefined,
    initialTaskFilter:
      taskFilter === 'urgent' || taskFilter === 'pending' || taskFilter === 'all'
        ? taskFilter
        : undefined,
    initialContext: context,
  };
}
