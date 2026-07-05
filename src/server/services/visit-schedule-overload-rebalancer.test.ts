import { describe, expect, it, vi } from 'vitest';
import {
  previewVisitScheduleOverloadRebalance,
  toVisitScheduleOverloadRebalanceApiPreview,
} from './visit-schedule-overload-rebalancer';

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function time(hour: number) {
  return new Date(Date.UTC(1970, 0, 1, hour, 0, 0, 0));
}

function proposal(overrides: Partial<ReturnType<typeof baseProposal>> = {}) {
  return {
    ...baseProposal(),
    ...overrides,
  };
}

function baseProposal() {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    site_id: 'site_1',
    visit_type: 'regular' as const,
    priority: 'normal' as const,
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    finalized_schedule_id: null,
    proposed_date: utcDate('2026-04-10'),
    proposed_pharmacist_id: 'pharmacist_1',
    route_order: 1,
    vehicle_resource_id: 'vehicle_1',
    reschedule_source_schedule_id: null,
  };
}

function makeDb(args: {
  proposals: ReturnType<typeof proposal>[];
  schedules?: Array<{ id: string; scheduled_date: Date; pharmacist_id: string }>;
  users?: Array<{ id: string; max_daily_visits: number | null }>;
}) {
  return {
    visitScheduleProposal: {
      findMany: vi.fn().mockResolvedValue(args.proposals),
    },
    visitSchedule: {
      findMany: vi.fn().mockResolvedValue(args.schedules ?? []),
    },
    user: {
      findMany: vi
        .fn()
        .mockResolvedValue(args.users ?? [{ id: 'pharmacist_1', max_daily_visits: 3 }]),
    },
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    org_id: 'org_1',
    cycle_id: null,
    case_id: 'case_1',
    site_id: 'site_1',
    visit_type: 'regular' as const,
    priority: 'normal' as const,
    proposal_status: 'proposed' as const,
    patient_contact_status: 'pending' as const,
    proposed_date: utcDate('2026-04-08'),
    time_window_start: time(9),
    time_window_end: time(10),
    proposed_pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary' as const,
    route_order: 1,
    route_distance_score: 0,
    vehicle_resource_id: 'vehicle_1',
    medication_end_date: null,
    visit_deadline_date: utcDate('2026-04-10'),
    proposal_reason: 'overload preview candidate',
    escalation_reason: null,
    reschedule_source_schedule_id: null,
    ...overrides,
  };
}

describe('previewVisitScheduleOverloadRebalance', () => {
  it('previews earlier replacements only for mutable uncontacted proposals and counts open proposals', async () => {
    const source = proposal({ id: 'proposal_source', route_order: 2 });
    const contacted = proposal({
      id: 'proposal_contacted',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'pending',
      route_order: 3,
    });
    const secondMutable = proposal({ id: 'proposal_second', case_id: 'case_2', route_order: 4 });
    const db = makeDb({
      proposals: [source, contacted, secondMutable],
      schedules: [
        { id: 'schedule_1', scheduled_date: utcDate('2026-04-10'), pharmacist_id: 'pharmacist_1' },
      ],
      users: [{ id: 'pharmacist_1', max_daily_visits: 3 }],
    });
    const generateDrafts = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [draft({ case_id: 'case_1' })],
        diagnostics: { accepted: [], rejected: [] },
      })
      .mockResolvedValueOnce({
        drafts: [draft({ case_id: 'case_2', route_order: 2 })],
        diagnostics: { accepted: [], rejected: [] },
      });

    const result = await previewVisitScheduleOverloadRebalance({
      orgId: 'org_1',
      dateFrom: utcDate('2026-04-01'),
      dateTo: utcDate('2026-04-30'),
      db,
      generateDrafts,
    });

    expect(result.overloaded_cells).toEqual([
      {
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: '2026-04-10',
        occupancy_count: 4,
        max_daily_visits: 3,
        eligible_proposal_count: 2,
      },
    ]);
    expect(result.previews).toHaveLength(2);
    expect(result.previews[0]).toMatchObject({
      source_proposal_id: 'proposal_source',
      reason_code: 'overload_advance',
      from: {
        proposed_date: '2026-04-10',
        occupancy_count: 4,
        max_daily_visits: 3,
      },
      diagnostics: {
        destination_date: '2026-04-08',
        destination_occupancy_count: 0,
        destination_max_daily_visits: 3,
      },
    });
    expect(result.skipped).toEqual([
      { source_proposal_id: 'proposal_contacted', reason_code: 'not_mutable' },
    ]);
    expect(db.visitScheduleProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          finalized_schedule_id: null,
          proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        }),
      }),
    );
    expect(db.visitSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
          },
          pharmacist_id: { in: ['pharmacist_1'] },
        }),
      }),
    );
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          id: { in: ['pharmacist_1'] },
        },
      }),
    );
    expect(generateDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        caseId: 'case_1',
        candidateCount: 5,
        preferredPharmacistId: 'pharmacist_1',
        vehicleResourceId: 'vehicle_1',
      }),
    );
  });

  it('skips preview replacements when the earlier destination is already at daily capacity', async () => {
    const db = makeDb({
      proposals: [
        proposal({ id: 'proposal_source', route_order: 1 }),
        proposal({ id: 'proposal_peer', case_id: 'case_peer', route_order: 2 }),
      ],
      schedules: [
        {
          id: 'schedule_dest',
          scheduled_date: utcDate('2026-04-08'),
          pharmacist_id: 'pharmacist_1',
        },
      ],
      users: [{ id: 'pharmacist_1', max_daily_visits: 1 }],
    });
    const generateDrafts = vi.fn().mockResolvedValue({
      drafts: [draft()],
      diagnostics: { accepted: [], rejected: [] },
    });

    const result = await previewVisitScheduleOverloadRebalance({
      orgId: 'org_1',
      dateFrom: utcDate('2026-04-01'),
      dateTo: utcDate('2026-04-30'),
      db,
      generateDrafts,
    });

    expect(result.overloaded_cells).toHaveLength(1);
    expect(result.previews).toEqual([]);
    expect(result.skipped).toEqual([
      { source_proposal_id: 'proposal_source', reason_code: 'destination_capacity_full' },
      { source_proposal_id: 'proposal_peer', reason_code: 'destination_capacity_full' },
    ]);
  });

  it('does not overfill an earlier destination with previews selected in the same run', async () => {
    const db = makeDb({
      proposals: [
        proposal({ id: 'proposal_source', route_order: 1 }),
        proposal({ id: 'proposal_peer', case_id: 'case_peer', route_order: 2 }),
      ],
      users: [{ id: 'pharmacist_1', max_daily_visits: 1 }],
    });
    const generateDrafts = vi.fn().mockResolvedValue({
      drafts: [draft({ proposed_date: utcDate('2026-04-08') })],
      diagnostics: { accepted: [], rejected: [] },
    });

    const result = await previewVisitScheduleOverloadRebalance({
      orgId: 'org_1',
      dateFrom: utcDate('2026-04-01'),
      dateTo: utcDate('2026-04-30'),
      db,
      generateDrafts,
    });

    expect(result.previews).toHaveLength(1);
    expect(result.skipped).toEqual([
      { source_proposal_id: 'proposal_peer', reason_code: 'destination_capacity_full' },
    ]);
  });

  it('maps internal previews to an API-safe non-PHI DTO', () => {
    const apiPreview = toVisitScheduleOverloadRebalanceApiPreview({
      overloaded_cells: [
        {
          proposed_pharmacist_id: 'pharmacist_1',
          proposed_date: '2026-04-10',
          occupancy_count: 4,
          max_daily_visits: 3,
          eligible_proposal_count: 2,
        },
      ],
      previews: [
        {
          source_proposal_id: 'proposal_source',
          reason_code: 'overload_advance',
          from: {
            proposed_date: '2026-04-10',
            proposed_pharmacist_id: 'pharmacist_1',
            route_order: 2,
            occupancy_count: 4,
            max_daily_visits: 3,
          },
          replacement: {
            case_id: 'case_secret',
            site_id: 'site_1',
            visit_type: 'regular',
            priority: 'normal',
            proposed_date: utcDate('2026-04-08'),
            time_window_start: time(9),
            time_window_end: time(10),
            proposed_pharmacist_id: 'pharmacist_1',
            route_order: 1,
            vehicle_resource_id: 'vehicle_1',
            visit_deadline_date: utcDate('2026-04-10'),
          },
          diagnostics: {
            destination_date: '2026-04-08',
            destination_occupancy_count: 0,
            destination_max_daily_visits: 3,
          },
        },
      ],
      skipped: [
        { source_proposal_id: 'proposal_contacted', reason_code: 'not_mutable' },
        { source_proposal_id: 'proposal_full', reason_code: 'destination_capacity_full' },
      ],
    });

    expect(apiPreview).toEqual({
      preview_only: true,
      apply_available: false,
      unsupported_guards: [
        'pharmacist_review_required',
        'vehicle_open_proposal_capacity',
        'billing_cap_recheck',
      ],
      overloaded_cells: [
        {
          date: '2026-04-10',
          pharmacist_id: 'pharmacist_1',
          occupancy_count: 4,
          capacity_limit: 3,
          over_by: 1,
          eligible_proposal_count: 2,
        },
      ],
      recommendations: [
        {
          source_proposal_id: 'proposal_source',
          reason_code: 'overload_advance',
          from: {
            date: '2026-04-10',
            pharmacist_id: 'pharmacist_1',
            route_order: 2,
            occupancy_count: 4,
            capacity_limit: 3,
          },
          replacement: {
            date: '2026-04-08',
            time_window_start: '09:00',
            time_window_end: '10:00',
            pharmacist_id: 'pharmacist_1',
            route_order: 1,
            site_id: 'site_1',
            vehicle_resource_id: 'vehicle_1',
            visit_deadline_date: '2026-04-10',
            visit_type: 'regular',
            priority: 'normal',
          },
        },
      ],
      skipped_summary: [
        { reason_code: 'not_mutable', count: 1 },
        { reason_code: 'no_earlier_candidate', count: 0 },
        { reason_code: 'destination_capacity_full', count: 1 },
      ],
    });
    expect(JSON.stringify(apiPreview)).not.toContain('case_secret');
    expect(JSON.stringify(apiPreview)).not.toContain('proposal_contacted');
    expect(JSON.stringify(apiPreview)).not.toContain('destination_occupancy_count');
  });
});
