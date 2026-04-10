import { describe, expect, it } from 'vitest';
import { readTasksState } from './tasks-query-state';

describe('tasks-query-state', () => {
  it('reads supported task filter search params', () => {
    expect(
      readTasksState({
        assigned: 'me',
        status: 'pending',
        task_type: 'visit_preparation',
        priority: 'high',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialAssigned: 'me',
      initialStatus: 'pending',
      initialTaskType: 'visit_preparation',
      initialPriority: 'high',
      initialContext: 'dashboard_home',
    });
  });

  it('ignores unsupported values', () => {
    expect(
      readTasksState({
        assigned: 'team',
        status: 'later',
        priority: 'soon',
        context: 'other',
      }),
    ).toEqual({
      initialAssigned: undefined,
      initialStatus: undefined,
      initialTaskType: undefined,
      initialPriority: undefined,
      initialContext: null,
    });
  });
});
