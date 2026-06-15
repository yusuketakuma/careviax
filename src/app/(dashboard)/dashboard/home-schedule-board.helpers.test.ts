import { describe, expect, it } from 'vitest';
import type { Proposal, VisitSchedule } from '@/app/(dashboard)/schedules/day-view.shared';
import {
  buildHomeScheduleStaffOptions,
  buildHomeScheduleStaffSummaries,
  buildProposalBoardHref,
  buildProposalPatientHref,
  buildScheduleBoardHref,
  buildSchedulePatientHref,
  buildHomeScheduleMetrics,
  countProposalsByReason,
  countSchedulesByReason,
  countSchedulesByStatus,
  countCoordinationProposalsByFilter,
  filterCoordinationProposals,
  filterProposalsByReason,
  filterSchedulesByReason,
  filterSchedulesByStatus,
  filterSchedulesByScope,
  proposalNeedsCoordination,
  resolveProposalPriorityReasons,
  resolveProposalPrimaryAction,
  resolveSchedulePriorityReasons,
  resolveSchedulePrimaryAction,
  resolveScheduleSecondaryAction,
  scheduleHasTimingGap,
  scheduleNeedsPreparation,
  sortCoordinationProposals,
  sortHomeSchedules,
} from './home-schedule-board.helpers';

function buildSchedule(overrides?: Partial<VisitSchedule>): VisitSchedule {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: null,
    scheduled_date: '2026-04-10T00:00:00.000Z',
    time_window_start: '2026-04-10T09:00:00.000Z',
    time_window_end: '2026-04-10T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 2,
    facility_batch_id: null,
    confirmed_at: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: null,
    preparation: null,
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: {
      daily_visit_count: 2,
      urgent_visit_count: 0,
    },
    handoff_hint: null,
    ...overrides,
  };
}

function buildProposal(overrides?: Partial<Proposal>): Proposal {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'patient_contact_pending',
    patient_contact_status: 'pending',
    proposed_date: '2026-04-11T00:00:00.000Z',
    time_window_start: '2026-04-11T10:00:00.000Z',
    time_window_end: '2026-04-11T11:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: null,
    route_distance_score: null,
    medication_end_date: null,
    visit_deadline_date: null,
    proposal_reason: '訪問候補',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: null,
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

describe('home-schedule-board helpers', () => {
  it('identifies schedule preparation and timing gaps', () => {
    expect(scheduleNeedsPreparation(buildSchedule())).toBe(true);
    expect(
      scheduleNeedsPreparation(
        buildSchedule({
          preparation: {
            id: 'prep_1',
            prepared_at: '2026-04-10T08:00:00.000Z',
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
            checklist: {},
          },
        }),
      ),
    ).toBe(false);

    expect(scheduleHasTimingGap(buildSchedule({ time_window_end: null }))).toBe(true);
    expect(scheduleHasTimingGap(buildSchedule())).toBe(false);
  });

  it('sorts schedules by time, route order, and priority', () => {
    const schedules = sortHomeSchedules([
      buildSchedule({ id: 'c', time_window_start: '2026-04-10T10:00:00.000Z' }),
      buildSchedule({ id: 'a', time_window_start: '2026-04-10T09:00:00.000Z', route_order: 3 }),
      buildSchedule({ id: 'b', time_window_start: '2026-04-10T09:00:00.000Z', route_order: 1 }),
    ]);

    expect(schedules.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('identifies coordination proposals and sorts them by date', () => {
    expect(proposalNeedsCoordination(buildProposal())).toBe(true);
    expect(
      proposalNeedsCoordination(
        buildProposal({ proposal_status: 'confirmed', patient_contact_status: 'confirmed' }),
      ),
    ).toBe(false);

    const proposals = sortCoordinationProposals([
      buildProposal({ id: 'b', proposed_date: '2026-04-12T00:00:00.000Z' }),
      buildProposal({ id: 'a', proposed_date: '2026-04-11T00:00:00.000Z' }),
    ]);

    expect(proposals.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('builds compact home metrics from schedules and proposals', () => {
    const metrics = buildHomeScheduleMetrics(
      [
        buildSchedule(),
        buildSchedule({
          id: 'schedule_2',
          time_window_end: null,
          preparation: {
            id: 'prep_2',
            prepared_at: '2026-04-10T08:00:00.000Z',
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
            checklist: {},
          },
        }),
      ],
      [
        buildProposal(),
        buildProposal({
          id: 'proposal_2',
          proposal_status: 'confirmed',
          patient_contact_status: 'confirmed',
        }),
      ],
    );

    expect(metrics).toEqual({
      totalVisits: 2,
      preparationPending: 1,
      timingGaps: 1,
      coordinationPending: 1,
    });
  });

  it('filters schedules by display scope', () => {
    const schedules = [
      buildSchedule({ id: 'mine', pharmacist_id: 'pharmacist_1' }),
      buildSchedule({ id: 'other', pharmacist_id: 'pharmacist_2' }),
    ];

    expect(
      filterSchedulesByScope(schedules, 'pharmacy', 'pharmacist_1').map((item) => item.id),
    ).toEqual(['mine', 'other']);
    expect(
      filterSchedulesByScope(schedules, 'mine', 'pharmacist_1').map((item) => item.id),
    ).toEqual(['mine']);
    expect(
      filterSchedulesByScope(schedules, 'user', 'pharmacist_1', 'pharmacist_2').map(
        (item) => item.id,
      ),
    ).toEqual(['other']);
    expect(filterSchedulesByScope(schedules, 'mine', null).map((item) => item.id)).toEqual([]);
  });

  it('builds staff options and workload summaries for the home schedule switcher', () => {
    const schedules = [
      buildSchedule({ id: 'mine', pharmacist_id: 'pharmacist_1' }),
      buildSchedule({ id: 'gap', pharmacist_id: 'pharmacist_1', time_window_end: null }),
      buildSchedule({
        id: 'other',
        pharmacist_id: 'pharmacist_2',
        schedule_status: 'in_progress',
        preparation: {
          id: 'prep_1',
          prepared_at: '2026-04-10T08:00:00.000Z',
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
          checklist: {},
        },
      }),
    ];

    expect(
      buildHomeScheduleStaffOptions(schedules, [
        { id: 'pharmacist_1', name: '薬剤師A', siteName: '本店' },
      ])
        .map((staff) => staff.id)
        .sort(),
    ).toEqual(['pharmacist_1', 'pharmacist_2']);

    expect(
      buildHomeScheduleStaffSummaries(schedules, [
        { id: 'pharmacist_1', name: '薬剤師A', siteName: '本店' },
        { id: 'pharmacist_2', name: '薬剤師B', siteName: '支店' },
      ]),
    ).toMatchObject([
      {
        id: 'pharmacist_1',
        totalVisits: 2,
        preparationPending: 2,
        timingGaps: 1,
      },
      {
        id: 'pharmacist_2',
        totalVisits: 1,
        inProgress: 1,
      },
    ]);
  });

  it('filters schedules by visit execution status', () => {
    const schedules = [
      buildSchedule({ id: 'planned', schedule_status: 'planned' }),
      buildSchedule({ id: 'prep', schedule_status: 'in_preparation' }),
      buildSchedule({ id: 'ready', schedule_status: 'ready' }),
      buildSchedule({ id: 'departed', schedule_status: 'departed' }),
      buildSchedule({ id: 'progress', schedule_status: 'in_progress' }),
    ];

    expect(filterSchedulesByStatus(schedules, 'before_departure').map((item) => item.id)).toEqual([
      'planned',
      'prep',
    ]);
    expect(filterSchedulesByStatus(schedules, 'ready_to_depart').map((item) => item.id)).toEqual([
      'ready',
    ]);
    expect(filterSchedulesByStatus(schedules, 'in_progress').map((item) => item.id)).toEqual([
      'departed',
      'progress',
    ]);
    expect(countSchedulesByStatus(schedules, 'all')).toBe(5);
  });

  it('filters coordination proposals by follow-up mode', () => {
    const proposals = [
      buildProposal({
        id: 'pending',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
      buildProposal({
        id: 'change',
        proposal_status: 'confirmed',
        patient_contact_status: 'change_requested',
      }),
      buildProposal({
        id: 'reschedule',
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'unreachable',
      }),
    ];

    expect(filterCoordinationProposals(proposals, 'pending').map((item) => item.id)).toEqual([
      'pending',
    ]);
    expect(
      filterCoordinationProposals(proposals, 'change_requested').map((item) => item.id),
    ).toEqual(['change']);
    expect(filterCoordinationProposals(proposals, 'reschedule').map((item) => item.id)).toEqual([
      'reschedule',
    ]);
    expect(countCoordinationProposalsByFilter(proposals, 'all')).toBe(3);
    expect(filterProposalsByReason(proposals, 'change_requested').map((item) => item.id)).toEqual([
      'change',
    ]);
    expect(countProposalsByReason(proposals, 'reschedule_origin')).toBe(1);
  });

  it('builds proposal deep links that preserve dashboard context', () => {
    expect(
      buildProposalBoardHref(
        buildProposal({
          id: 'proposal_contact',
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'pending',
        }),
      ),
    ).toBe(
      '/schedules/proposals?workspace=dashboard&detail=proposal_contact&focus=detail&status=patient_contact_pending&preset=contact',
    );

    expect(
      buildProposalBoardHref(
        buildProposal({
          id: 'proposal_reschedule',
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'unreachable',
        }),
      ),
    ).toBe(
      '/schedules/proposals?workspace=dashboard&detail=proposal_reschedule&focus=detail&status=proposed&preset=reschedule',
    );

    expect(
      resolveProposalPrimaryAction(
        buildProposal({
          id: 'proposal_change',
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'change_requested',
        }),
      ),
    ).toEqual({
      href: '/schedules/proposals?workspace=dashboard&detail=proposal_change&focus=detail&status=patient_contact_pending&preset=contact',
      label: '変更希望を確認',
    });
    expect(
      resolveProposalPriorityReasons(
        buildProposal({
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'change_requested',
          priority: 'urgent',
        }),
      ).map((item) => item.label),
    ).toEqual(['再調整由来', '変更希望', '至急候補']);
  });

  it('resolves visit actions from schedule status', () => {
    expect(resolveSchedulePrimaryAction(buildSchedule()).label).toBe('準備を開く');
    expect(buildScheduleBoardHref(buildSchedule())).toBe(
      '/schedules?date=2026-04-10&tab=confirmed&schedule=schedule_1#schedule-schedule_1',
    );
    expect(buildSchedulePatientHref(buildSchedule())).toBe(
      '/patients/patient_1#card-recent-activities',
    );
    expect(resolveSchedulePrimaryAction(buildSchedule({ schedule_status: 'ready' }))).toEqual({
      href: '/visits/schedule_1/record',
      label: '出発確認',
      emphasis: 'primary',
    });
    expect(resolveSchedulePrimaryAction(buildSchedule({ schedule_status: 'in_progress' }))).toEqual(
      {
        href: '/visits/schedule_1/record',
        label: '記録を再開',
        emphasis: 'primary',
      },
    );

    expect(resolveScheduleSecondaryAction(buildSchedule()).label).toBe('訪問記録');
    expect(resolveScheduleSecondaryAction(buildSchedule({ schedule_status: 'departed' }))).toEqual({
      href: '/schedules?date=2026-04-10&tab=confirmed&schedule=schedule_1#schedule-schedule_1',
      label: 'スケジュールで確認',
      emphasis: 'secondary',
    });
    expect(
      resolveSchedulePriorityReasons(
        buildSchedule({
          priority: 'urgent',
          time_window_end: null,
          override_request: {
            id: 'override_1',
            status: 'pending',
            reason: '調整中',
            requested_at: '2026-04-10T08:00:00.000Z',
            approved_at: null,
            approved_by: null,
            impact_summary: null,
          },
        }),
      ).map((item) => item.label),
    ).toEqual(['至急対応', '準備未完了', '時間未確定']);
    expect(
      filterSchedulesByReason(
        [
          buildSchedule({ id: 'pending', time_window_end: null }),
          buildSchedule({
            id: 'ready',
            schedule_status: 'ready',
            preparation: {
              id: 'prep_1',
              prepared_at: '2026-04-10T08:00:00.000Z',
              medication_changes_reviewed: true,
              carry_items_confirmed: true,
              previous_issues_reviewed: true,
              route_confirmed: true,
              offline_synced: true,
              checklist: {},
            },
          }),
        ],
        'timing_gap',
      ).map((item) => item.id),
    ).toEqual(['pending']);
    expect(
      countSchedulesByReason(
        [
          buildSchedule({ id: 'pending', time_window_end: null }),
          buildSchedule({ id: 'pending-2', time_window_end: null }),
        ],
        'timing_gap',
      ),
    ).toBe(2);
  });

  it('builds patient detail links for proposal follow-up continuity', () => {
    expect(buildProposalPatientHref(buildProposal())).toBe(
      '/patients/patient_1#card-recent-activities',
    );
  });
});
