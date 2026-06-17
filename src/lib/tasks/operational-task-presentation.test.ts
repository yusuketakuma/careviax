import { describe, expect, it } from 'vitest';
import { describeOperationalTask } from './operational-task-presentation';

describe('describeOperationalTask', () => {
  it('links visit work requests back to the related schedule', () => {
    expect(
      describeOperationalTask({
        task_type: 'staff_work_request_visit',
        related_entity_type: 'visit_schedule',
        related_entity_id: 'visit_1',
      }).actionHref,
    ).toBe('/schedules?focus=schedule&schedule_id=visit_1');
  });

  it('links audit work requests back to the related audit task', () => {
    expect(
      describeOperationalTask({
        task_type: 'staff_work_request_audit',
        related_entity_type: 'dispense_task',
        related_entity_id: 'task-tanaka',
      }).actionHref,
    ).toBe('/audit?taskId=task-tanaka');
  });
});
