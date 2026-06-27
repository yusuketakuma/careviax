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

  it.each(['staff_work_request_visit', 'unknown_task_type'])(
    'encodes visit schedule id %s links while keeping raw identity out of the href',
    (taskType) => {
      const scheduleId = '../schedule with space?x=1#frag';

      expect(
        describeOperationalTask({
          task_type: taskType,
          related_entity_type: 'visit_schedule',
          related_entity_id: scheduleId,
        }).actionHref,
      ).toBe(`/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`);
    },
  );

  it('links audit work requests back to the related audit task', () => {
    expect(
      describeOperationalTask({
        task_type: 'staff_work_request_audit',
        related_entity_type: 'dispense_task',
        related_entity_id: 'task-tanaka',
      }).actionHref,
    ).toBe('/audit?taskId=task-tanaka');
  });

  it('encodes audit task ids while keeping raw identity out of the href', () => {
    const taskId = '../task with space?x=1#frag';

    expect(
      describeOperationalTask({
        task_type: 'staff_work_request_audit',
        related_entity_type: 'dispense_task',
        related_entity_id: taskId,
      }).actionHref,
    ).toBe(`/audit?taskId=${encodeURIComponent(taskId)}`);
  });

  it('links generic communication follow-up tasks back to communication requests', () => {
    expect(
      describeOperationalTask({
        task_type: 'communication_request_followup',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    ).toMatchObject({
      actionHref: '/communications/requests',
      actionLabel: '連携依頼を確認',
      queueLabel: '連携返信待ち',
    });
  });

  it.each(['intake_1', '../settings?x=1#frag'])(
    'encodes prescription intake id %s when linking fax original follow-up tasks',
    (intakeId) => {
      expect(
        describeOperationalTask({
          task_type: 'fax_original_followup',
          related_entity_type: 'prescription_intake',
          related_entity_id: intakeId,
        }),
      ).toMatchObject({
        actionHref: `/prescriptions/${encodeURIComponent(intakeId)}`,
        actionLabel: '原本回収を記録',
        queueLabel: 'FAX原本',
      });
    },
  );
});
