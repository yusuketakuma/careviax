import { describe, expect, it } from 'vitest';
import {
  buildAfterHoursReadiness,
  buildExceptionCommandCenter,
  buildFacilityVisibility,
  buildRemediationGuidance,
  buildUnifiedWorkbench,
} from './workflow-dashboard-sections';
import type { WorkflowCoreData } from './workflow-dashboard-queries';

type UpcomingScheduleFixture = WorkflowCoreData['upcomingSchedules'][number];
type CommunicationQueueFixture = WorkflowCoreData['communicationQueue'];

function emptyCommunicationQueue(): CommunicationQueueFixture {
  return {
    summary: {
      pending_count: 0,
      overdue_count: 0,
      self_reports: 0,
      callback_followups: 0,
      open_requests: 0,
      delivery_backlog: 0,
      expiring_external_shares: 0,
      unconfirmed_count: 0,
      reply_waiting_count: 0,
      failed_count: 0,
    },
    items: [],
    timeline: [],
    emergency_drafts: [],
  };
}

describe('workflow-dashboard-sections', () => {
  it('groups multi-patient facility visits into visibility clusters', () => {
    const upcomingSchedules: UpcomingScheduleFixture[] = [
      {
        id: 'schedule_1',
        case_id: 'case_1',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        schedule_status: 'planned',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        carry_items_status: null,
        route_order: 1,
        escalation_reason: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        site: { id: 'site_1', name: '本店' },
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            residences: [{ building_id: 'facility_alpha', address: '施設A' }],
          },
        },
      },
      {
        id: 'schedule_2',
        case_id: 'case_2',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        schedule_status: 'planned',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        carry_items_status: null,
        route_order: 3,
        escalation_reason: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        site: { id: 'site_1', name: '本店' },
        case_: {
          patient: {
            id: 'patient_2',
            name: '患者B',
            residences: [{ building_id: 'facility_alpha', address: '施設A' }],
          },
        },
      },
    ];

    const result = buildFacilityVisibility(upcomingSchedules, new Map([['user_1', '佐藤 薬剤師']]));

    expect(result.clusters).toMatchObject([
      {
        label: 'facility_alpha',
        pharmacist_name: '佐藤 薬剤師',
        patient_count: 2,
        route_window: '1-3',
      },
    ]);
  });

  it('groups facility visibility by local calendar date', () => {
    const upcomingSchedules: UpcomingScheduleFixture[] = [
      {
        id: 'schedule_midnight',
        case_id: 'case_1',
        scheduled_date: new Date(2026, 2, 31, 0, 0, 0),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        schedule_status: 'planned',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        carry_items_status: null,
        route_order: 1,
        escalation_reason: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        site: { id: 'site_1', name: '本店' },
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            residences: [{ building_id: 'facility_alpha', address: '施設A' }],
          },
        },
      },
      {
        id: 'schedule_daytime',
        case_id: 'case_2',
        scheduled_date: new Date(2026, 2, 31, 13, 0, 0),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        schedule_status: 'planned',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        carry_items_status: null,
        route_order: 2,
        escalation_reason: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        site: { id: 'site_1', name: '本店' },
        case_: {
          patient: {
            id: 'patient_2',
            name: '患者B',
            residences: [{ building_id: 'facility_alpha', address: '施設A' }],
          },
        },
      },
    ];

    const result = buildFacilityVisibility(upcomingSchedules, new Map([['user_1', '佐藤 薬剤師']]));

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({
      label: 'facility_alpha',
      patient_count: 2,
      route_window: '1-2',
    });
  });

  it('matches after-hours coverage by local calendar date', () => {
    const result = buildAfterHoursReadiness(
      [
        {
          date: new Date(2026, 4, 6, 0, 0, 0),
          site_id: null,
          user_id: 'user_1',
        },
      ],
      [
        {
          id: 'holiday_1',
          date: new Date(2026, 4, 6, 13, 0, 0),
          name: '休日',
          site_id: null,
        },
      ],
    );

    expect(result).toMatchObject({
      emergency_capable_shift_count: 1,
      holiday_gap_count: 0,
      holiday_gaps: [],
    });
  });

  it('builds remediation cards for missing workflow gates and self reports', () => {
    expect(
      buildRemediationGuidance(
        2,
        1,
        5,
        6,
        2,
        {
          management_plan_review: 3,
          visit_intake_linkage: 1,
        },
        4,
      ),
    ).toMatchObject([
      expect.objectContaining({
        id: 'missing_visit_consent',
        count: 2,
        action_href: '/patients?readiness_issue=missing_visit_consent',
      }),
      expect.objectContaining({
        id: 'missing_management_plan',
        count: 1,
        action_href: '/patients?readiness_issue=missing_management_plan',
      }),
      expect.objectContaining({
        id: 'management_plan_review_overdue',
        count: 3,
        action_href: '/patients?readiness_issue=management_plan_review_overdue',
      }),
      expect.objectContaining({
        id: 'missing_first_visit_doc',
        count: 5,
        action_href: '/patients?readiness_issue=missing_first_visit_doc',
      }),
      expect.objectContaining({
        id: 'missing_emergency_contact',
        count: 6,
        action_href: '/patients?readiness_issue=missing_emergency_contact',
      }),
      expect.objectContaining({
        id: 'missing_primary_physician',
        count: 2,
        action_href: '/patients',
      }),
      expect.objectContaining({ id: 'visit_intake_linkage', count: 1 }),
      expect.objectContaining({ id: 'self_report_triage', count: 4 }),
    ]);
  });

  it('includes cadence summary in visit workbench items when preview is available', () => {
    const upcomingSchedules: UpcomingScheduleFixture[] = [
      {
        id: 'schedule_1',
        case_id: 'case_1',
        scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        schedule_status: 'planned',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        carry_items_status: null,
        route_order: null,
        escalation_reason: null,
        preparation: {
          medication_changes_reviewed: false,
          carry_items_confirmed: false,
          previous_issues_reviewed: false,
          route_confirmed: false,
          offline_synced: false,
          prepared_at: null,
        },
        override_request: null,
        applied_override: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            residences: [{ address: '東京都港区1-1-1', building_id: null }],
          },
        },
        site: null,
        cadence_preview: {
          next_billable_date: '2026-04-17',
          remaining_month_count: 1,
          warning_messages: ['月上限に近いです'],
        },
      },
    ];

    const result = buildUnifiedWorkbench(
      [],
      [],
      upcomingSchedules,
      [],
      0,
      [],
      emptyCommunicationQueue(),
      new Map([['user_1', '薬剤師A']]),
      new Map([['patient_1', '患者A']]),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'visit:schedule_1',
          summary: expect.stringContaining('次回算定可 2026-04-17'),
        }),
      ]),
    );
  });

  it('uses task metadata links only when metadata is object-shaped', () => {
    const pendingTasks: WorkflowCoreData['pendingTasks'] = [
      {
        id: 'task_valid',
        task_type: 'handoff_confirmation',
        title: '申し送り確認',
        description: null,
        status: 'pending',
        priority: 'high',
        assigned_to: 'user_1',
        due_date: null,
        sla_due_at: null,
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_1',
        metadata: {
          action_href: '/custom-handoff',
          action_label: '申し送り詳細',
          patient_name: '患者A',
        },
      },
      {
        id: 'task_malformed',
        task_type: 'handoff_confirmation',
        title: '申し送り確認',
        description: null,
        status: 'pending',
        priority: 'normal',
        assigned_to: null,
        due_date: null,
        sla_due_at: null,
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_2',
        metadata: ['unexpected'],
      },
    ];

    const result = buildUnifiedWorkbench(
      pendingTasks,
      [],
      [],
      [],
      0,
      [],
      emptyCommunicationQueue(),
      new Map([['user_1', '薬剤師A']]),
      new Map(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task:task_valid',
          action_href: '/custom-handoff',
          action_label: '申し送り詳細',
          patient_name: '患者A',
        }),
        expect.objectContaining({
          id: 'task:task_malformed',
          action_href: '/handoff',
          action_label: '申し送りを確認',
          patient_name: null,
        }),
      ]),
    );
  });

  it('focuses reply-waiting communication aggregates on the request follow-up queue', () => {
    const communicationQueue = emptyCommunicationQueue();
    communicationQueue.summary.reply_waiting_count = 2;

    const result = buildUnifiedWorkbench(
      [],
      [],
      [],
      [],
      0,
      [],
      communicationQueue,
      new Map(),
      new Map(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'aggregate:communication_reply_waiting',
          action_href: '/communications/requests?status=sent',
          action_label: '返信待ちを確認',
        }),
      ]),
    );
  });

  it('focuses proposal and visit workbench actions on concrete schedule targets', () => {
    const proposalId = 'proposal/unsafe ?#';
    const scheduleId = 'schedule/unsafe ?#';
    const pendingProposals: WorkflowCoreData['pendingProposals'] = [
      {
        id: proposalId,
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
        priority: 'high',
        proposed_date: new Date('2026-04-01T00:00:00.000Z'),
        visit_deadline_date: null,
        proposed_pharmacist_id: 'user_1',
        proposal_reason: null,
        reschedule_source_schedule_id: null,
        case_: { patient: { id: 'patient_1', name: '患者A' } },
      },
    ];
    const upcomingSchedules: WorkflowCoreData['upcomingSchedules'] = [
      {
        id: scheduleId,
        case_id: 'case_1',
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        schedule_status: 'planned',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        carry_items_status: null,
        route_order: 1,
        escalation_reason: null,
        preparation: {
          medication_changes_reviewed: false,
          carry_items_confirmed: false,
          previous_issues_reviewed: false,
          route_confirmed: false,
          offline_synced: false,
          prepared_at: null,
        },
        override_request: null,
        applied_override: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            residences: [{ address: '東京都港区1-1-1', building_id: null }],
          },
        },
        site: null,
        cadence_preview: null,
      },
    ];

    const result = buildUnifiedWorkbench(
      [],
      pendingProposals,
      upcomingSchedules,
      [],
      0,
      [],
      emptyCommunicationQueue(),
      new Map([['user_1', '薬剤師A']]),
      new Map([['patient_1', '患者A']]),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `proposal:${proposalId}`,
          action_href: `/schedules/proposals?detail=${encodeURIComponent(proposalId)}`,
        }),
        expect.objectContaining({
          id: `visit:${scheduleId}`,
          action_href: `/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`,
        }),
      ]),
    );
  });

  it('focuses self reports and awaiting report aggregates on their collaboration queues', () => {
    const result = buildUnifiedWorkbench(
      [],
      [],
      [],
      [
        {
          id: 'self_report_1',
          patient_id: 'patient_1',
          reported_by_name: '家族A',
          relation: '長女',
          category: 'symptom',
          subject: '眠気',
          requested_callback: true,
          preferred_contact_time: null,
          status: 'new',
          created_at: new Date('2026-04-01T09:00:00.000Z'),
        },
      ],
      2,
      [],
      emptyCommunicationQueue(),
      new Map(),
      new Map([['patient_1', '患者A']]),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'self-report:self_report_1',
          action_href: '/external?focus=self_reports',
        }),
        expect.objectContaining({
          id: 'aggregate:awaiting_reports',
          action_href: '/reports?focus=delivery&delivery_status=response_waiting',
        }),
      ]),
    );
  });

  it('focuses exception command center report and self-report aggregates', () => {
    const result = buildExceptionCommandCenter([], 0, 3, 2);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'aggregate:awaiting_reports',
          action_href: '/reports?focus=delivery&delivery_status=response_waiting',
        }),
        expect.objectContaining({
          id: 'aggregate:self_report_triage',
          action_href: '/external?focus=self_reports',
        }),
      ]),
    );
  });
});
