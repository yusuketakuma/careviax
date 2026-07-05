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

  it('links generic communication follow-up tasks back to patient reply-waiting requests', () => {
    expect(
      describeOperationalTask({
        task_type: 'communication_request_followup',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    ).toMatchObject({
      actionHref: '/communications/requests?status=sent&patient_id=patient_1',
      actionLabel: '連携依頼を確認',
      queueLabel: '連携返信待ち',
    });
  });

  it('keeps communication follow-up task patient ids URL-encoded', () => {
    const patientId = '../patient with space?x=1#frag';

    expect(
      describeOperationalTask({
        task_type: 'communication_request_followup',
        related_entity_type: 'patient',
        related_entity_id: patientId,
      }).actionHref,
    ).toBe(
      `/communications/requests?${new URLSearchParams({ status: 'sent', patient_id: patientId }).toString()}`,
    );
  });

  it('focuses management-plan review tasks on the related task queue when only the plan is known', () => {
    const planId = 'plan/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'management_plan_review',
        related_entity_type: 'management_plan',
        related_entity_id: planId,
      }),
    ).toMatchObject({
      actionHref:
        '/tasks?status=&task_type=management_plan_review&related_entity_type=management_plan&related_entity_id=plan%2F1%3Fx%3Dy%23frag',
      actionLabel: '計画を見直す',
      queueLabel: '計画書',
    });
  });

  it('links geocode review tasks to the patient address editor', () => {
    const patientId = 'patient/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'geocode_review',
        related_entity_type: 'patient',
        related_entity_id: patientId,
      }).actionHref,
    ).toBe(`/patients/${encodeURIComponent(patientId)}/edit?section=visit#intake.address`);
  });

  it('links visit intake linkage tasks to prescription detail when the intake is known', () => {
    const intakeId = 'intake/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'visit_intake_linkage',
        related_entity_type: 'prescription_intake',
        related_entity_id: intakeId,
      }).actionHref,
    ).toBe(`/prescriptions/${encodeURIComponent(intakeId)}`);
  });

  it('focuses initial home visit assessment tasks on the related patient', () => {
    const patientId = 'patient/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'initial_home_visit_assessment',
        related_entity_type: 'patient',
        related_entity_id: patientId,
      }).actionHref,
    ).toBe(`/patients/${encodeURIComponent(patientId)}`);
  });

  it('focuses emergency contact review tasks on the patient visit-contact editor', () => {
    const patientId = 'patient/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'emergency_contact_review',
        related_entity_type: 'patient',
        related_entity_id: patientId,
      }).actionHref,
    ).toBe(
      `/patients/${encodeURIComponent(patientId)}/edit?section=visit#intake.emergency_contact.name`,
    );
  });

  it('focuses visit record retention tasks on the originating visit record', () => {
    const visitRecordId = 'visit/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'visit_record_retention',
        related_entity_type: 'visit_record',
        related_entity_id: visitRecordId,
      }).actionHref,
    ).toBe(`/visits/${encodeURIComponent(visitRecordId)}`);
  });

  it('focuses prescription original retention tasks on the originating prescription intake', () => {
    const intakeId = 'intake/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'prescription_original_retention',
        related_entity_type: 'prescription_intake',
        related_entity_id: intakeId,
      }).actionHref,
    ).toBe(`/prescriptions/${encodeURIComponent(intakeId)}`);
  });

  it.each([
    'visit_demand',
    'visit_contact_followup',
    'visit_preparation',
    'visit_schedule_override_approval',
    'facility_batch_tracker',
    'mobile_visit_mode',
    'visit_carry_item_review',
  ])('focuses %s tasks on the related visit schedule', (taskType) => {
    const scheduleId = '../schedule with space?x=1#frag';

    expect(
      describeOperationalTask({
        task_type: taskType,
        related_entity_type: 'visit_schedule',
        related_entity_id: scheduleId,
      }).actionHref,
    ).toBe(`/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`);
  });

  it.each(['visit_demand', 'visit_contact_followup', 'visit_schedule_override_approval'])(
    'focuses %s tasks on the related visit schedule proposal',
    (taskType) => {
      const proposalId = '../proposal with space?x=1#frag';

      expect(
        describeOperationalTask({
          task_type: taskType,
          related_entity_type: 'visit_schedule_proposal',
          related_entity_id: proposalId,
        }).actionHref,
      ).toBe(`/schedules/proposals?detail=${encodeURIComponent(proposalId)}`);
    },
  );

  it('falls back schedule-related visit tasks to the matching task queue when no schedule entity is known', () => {
    expect(
      describeOperationalTask({
        task_type: 'visit_preparation',
        related_entity_type: null,
        related_entity_id: null,
      }).actionHref,
    ).toBe('/tasks?status=&task_type=visit_preparation');
  });

  it('routes handoff supervision review tasks to the handoff workspace', () => {
    expect(
      describeOperationalTask({
        task_type: 'handoff_supervision_review',
        related_entity_type: 'visit_record',
        related_entity_id: '../visit record?x=1#frag',
      }),
    ).toMatchObject({
      actionHref: '/handoff',
      actionLabel: '上長確認を行う',
      queueLabel: '申し送り上長確認',
    });
  });

  it('focuses self-report and community follow-up tasks on the external work queues', () => {
    expect(
      describeOperationalTask({
        task_type: 'patient_self_report_followup',
        related_entity_type: 'patient_self_report',
        related_entity_id: 'report_1',
      }).actionHref,
    ).toBe('/external?focus=self_reports');

    expect(
      describeOperationalTask({
        task_type: 'community_activity_followup',
        related_entity_type: 'community_activity',
        related_entity_id: 'activity_1',
      }).actionHref,
    ).toBe('/external?focus=activities');
  });

  it('links residual review tasks back to the originating visit record', () => {
    const visitRecordId = 'visit/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'residual_reduction_review',
        related_entity_type: 'visit_record',
        related_entity_id: visitRecordId,
      }).actionHref,
    ).toBe(`/visits/${encodeURIComponent(visitRecordId)}`);
  });

  it('focuses conference action items on the conference note workspace', () => {
    expect(
      describeOperationalTask({
        task_type: 'conference_action_item',
        related_entity_type: 'conference_note',
        related_entity_id: 'note_1',
      }).actionHref,
    ).toBe('/conferences?focus=notes');
  });

  it.each([
    ['report_delivery_followup', '報告送達を確認', '報告送達'],
    ['report_response_followup', '未確認報告を確認', '報告返信待ち'],
  ])('links %s tasks back to the related report detail', (taskType, actionLabel, queueLabel) => {
    const reportId = 'report/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: taskType,
        related_entity_type: 'care_report',
        related_entity_id: reportId,
      }),
    ).toMatchObject({
      actionHref: `/reports/${encodeURIComponent(reportId)}`,
      actionLabel,
      queueLabel,
    });
  });

  it('links tracing report follow-up tasks back to related communication requests', () => {
    const tracingReportId = 'tracing/1?x=y#frag';

    expect(
      describeOperationalTask({
        task_type: 'tracing_report_followup',
        related_entity_type: 'tracing_report',
        related_entity_id: tracingReportId,
      }),
    ).toMatchObject({
      actionHref:
        '/communications/requests?request_type=tracing_report&related_entity_type=tracing_report&related_entity_id=tracing%2F1%3Fx%3Dy%23frag',
      actionLabel: '関連依頼を確認',
      queueLabel: '服薬情報提供書',
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

  it.each(['.', '..'])(
    'rejects exact dot-segment prescription intake id %s for fax original follow-up tasks',
    (intakeId) => {
      expect(() =>
        describeOperationalTask({
          task_type: 'fax_original_followup',
          related_entity_type: 'prescription_intake',
          related_entity_id: intakeId,
        }),
      ).toThrow(RangeError);
    },
  );

  it.each([
    ['initial_home_visit_assessment', 'patient'],
    ['emergency_contact_review', 'patient'],
    ['visit_record_retention', 'visit_record'],
    ['prescription_original_retention', 'prescription_intake'],
  ])('rejects exact dot-segment related id for %s tasks', (taskType, relatedEntityType) => {
    expect(() =>
      describeOperationalTask({
        task_type: taskType,
        related_entity_type: relatedEntityType,
        related_entity_id: '.',
      }),
    ).toThrow(RangeError);
  });
});
