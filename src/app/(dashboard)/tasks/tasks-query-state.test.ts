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
      initialWorkRequestType: undefined,
      initialWorkRequestTitle: undefined,
      initialWorkRequestDescription: undefined,
      initialRelatedEntityType: undefined,
      initialRelatedEntityId: undefined,
    });
  });

  it('ignores unsupported values', () => {
    expect(
      readTasksState({
        assigned: 'team',
        status: 'later',
        priority: 'soon',
        context: 'other',
        work_request_type: 'other',
      }),
    ).toEqual({
      initialAssigned: undefined,
      initialStatus: undefined,
      initialTaskType: undefined,
      initialPriority: undefined,
      initialContext: null,
      initialWorkRequestType: undefined,
      initialWorkRequestTitle: undefined,
      initialWorkRequestDescription: undefined,
      initialRelatedEntityType: undefined,
      initialRelatedEntityId: undefined,
    });
  });

  it('reads work request prefill search params', () => {
    expect(
      readTasksState({
        work_request_type: 'staff_work_request_audit',
        work_request_title: '田中さんの監査をしてほしい',
        work_request_description: '14:00訪問前に完了',
        related_entity_type: 'dispense_task',
        related_entity_id: 'task_1',
      }),
    ).toEqual({
      initialAssigned: undefined,
      initialStatus: undefined,
      initialTaskType: undefined,
      initialPriority: undefined,
      initialContext: null,
      initialWorkRequestType: 'staff_work_request_audit',
      initialWorkRequestTitle: '田中さんの監査をしてほしい',
      initialWorkRequestDescription: '14:00訪問前に完了',
      initialRelatedEntityType: 'dispense_task',
      initialRelatedEntityId: 'task_1',
    });
  });
});
