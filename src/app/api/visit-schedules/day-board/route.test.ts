import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  withOrgContextMock,
  membershipFindManyMock,
  visitScheduleFindManyMock,
  dispenseTaskGroupByMock,
  taskGroupByMock,
  taskFindManyMock,
  taskCountMock,
  medicationCycleCountMock,
  proposalFindManyMock,
  proposalCountMock,
  facilityFindManyMock,
  contactLogFindManyMock,
  pharmacistShiftFindManyMock,
  visitVehicleResourceFindManyMock,
  careCaseFindManyMock,
  patientFindManyMock,
  inboundCommunicationSignalFindManyMock,
  consentRecordFindManyMock,
  firstVisitDocumentFindManyMock,
  managementPlanFindManyMock,
  billingEvidenceFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  withOrgContextMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  dispenseTaskGroupByMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  proposalCountMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  contactLogFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  inboundCommunicationSignalFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findMany: membershipFindManyMock },
    visitSchedule: { findMany: visitScheduleFindManyMock },
    dispenseTask: { groupBy: dispenseTaskGroupByMock },
    task: { groupBy: taskGroupByMock, findMany: taskFindManyMock, count: taskCountMock },
    medicationCycle: { count: medicationCycleCountMock },
    visitScheduleProposal: { findMany: proposalFindManyMock, count: proposalCountMock },
    facility: { findMany: facilityFindManyMock },
    visitScheduleContactLog: { findMany: contactLogFindManyMock },
    pharmacistShift: { findMany: pharmacistShiftFindManyMock },
    visitVehicleResource: { findMany: visitVehicleResourceFindManyMock },
    careCase: { findMany: careCaseFindManyMock },
    patient: { findMany: patientFindManyMock },
    inboundCommunicationSignal: {
      findMany: inboundCommunicationSignalFindManyMock,
    },
    consentRecord: { findMany: consentRecordFindManyMock },
    firstVisitDocument: { findMany: firstVisitDocumentFindManyMock },
    managementPlan: { findMany: managementPlanFindManyMock },
    billingEvidence: { findMany: billingEvidenceFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(date?: string) {
  const url = new URL('http://localhost/api/visit-schedules/day-board');
  if (date) url.searchParams.set('date', date);
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

function createRequestWithSearch(search: string) {
  return new NextRequest(`http://localhost/api/visit-schedules/day-board${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/visit-schedules/day-board', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // ローカル(JST 想定)の朝。@db.Date 境界バグはこの時間帯で前日落ちしていた
    vi.setSystemTime(new Date(2026, 5, 12, 9, 0));
    vi.clearAllMocks();
    authContextMock.role = 'admin';
    authContextMock.userId = 'user_1';
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    dispenseTaskGroupByMock.mockResolvedValue([]);
    taskGroupByMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(0);
    medicationCycleCountMock.mockResolvedValue(0);
    proposalFindManyMock.mockResolvedValue([]);
    proposalCountMock.mockResolvedValue(0);
    facilityFindManyMock.mockResolvedValue([]);
    contactLogFindManyMock.mockResolvedValue([]);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    visitVehicleResourceFindManyMock.mockResolvedValue([]);
    careCaseFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);
    billingEvidenceFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingEvidence: { findMany: billingEvidenceFindManyMock },
        careCase: { findMany: careCaseFindManyMock },
        consentRecord: { findMany: consentRecordFindManyMock },
        dispenseTask: { groupBy: dispenseTaskGroupByMock },
        facility: { findMany: facilityFindManyMock },
        firstVisitDocument: { findMany: firstVisitDocumentFindManyMock },
        managementPlan: { findMany: managementPlanFindManyMock },
        membership: { findMany: membershipFindManyMock },
        pharmacistShift: { findMany: pharmacistShiftFindManyMock },
        task: {
          groupBy: taskGroupByMock,
          findMany: taskFindManyMock,
          count: taskCountMock,
        },
        visitSchedule: { findMany: visitScheduleFindManyMock },
        visitScheduleContactLog: { findMany: contactLogFindManyMock },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
          count: proposalCountMock,
        },
        visitVehicleResource: { findMany: visitVehicleResourceFindManyMock },
        patient: { findMany: patientFindManyMock },
        inboundCommunicationSignal: {
          findMany: inboundCommunicationSignalFindManyMock,
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries scheduled_date with the UTC-midnight range for the local date key', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
    });

    const where = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.where;
    const proposalWhere = proposalFindManyMock.mock.calls.at(0)?.[0]?.where;
    const proposalCountWhere = proposalCountMock.mock.calls.at(0)?.[0]?.where;
    const select = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.select;
    // ローカル 2026-06-12 → UTC midnight 範囲。ローカル深夜(6/11T15:00Z)を渡すと
    // Prisma の @db.Date 切り捨てで前日扱いになり、当日訪問が全件こぼれる(回帰防止)
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
    expect(proposalWhere?.proposed_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
    expect(proposalCountWhere).toEqual(proposalWhere);
    expect(select).toMatchObject({
      display_id: true,
      cycle: { select: { overall_status: true } },
      carry_items_status: true,
      case_: {
        select: {
          display_id: true,
          patient: {
            select: {
              id: true,
              display_id: true,
              name: true,
              archived_at: true,
            },
          },
        },
      },
      preparation: {
        select: {
          prepared_at: true,
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
      },
    });
    const json = await response.json();
    expect(json.data.pending_proposals).toEqual([]);
    expect(json.data.pending_proposal_counts).toEqual({
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      limit: 3,
      hidden_operational_task_count: 0,
    });
    expect(json.data.inbound_schedule_requests).toEqual([]);
    expect(json.data.inbound_schedule_request_counts).toEqual({
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      limit: 5,
      count_basis: 'formal_schedule_signal_visible_window',
    });
    expect(proposalFindManyMock).toHaveBeenCalledTimes(1);
    expect(proposalCountMock).toHaveBeenCalledTimes(1);
    expect(inboundCommunicationSignalFindManyMock).toHaveBeenCalledTimes(1);
    expect(contactLogFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it('uses the Japan business date when date is omitted even if the instant is still the previous UTC day', async () => {
    vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z')); // 2026-06-12 00:30 JST

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.where;
    const proposalWhere = proposalFindManyMock.mock.calls.at(0)?.[0]?.where;
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
    expect(proposalWhere?.proposed_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
  });

  it('uses the explicit date query parameter as the local date key', async () => {
    const response = (await GET(createRequest('2026-06-20'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.where;
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-20T00:00:00.000Z'),
      lt: new Date('2026-06-21T00:00:00.000Z'),
    });
  });

  it('returns pending proposal counts separately from the capped visible proposal rows', async () => {
    const visibleProposals = [
      {
        id: 'proposal_visible_1',
        display_id: 'vsp0000000001',
        visit_type: 'initial',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: {
          display_id: 'cc0000000001',
          patient: { id: 'patient_visible_1', display_id: 'p0000000001', name: '佐藤 花子' },
        },
      },
      {
        id: 'proposal_visible_2',
        display_id: 'vsp0000000002',
        visit_type: 'regular',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'attempted',
        proposed_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: {
          display_id: 'cc0000000002',
          patient: { id: 'patient_visible_2', display_id: 'p0000000002', name: '鈴木 修' },
        },
      },
      {
        id: 'proposal_visible_3',
        display_id: null,
        visit_type: 'regular',
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'change_requested',
        proposed_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: {
          display_id: null,
          patient: { id: 'patient_visible_3', display_id: null, name: '田中 改' },
        },
      },
    ];
    proposalFindManyMock
      .mockResolvedValueOnce(visibleProposals)
      .mockResolvedValueOnce([{ id: 'proposal_hidden_4' }, { id: 'proposal_hidden_5' }]);
    proposalCountMock.mockResolvedValue(5);
    taskCountMock.mockResolvedValue(2);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = (await GET(createRequest('2026-06-12'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    const visibleQuery = proposalFindManyMock.mock.calls.at(0)?.[0];
    const idQuery = proposalFindManyMock.mock.calls.at(1)?.[0];
    const countQuery = proposalCountMock.mock.calls.at(0)?.[0];
    expect(visibleQuery).toMatchObject({
      take: 3,
      where: {
        org_id: 'org_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        proposed_date: {
          gte: new Date('2026-06-12T00:00:00.000Z'),
          lt: new Date('2026-06-13T00:00:00.000Z'),
        },
      },
    });
    expect(idQuery).toMatchObject({
      where: visibleQuery.where,
      skip: 3,
      select: { id: true },
    });
    expect(countQuery).toEqual({ where: visibleQuery.where });
    expect(visibleQuery.where.proposal_status.in).not.toContain('confirmed');
    expect(visibleQuery.where.proposal_status.in).not.toContain('rejected');
    expect(visibleQuery.where.proposal_status.in).not.toContain('superseded');
    expect(visibleQuery.where.proposal_status.in).not.toContain('expired');
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_type: {
          in: [
            'visit_preparation',
            'visit_contact_followup',
            'visit_schedule_reproposal_needed',
            'visit_schedule_override_approval',
            'visit_carry_item_review',
            'facility_batch_tracker',
            'mobile_visit_mode',
            'pharmacy.inbound_schedule_request_review_required',
          ],
        },
        status: { in: ['pending', 'in_progress'] },
        AND: [
          {},
          {
            related_entity_type: 'visit_schedule_proposal',
            related_entity_id: { in: ['proposal_hidden_4', 'proposal_hidden_5'] },
          },
        ],
      },
    });
    expect(json.data.pending_proposals).toHaveLength(3);
    expect(json.data.pending_proposals[0]).toMatchObject({
      id: 'proposal_visible_1',
      display_id: 'vsp0000000001',
      case_display_id: 'cc0000000001',
      patient_id: 'patient_visible_1',
      patient_display_id: 'p0000000001',
    });
    expect(json.data.pending_proposal_counts).toEqual({
      total_count: 5,
      visible_count: 3,
      hidden_count: 2,
      limit: 3,
      hidden_operational_task_count: 2,
    });
    expect(JSON.stringify(json.data)).not.toContain('proposal_hidden_4');
    expect(JSON.stringify(json.data)).not.toContain('proposal_hidden_5');
    expect(JSON.stringify(json.data)).not.toContain('非表示患者');
  });

  it('returns minimal archive identifiers for scheduled visits and pending proposals', async () => {
    const archivedAt = new Date('2026-06-30T09:00:00.000Z');
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'visit_archived',
        case_id: 'case_archived',
        cycle_id: null,
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
        carry_items_status: 'ready',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 1,
        vehicle_resource_id: null,
        vehicle_resource: null,
        time_window_start: new Date(2026, 5, 12, 10, 0),
        time_window_end: new Date(2026, 5, 12, 10, 30),
        confirmed_at: null,
        cycle: null,
        preparation: {
          org_id: 'org_1',
          prepared_at: null,
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
        facility_batch_id: null,
        facility_batch: null,
        visit_record: null,
        case_: {
          patient: {
            id: 'patient_archived',
            name: '伊藤 アーカイブ',
            archived_at: archivedAt,
            archived_by: 'internal_user',
            allergy_info: [{ substance: 'ペニシリン詳細' }],
            insurances: [
              {
                insurance_type: 'medical',
                application_status: 'confirmed',
                public_program_code: null,
                copay_ratio: 30,
                valid_from: new Date('2026-01-01T00:00:00.000Z'),
                valid_until: new Date('2026-06-20T00:00:00.000Z'),
                is_active: true,
                number: 'RAW-INSURANCE-NUMBER',
              },
            ],
            lab_observations: [
              {
                analyte_code: 'egfr',
                value_numeric: 42,
                value_text: null,
                unit: 'mL/min',
                measured_at: new Date('2026-06-01T00:00:00.000Z'),
                abnormal_flag: 'L',
                note: 'RAW-LAB-NOTE',
              },
            ],
            contacts: [],
            residences: [],
          },
          care_team_links: [],
        },
      },
    ]);
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_archived',
        visit_type: 'regular',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: {
          patient: {
            id: 'patient_pending_archived',
            name: '鈴木 アーカイブ',
            archived_at: archivedAt,
            archived_by: 'internal_user',
            allergy_info: null,
            insurances: [],
            lab_observations: [],
          },
        },
      },
    ]);
    proposalCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest('2026-06-12'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.staff[0].visits[0]).toMatchObject({
      id: 'visit_archived',
      patient_id: 'patient_archived',
      patient_archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-06-30T09:00:00.000Z',
      },
      patient_summary: {
        patient_id: 'patient_archived',
        name: '伊藤 アーカイブ',
        insurance: {
          current_count: 1,
          missing: false,
          expires_soon_count: 1,
        },
        safety: {
          has_allergy: true,
          allergy_label: 'アレルギーあり',
          critical_lab_count: 1,
        },
      },
    });
    expect(json.data.pending_proposals[0]).toMatchObject({
      id: 'proposal_archived',
      patient_id: 'patient_pending_archived',
      patient_archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-06-30T09:00:00.000Z',
      },
      patient_summary: {
        patient_id: 'patient_pending_archived',
        name: '鈴木 アーカイブ',
        insurance: {
          current_count: 0,
          missing: true,
        },
        safety: {
          has_allergy: false,
          critical_lab_count: 0,
        },
      },
    });
    expect(json.data.staff[0].visits[0].patient_summary.safety.lab_flags[0]).toMatchObject({
      analyte_code: 'egfr',
      value_label: '42 mL/min',
      measured_at: '2026-06-01',
      abnormal: true,
    });
    const schedulePatientSelect =
      visitScheduleFindManyMock.mock.calls[0]?.[0]?.select.case_.select.patient.select;
    expect(schedulePatientSelect).toMatchObject({
      allergy_info: true,
      insurances: expect.objectContaining({
        select: expect.objectContaining({
          insurance_type: true,
          application_status: true,
          public_program_code: true,
          copay_ratio: true,
          valid_from: true,
          valid_until: true,
          is_active: true,
        }),
      }),
      lab_observations: expect.objectContaining({
        select: expect.objectContaining({
          analyte_code: true,
          value_numeric: true,
          value_text: true,
          unit: true,
          measured_at: true,
          abnormal_flag: true,
        }),
      }),
    });
    expect(schedulePatientSelect.insurances.where).toMatchObject({ org_id: 'org_1' });
    expect(schedulePatientSelect.lab_observations.where).toMatchObject({ org_id: 'org_1' });
    expect(schedulePatientSelect.insurances.select).not.toHaveProperty('number');
    expect(schedulePatientSelect.insurances.select).not.toHaveProperty('insurer_number');
    expect(schedulePatientSelect.lab_observations.select).not.toHaveProperty('note');
    expect(JSON.stringify(json.data)).not.toContain('archived_by');
    expect(JSON.stringify(json.data)).not.toContain('internal_user');
    expect(JSON.stringify(json.data)).not.toContain('ペニシリン詳細');
    expect(JSON.stringify(json.data)).not.toContain('RAW-INSURANCE-NUMBER');
    expect(JSON.stringify(json.data)).not.toContain('RAW-LAB-NOTE');
  });

  it('applies personal dashboard assignment scope to hidden proposal task counts', async () => {
    authContextMock.role = 'driver';
    authContextMock.userId = 'pharmacist_1';
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'pharmacist_1', name: '佐藤 真' } },
    ]);
    proposalFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'proposal_visible_1',
          visit_type: 'initial',
          proposal_status: 'proposed',
          patient_contact_status: 'pending',
          proposed_date: new Date('2026-06-12T00:00:00.000Z'),
          time_window_start: null,
          time_window_end: null,
          proposed_pharmacist_id: 'pharmacist_1',
          case_: { patient: { name: '佐藤 花子' } },
        },
        {
          id: 'proposal_visible_2',
          visit_type: 'regular',
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'attempted',
          proposed_date: new Date('2026-06-12T00:00:00.000Z'),
          time_window_start: null,
          time_window_end: null,
          proposed_pharmacist_id: 'pharmacist_1',
          case_: { patient: { name: '鈴木 修' } },
        },
        {
          id: 'proposal_visible_3',
          visit_type: 'regular',
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'change_requested',
          proposed_date: new Date('2026-06-12T00:00:00.000Z'),
          time_window_start: null,
          time_window_end: null,
          proposed_pharmacist_id: 'pharmacist_1',
          case_: { patient: { name: '田中 改' } },
        },
      ])
      .mockResolvedValueOnce([{ id: 'proposal_hidden_4' }]);
    proposalCountMock.mockResolvedValue(4);
    careCaseFindManyMock.mockResolvedValue([
      { id: 'case_1', patient_id: 'patient_1' },
      { id: 'case_2', patient_id: 'patient_1' },
    ]);
    taskCountMock.mockResolvedValue(1);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = (await GET(createRequest('2026-06-12'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'pharmacist_1' },
              { backup_pharmacist_id: 'pharmacist_1' },
              { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
            ],
          },
        ],
      },
      select: { id: true, patient_id: true },
    });
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_type: {
          in: [
            'visit_preparation',
            'visit_contact_followup',
            'visit_schedule_reproposal_needed',
            'visit_schedule_override_approval',
            'visit_carry_item_review',
            'facility_batch_tracker',
            'mobile_visit_mode',
            'pharmacy.inbound_schedule_request_review_required',
          ],
        },
        status: { in: ['pending', 'in_progress'] },
        AND: [
          {
            OR: [
              { assigned_to: 'pharmacist_1' },
              { related_entity_type: 'patient', related_entity_id: { in: ['patient_1'] } },
              { related_entity_type: 'case', related_entity_id: { in: ['case_1', 'case_2'] } },
            ],
          },
          {
            related_entity_type: 'visit_schedule_proposal',
            related_entity_id: { in: ['proposal_hidden_4'] },
          },
        ],
      },
    });
    expect(json.data.pending_proposal_counts).toEqual({
      total_count: 4,
      visible_count: 3,
      hidden_count: 1,
      limit: 3,
      hidden_operational_task_count: 1,
    });
  });

  it.each([
    ['blank date', '?date=', { date: ['日付形式が不正です（YYYY-MM-DD）'] }],
    ['padded date', '?date=%202026-06-20%20', { date: ['日付形式が不正です（YYYY-MM-DD）'] }],
    [
      'duplicate date',
      '?date=2026-06-20&date=2026-06-21',
      { date: ['date は1つだけ指定してください'] },
    ],
  ])('rejects %s before querying the day board', async (_name, search, details) => {
    const response = (await GET(createRequestWithSearch(search), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'クエリパラメータが不正です',
      details,
    });
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 envelope without leaking the raw error when a read throws', async () => {
    visitScheduleFindManyMock.mockRejectedValueOnce(new Error('raw day board read failure'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain('raw day board read failure');
    expect(payload).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
  });

  it('scopes audit/report workload and operational tasks to the current day board', async () => {
    const todaySchedule = {
      id: 'visit_today',
      case_id: 'case_today',
      cycle_id: 'cycle_today',
      pharmacist_id: 'user_1',
      visit_type: 'regular',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
      carry_items_status: 'ready',
      priority: 'normal',
      site_id: 'site_1',
      route_order: 1,
      vehicle_resource_id: null,
      vehicle_resource: null,
      time_window_start: new Date(2026, 5, 12, 10, 0),
      time_window_end: new Date(2026, 5, 12, 10, 30),
      confirmed_at: null,
      cycle: { overall_status: 'visit_completed' },
      preparation: {
        org_id: 'org_1',
        prepared_at: null,
        medication_changes_reviewed: true,
        carry_items_confirmed: true,
        previous_issues_reviewed: true,
        route_confirmed: true,
        offline_synced: true,
      },
      facility_batch_id: null,
      facility_batch: null,
      visit_record: null,
      case_: {
        patient: { id: 'patient_today', name: '伊藤 キヨ', contacts: [{ id: 'contact_1' }] },
        care_team_links: [{ role: 'physician' }],
      },
    };
    visitScheduleFindManyMock.mockResolvedValueOnce([todaySchedule]).mockResolvedValueOnce([]);
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_today',
        visit_type: 'regular',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '佐藤 花子' } },
      },
    ]);
    dispenseTaskGroupByMock.mockResolvedValue([
      { assigned_to: 'user_1', _count: { id: 2 } },
      { assigned_to: null, _count: { id: 1 } },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_visit_today',
        task_type: 'visit_preparation',
        title: '訪問準備',
        description: '持参物確認',
        status: 'pending',
        priority: 'urgent',
        assigned_to: 'user_1',
        due_date: new Date('2026-06-12T03:00:00.000Z'),
        sla_due_at: null,
        related_entity_type: 'visit_schedule',
        related_entity_id: 'visit_today',
        metadata: { patient_phone: '090-0000-0000' },
        created_at: new Date('2026-06-12T00:00:00.000Z'),
      },
      {
        id: 'task_proposal_today',
        task_type: 'visit_contact_followup',
        title: '連絡結果を確認',
        description: null,
        status: 'in_progress',
        priority: 'normal',
        assigned_to: null,
        due_date: null,
        sla_due_at: new Date('2026-06-12T04:00:00.000Z'),
        related_entity_type: 'visit_schedule_proposal',
        related_entity_id: 'proposal_today',
        metadata: { callback_note: '自由記載は出さない' },
        created_at: new Date('2026-06-12T01:00:00.000Z'),
      },
      {
        id: 'task_inbound_schedule_today',
        task_type: 'pharmacy.inbound_schedule_request_review_required',
        title: 'MCS本文: 来週の訪問時間を変えたい',
        description: '電話メモ raw schedule request',
        status: 'pending',
        priority: 'high',
        assigned_to: null,
        due_date: null,
        sla_due_at: new Date('2026-06-12T05:00:00.000Z'),
        related_entity_type: 'visit_schedule_proposal',
        related_entity_id: 'proposal_today',
        metadata: { raw_note: 'raw inbound note should not leak' },
        created_at: new Date('2026-06-12T01:30:00.000Z'),
      },
      {
        id: 'task_override_today',
        task_type: 'visit_schedule_override_approval',
        title: '変更承認',
        description: null,
        status: 'pending',
        priority: 'high',
        assigned_to: null,
        due_date: null,
        sla_due_at: null,
        related_entity_type: 'visit_schedule',
        related_entity_id: 'visit_today',
        metadata: {
          proposal_ids: [
            'proposal_reschedule',
            '',
            'proposal_reschedule',
            42,
            'proposal_leading_space ',
            'proposal/unsafe?phone=09011112222',
          ],
          source_schedule_id: ' visit_today ',
          patient_phone: '090-1111-2222',
          reason_note: '自由記載は返さない',
        },
        created_at: new Date('2026-06-12T02:00:00.000Z'),
      },
    ]);

    const response = (await GET(createRequest('2026-06-12'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(dispenseTaskGroupByMock).toHaveBeenCalledWith({
      by: ['assigned_to'],
      where: {
        org_id: 'org_1',
        status: 'completed',
        cycle_id: { in: ['cycle_today'] },
      },
      _count: { id: true },
    });
    expect(medicationCycleCountMock).not.toHaveBeenCalled();
    expect(json.data.audit_pending_count).toBe(3);
    expect(json.data.report_pending_count).toBe(1);
    expect(json.data.staff[0].audit_task_count).toBe(3);

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          task_type: {
            in: [
              'visit_preparation',
              'visit_contact_followup',
              'visit_schedule_reproposal_needed',
              'visit_schedule_override_approval',
              'visit_carry_item_review',
              'facility_batch_tracker',
              'mobile_visit_mode',
              'pharmacy.inbound_schedule_request_review_required',
            ],
          },
          status: { in: ['pending', 'in_progress'] },
          AND: expect.arrayContaining([
            {},
            {
              OR: [
                {
                  related_entity_type: 'visit_schedule',
                  related_entity_id: { in: ['visit_today'] },
                },
                {
                  related_entity_type: 'visit_schedule_proposal',
                  related_entity_id: { in: ['proposal_today'] },
                },
              ],
            },
          ]),
        }),
        take: 24,
        select: expect.objectContaining({ metadata: true }),
      }),
    );
    expect(json.data.operational_tasks).toEqual([
      expect.objectContaining({
        id: 'task_visit_today',
        due_date: '2026-06-12T03:00:00.000Z',
        metadata: null,
      }),
      expect.objectContaining({
        id: 'task_proposal_today',
        sla_due_at: '2026-06-12T04:00:00.000Z',
        metadata: null,
      }),
      expect.objectContaining({
        id: 'task_inbound_schedule_today',
        title: '受信訪問調整を確認',
        description: null,
        sla_due_at: '2026-06-12T05:00:00.000Z',
        metadata: null,
      }),
      expect.objectContaining({
        id: 'task_override_today',
        metadata: {
          proposal_ids: ['proposal_reschedule', 'proposal_leading_space'],
          source_schedule_id: 'visit_today',
        },
      }),
    ]);
    expect(JSON.stringify(json.data)).not.toContain('090-0000-0000');
    expect(JSON.stringify(json.data)).not.toContain('090-1111-2222');
    expect(JSON.stringify(json.data)).not.toContain('proposal/unsafe');
    expect(JSON.stringify(json.data)).not.toContain('自由記載は出さない');
    expect(JSON.stringify(json.data)).not.toContain('自由記載は返さない');
    expect(JSON.stringify(json.data)).not.toContain('MCS本文');
    expect(JSON.stringify(json.data)).not.toContain('電話メモ raw schedule request');
    expect(JSON.stringify(json.data)).not.toContain('raw inbound note should not leak');
  });

  it('surfaces bounded formal inbound schedule requests without raw/detail fields', async () => {
    authContextMock.role = 'driver';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_schedule' }]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_schedule' }]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_schedule_valid',
        signal_type: 'schedule_change_request',
        patient_id: 'patient_schedule',
        case_id: 'case_schedule',
        review_status: 'needs_review',
        action_status: 'not_linked',
        created_at: new Date('2026-06-12T01:00:00.000Z'),
        extracted_text: 'raw extracted text should not leak',
        inbound_event: {
          id: 'event_schedule_valid',
          patient_id: 'patient_schedule',
          case_id: 'case_schedule',
          source_channel: 'mcs',
          received_at: new Date('2026-06-12T00:30:00.000Z'),
          processing_status: 'signals_extracted',
          raw_text: 'MCS raw text should not leak',
          normalized_summary: 'normalized summary should not leak',
          sender_contact: '090-2222-3333',
        },
      },
      {
        id: 'signal_schedule_mismatch',
        signal_type: 'visit_request',
        patient_id: 'patient_a',
        case_id: 'case_a',
        review_status: 'accepted',
        action_status: 'not_linked',
        created_at: new Date('2026-06-12T00:45:00.000Z'),
        inbound_event: {
          id: 'event_schedule_mismatch',
          patient_id: 'patient_b',
          case_id: 'case_b',
          source_channel: 'phone',
          received_at: new Date('2026-06-12T00:15:00.000Z'),
          processing_status: 'reviewed',
        },
      },
    ]);

    const response = (await GET(createRequest('2026-06-12'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    const findManyArgs = inboundCommunicationSignalFindManyMock.mock.calls.at(0)?.[0];
    expect(findManyArgs).toMatchObject({
      where: {
        org_id: 'org_1',
        signal_domain: 'schedule',
        signal_type: { in: ['schedule_change_request', 'visit_request', 'unknown'] },
        action_status: 'not_linked',
        review_status: { in: ['needs_review', 'auto_accepted', 'accepted'] },
        inbound_event: {
          is: {
            AND: [
              {
                org_id: 'org_1',
                direction: 'inbound',
                has_schedule_signal: true,
                source_channel: { in: ['mcs', 'phone', 'fax', 'email', 'manual'] },
                processing_status: { not: 'ignored' },
              },
              {
                OR: [
                  { case_id: { in: ['case_schedule'] } },
                  {
                    AND: [{ case_id: null }, { patient_id: { in: ['patient_schedule'] } }],
                  },
                  {
                    AND: [{ case_id: null }, { patient_id: null }],
                  },
                ],
              },
            ],
          },
        },
      },
      take: 6,
      select: {
        id: true,
        signal_type: true,
        patient_id: true,
        case_id: true,
        review_status: true,
        action_status: true,
        inbound_event: {
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            source_channel: true,
            received_at: true,
          },
        },
      },
    });
    expect(JSON.stringify(findManyArgs.select)).not.toContain('raw_text');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('normalized_summary');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('extracted_text');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('extracted_medication_name');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('structured_payload');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('sender_name');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('sender_contact');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('sender_organization_name');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('external_url');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('attachment');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('medication');
    expect(JSON.stringify(findManyArgs.select)).not.toContain('rejection_reason');

    expect(json.data.inbound_schedule_requests).toEqual([
      {
        signal_id: 'signal_schedule_valid',
        signal_type: 'schedule_change_request',
        source_channel: 'mcs',
        received_at: '2026-06-12T00:30:00.000Z',
        review_status: 'needs_review',
        action_status: 'not_linked',
        patient_linked: true,
        case_linked: true,
      },
    ]);
    expect(json.data.inbound_schedule_request_counts).toEqual({
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      limit: 5,
      count_basis: 'formal_schedule_signal_visible_window',
    });
    expect(JSON.stringify(json.data)).not.toContain('raw extracted text should not leak');
    expect(JSON.stringify(json.data)).not.toContain('MCS raw text should not leak');
    expect(JSON.stringify(json.data)).not.toContain('normalized summary should not leak');
    expect(JSON.stringify(json.data)).not.toContain('090-2222-3333');
    expect(JSON.stringify(json.data)).not.toContain('signal_schedule_mismatch');
  });

  it('reports hidden staff visit and task counts without exposing hidden task details', async () => {
    const memberships = Array.from({ length: 7 }, (_, index) => {
      const ordinal = index + 1;
      return {
        role: 'pharmacist',
        user: { id: `user_${ordinal}`, name: `薬師 ${String(ordinal).padStart(2, '0')}` },
      };
    });
    membershipFindManyMock.mockResolvedValue(memberships);
    visitScheduleFindManyMock.mockResolvedValue(
      memberships.map((membership, index) => {
        const ordinal = index + 1;
        return {
          id: `visit_${ordinal}`,
          case_id: `case_${ordinal}`,
          cycle_id: null,
          pharmacist_id: membership.user.id,
          visit_type: 'regular',
          schedule_status: 'planned',
          scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
          carry_items_status: 'ready',
          priority: 'normal',
          site_id: 'site_1',
          route_order: ordinal,
          vehicle_resource_id: null,
          vehicle_resource: null,
          time_window_start: new Date(2026, 5, 12, 9 + ordinal, 0),
          time_window_end: new Date(2026, 5, 12, 9 + ordinal, 30),
          confirmed_at: null,
          cycle: { overall_status: 'visit_planned' },
          preparation:
            ordinal === 7
              ? null
              : {
                  org_id: 'org_1',
                  prepared_at: new Date('2026-06-12T00:00:00.000Z'),
                  medication_changes_reviewed: true,
                  carry_items_confirmed: true,
                  previous_issues_reviewed: true,
                  route_confirmed: true,
                  offline_synced: true,
                },
          facility_batch_id: null,
          facility_batch: null,
          visit_record: null,
          case_: {
            patient: {
              id: `patient_${ordinal}`,
              name: `患者 ${ordinal}`,
              contacts: [{ id: `contact_${ordinal}` }],
            },
            care_team_links: [{ role: 'physician' }],
          },
        };
      }),
    );
    consentRecordFindManyMock.mockResolvedValue(
      memberships.map((_, index) => ({ patient_id: `patient_${index + 1}` })),
    );
    firstVisitDocumentFindManyMock.mockResolvedValue(
      memberships.map((_, index) => ({
        case_id: `case_${index + 1}`,
        delivered_at: new Date('2026-06-01T00:00:00.000Z'),
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      })),
    );
    managementPlanFindManyMock.mockResolvedValue(
      memberships.map((_, index) => ({
        case_id: `case_${index + 1}`,
        next_review_date: new Date('2026-12-31T00:00:00.000Z'),
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        version: 1,
        approved_at: new Date('2026-06-01T00:00:00.000Z'),
      })),
    );
    taskCountMock.mockResolvedValue(2);

    const response = (await GET(createRequest('2026-06-12'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.staff).toHaveLength(6);
    expect(json.data.staff.map((member: { id: string }) => member.id)).not.toContain('user_7');
    expect(json.data.staff_counts).toEqual({
      total_count: 7,
      visible_count: 6,
      hidden_count: 1,
      total_visit_count: 7,
      visible_visit_count: 6,
      hidden_visit_count: 1,
      total_preparation_attention_count: 1,
      visible_preparation_attention_count: 0,
      hidden_preparation_attention_count: 1,
      hidden_operational_task_count: 2,
      limit: 6,
    });
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_type: {
          in: [
            'visit_preparation',
            'visit_contact_followup',
            'visit_schedule_reproposal_needed',
            'visit_schedule_override_approval',
            'visit_carry_item_review',
            'facility_batch_tracker',
            'mobile_visit_mode',
            'pharmacy.inbound_schedule_request_review_required',
          ],
        },
        status: { in: ['pending', 'in_progress'] },
        AND: [
          {},
          {
            related_entity_type: 'visit_schedule',
            related_entity_id: { in: ['visit_7'] },
          },
        ],
      },
    });
    expect(JSON.stringify(json.data)).not.toContain('患者 7');
  });

  it('drops members who are shift-unavailable for the day', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
      { role: 'clerk', user: { id: 'user_4', name: '田中 真' } },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      { user_id: 'user_4', available: false, available_from: null, available_to: null },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.staff.map((member: { id: string }) => member.id)).toEqual(['user_1']);
    const shiftWhere = pharmacistShiftFindManyMock.mock.calls.at(0)?.[0]?.where;
    expect(shiftWhere?.date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
    expect(pharmacistShiftFindManyMock.mock.calls.at(0)?.[0]?.select).toEqual({
      user_id: true,
      available: true,
      available_from: true,
      available_to: true,
    });
  });

  it('compares proposal impact ranges with the stored UTC date values and pharmacist shift capacity', async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        visit_type: 'regular',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '鈴木 修' } },
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        user_id: 'user_1',
        available: true,
        available_from: new Date(Date.UTC(1970, 0, 1, 10, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 15, 0)),
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
      },
    ]);

    const response = (await GET(createRequest('2026-06-13'), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    const impactWhere = visitScheduleFindManyMock.mock.calls.at(1)?.[0]?.where;
    expect(impactWhere?.OR?.[0]?.scheduled_date).toEqual({
      gte: new Date('2026-06-13T00:00:00.000Z'),
      lt: new Date('2026-06-14T00:00:00.000Z'),
    });

    const proposal = json.data.pending_proposals[0];
    // 同日訪問 1 件(60分 + 移動30分)が余白試算に乗る = UTC 日付キー同士の一致が機能
    // 10:00-15:00 シフトから昼休み 60 分を差し引いた 240 分が基準
    expect(proposal.idle_before_minutes).toBe(240 - 90);
    expect(proposal.idle_after_minutes).toBe(240 - 90 - 90);
    expect(proposal.proposed_date).toBe('2026-06-13');
  });

  it('reports zero proposal idle minutes when the proposed pharmacist is shift-unavailable', async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_off',
        visit_type: 'regular',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 10, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 11, 0)),
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '鈴木 修' } },
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      { user_id: 'user_1', available: false, available_from: null, available_to: null },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = (await GET(createRequest('2026-06-13'), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.pending_proposals).toEqual([
      expect.objectContaining({
        id: 'proposal_off',
        idle_before_minutes: 0,
        idle_after_minutes: 0,
      }),
    ]);
  });

  it('falls back to a 9-18 workday for the idle estimate when the proposed pharmacist has no shift row', async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_noshift',
        visit_type: 'regular',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '鈴木 修' } },
      },
    ]);
    // user_1 にシフト行なし → 既定 9:00-18:00 から昼休み 60 分を引いた 480 分を基準にする
    // (旧 WORKDAY_MINUTES - LUNCH_MINUTES と同値の fallback を保持していることを pin する)
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
      },
    ]);

    const response = (await GET(createRequest('2026-06-13'), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    const proposal = json.data.pending_proposals[0];
    // 同日訪問 1 件(60分 + 移動30分 = 90)を 480 分から引く。fallback を消すと 0 基準になり RED。
    expect(proposal.idle_before_minutes).toBe(480 - 90);
    expect(proposal.idle_after_minutes).toBe(480 - 90 - 90);
  });

  it('loads latest pending proposal callback logs in one query', async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        visit_type: 'regular',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'attempted',
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '鈴木 修' } },
      },
      {
        id: 'proposal_2',
        visit_type: 'initial',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-14T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '佐藤 花子' } },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    contactLogFindManyMock.mockResolvedValue([
      {
        proposal_id: 'proposal_1',
        callback_due_at: new Date('2026-06-12T04:00:00.000Z'),
      },
      {
        proposal_id: 'proposal_1',
        callback_due_at: new Date('2026-06-11T04:00:00.000Z'),
      },
      {
        proposal_id: 'proposal_2',
        callback_due_at: new Date('2026-06-13T05:00:00.000Z'),
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(contactLogFindManyMock).toHaveBeenCalledTimes(1);
    expect(contactLogFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', proposal_id: { in: ['proposal_1', 'proposal_2'] } },
      orderBy: [{ proposal_id: 'asc' }, { called_at: 'desc' }],
      select: { proposal_id: true, callback_due_at: true },
    });
    expect(json.data.pending_proposals).toEqual([
      expect.objectContaining({
        id: 'proposal_1',
        response_due_at: '2026-06-12T04:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'proposal_2',
        response_due_at: '2026-06-13T05:00:00.000Z',
      }),
    ]);
  });

  it('marks change-requested pending proposals for reproposal on the day board', async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_change',
        visit_type: 'regular',
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'change_requested',
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '鈴木 修' } },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(proposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          patient_contact_status: true,
        }),
      }),
    );
    expect(json.data.pending_proposals).toEqual([
      expect.objectContaining({
        id: 'proposal_change',
        patient_contact_status: 'change_requested',
        badge_label: '変更希望',
      }),
    ]);
  });

  it('returns visit route order and recommended vehicle resources for the day board', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        carry_items_status: 'partial',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 1,
        vehicle_resource_id: 'vehicle_1',
        vehicle_resource: { id: 'vehicle_1', label: '軽バン1号', travel_mode: 'DRIVE' },
        time_window_start: new Date(2026, 5, 12, 10, 0),
        time_window_end: new Date(2026, 5, 12, 10, 30),
        confirmed_at: new Date(2026, 5, 12, 9, 0),
        preparation: {
          prepared_at: new Date(2026, 5, 12, 9, 5),
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
        facility_batch_id: null,
        facility_batch: null,
        case_: { patient: { name: '伊藤 キヨ' } },
      },
      {
        id: 'visit_2',
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        carry_items_status: 'partial',
        priority: 'normal',
        scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
        site_id: 'site_1',
        route_order: 2,
        vehicle_resource_id: null,
        vehicle_resource: null,
        time_window_start: new Date(2026, 5, 12, 11, 0),
        time_window_end: new Date(2026, 5, 12, 11, 30),
        confirmed_at: null,
        preparation: {
          prepared_at: null,
          medication_changes_reviewed: true,
          carry_items_confirmed: false,
          previous_issues_reviewed: true,
          route_confirmed: false,
          offline_synced: true,
        },
        facility_batch_id: null,
        facility_batch: null,
        case_: { patient: { name: '田中 一郎' } },
      },
    ]);
    visitVehicleResourceFindManyMock.mockResolvedValue([
      {
        id: 'vehicle_1',
        label: '軽バン1号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'DRIVE',
        max_stops: 8,
        available: true,
      },
      {
        id: 'vehicle_2',
        label: '軽バン2号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-002',
        travel_mode: 'DRIVE',
        max_stops: 4,
        available: true,
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.staff[0].visits[0]).toMatchObject({
      id: 'visit_1',
      route_order: 1,
      vehicle_resource_id: 'vehicle_1',
      site_id: 'site_1',
      vehicle_label: '軽バン1号',
      vehicle_travel_mode: 'DRIVE',
      preparation_summary: {
        completed_count: 5,
        total_count: 5,
        status: 'blocked',
        incomplete_labels: ['持参物ステータス未解決'],
      },
    });
    expect(json.data.staff[0].visits[1]).toMatchObject({
      preparation_summary: {
        completed_count: 3,
        total_count: 5,
        status: 'blocked',
        incomplete_labels: ['持参物ステータス未解決', '持参薬・物品確認', 'ルート確認'],
      },
    });
    expect(json.data.vehicle_resources).toEqual([
      expect.objectContaining({
        id: 'vehicle_1',
        assigned_visit_count: 1,
        remaining_stops: 7,
        recommended: true,
        recommendation_reason: '同一拠点の未割当 1件を受けられます',
      }),
      expect.objectContaining({
        id: 'vehicle_2',
        assigned_visit_count: 0,
        remaining_stops: 4,
        recommended: false,
        recommendation_reason: '空き 4件',
      }),
    ]);
    expect(visitVehicleResourceFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: [{ available: 'desc' }, { label: 'asc' }],
      select: {
        id: true,
        label: true,
        site_id: true,
        vehicle_code: true,
        travel_mode: true,
        max_stops: true,
        max_route_duration_minutes: true,
        available: true,
        site: {
          select: {
            address: true,
            lat: true,
            lng: true,
          },
        },
      },
    });
  });

  it('returns PHI-minimal ready blocker categories without changing checklist status', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_ready_but_blocked',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        carry_items_status: 'ready',
        priority: 'normal',
        scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
        site_id: 'site_1',
        route_order: 1,
        vehicle_resource_id: null,
        vehicle_resource: null,
        time_window_start: new Date(2026, 5, 12, 10, 0),
        time_window_end: new Date(2026, 5, 12, 10, 30),
        confirmed_at: new Date(2026, 5, 12, 9, 0),
        preparation: {
          org_id: 'org_1',
          prepared_at: new Date(2026, 5, 12, 9, 5),
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
        facility_batch_id: null,
        facility_batch: null,
        visit_record: { id: 'visit_record_secret_1' },
        case_: {
          patient: {
            id: 'patient_1',
            name: '伊藤 キヨ',
            contacts: [{ id: 'contact_secret_1', phone: '090-0000-0000' }],
          },
          care_team_links: [{ role: 'care_manager' }],
        },
      },
    ]);
    firstVisitDocumentFindManyMock.mockResolvedValue([
      {
        case_id: 'case_1',
        delivered_at: null,
        created_at: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);
    managementPlanFindManyMock.mockResolvedValue([
      {
        case_id: 'case_1',
        next_review_date: new Date('2026-06-01T00:00:00.000Z'),
        effective_from: null,
        version: 1,
        approved_at: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);
    billingEvidenceFindManyMock.mockResolvedValue([
      {
        id: 'billing_secret_1',
        visit_record_id: 'visit_record_secret_1',
        cycle_id: 'cycle_1',
        claimable: false,
        exclusion_reason: '患者Aの算定根拠自由記述',
        same_month_exclusion_flags: {
          missing_visit_consent: true,
          report_delivery_incomplete: true,
        },
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();
    const visit = json.data.staff[0].visits[0];

    expect(visit.preparation_summary).toMatchObject({
      completed_count: 5,
      total_count: 5,
      status: 'ready',
      incomplete_labels: [],
      ready_blocker_summary: {
        blocked: true,
        blocker_count: 6,
        category_labels: ['導入準備 4件', '算定確認 2件'],
        preparation_blocker_count: 0,
        onboarding_blocker_count: 4,
        billing_blocker_count: 2,
      },
    });
    const responseText = JSON.stringify(json.data);
    expect(responseText).not.toContain('090-0000-0000');
    expect(responseText).not.toContain('visit_record_secret_1');
    expect(responseText).not.toContain('billing_secret_1');
    expect(responseText).not.toContain('患者Aの算定根拠自由記述');
  });

  it('counts untimed vehicle assignments when computing remaining capacity', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        priority: 'normal',
        site_id: 'site_1',
        route_order: null,
        vehicle_resource_id: 'vehicle_1',
        vehicle_resource: { id: 'vehicle_1', label: '軽バン1号', travel_mode: 'DRIVE' },
        time_window_start: null,
        time_window_end: null,
        confirmed_at: null,
        facility_batch_id: null,
        facility_batch: null,
        case_: { patient: { name: '伊藤 キヨ' } },
      },
      {
        id: 'visit_2',
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        priority: 'normal',
        site_id: 'site_1',
        route_order: null,
        vehicle_resource_id: null,
        vehicle_resource: null,
        time_window_start: new Date(2026, 5, 12, 11, 0),
        time_window_end: new Date(2026, 5, 12, 11, 30),
        confirmed_at: null,
        facility_batch_id: null,
        facility_batch: null,
        case_: { patient: { name: '田中 一郎' } },
      },
    ]);
    visitVehicleResourceFindManyMock.mockResolvedValue([
      {
        id: 'vehicle_1',
        label: '軽バン1号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'DRIVE',
        max_stops: 1,
        available: true,
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.vehicle_resources).toEqual([
      expect.objectContaining({
        id: 'vehicle_1',
        assigned_visit_count: 1,
        remaining_stops: 0,
        recommended: false,
        recommendation_reason: '本日の上限に到達',
      }),
    ]);
  });

  it('surfaces vehicle route duration over-limit status for assigned vehicles', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_far_1',
        case_id: 'case_1',
        cycle_id: null,
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
        carry_items_status: null,
        priority: 'normal',
        site_id: 'site_1',
        route_order: 1,
        vehicle_resource_id: 'vehicle_1',
        vehicle_resource: { id: 'vehicle_1', label: '軽バン1号', travel_mode: 'DRIVE' },
        time_window_start: new Date(2026, 5, 12, 10, 0),
        time_window_end: new Date(2026, 5, 12, 10, 30),
        confirmed_at: null,
        cycle: null,
        preparation: null,
        facility_batch_id: null,
        facility_batch: null,
        visit_record: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '遠方 患者',
            contacts: [],
            residences: [{ address: '遠方宅', lat: 36.5, lng: 140.5 }],
          },
          care_team_links: [],
        },
      },
    ]);
    visitVehicleResourceFindManyMock.mockResolvedValue([
      {
        id: 'vehicle_1',
        label: '軽バン1号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'DRIVE',
        max_stops: 8,
        max_route_duration_minutes: 30,
        available: true,
        site: { address: '拠点薬局', lat: 35.6812, lng: 139.7671 },
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();
    const vehicle = json.data.vehicle_resources[0];

    expect(vehicle).toMatchObject({
      id: 'vehicle_1',
      max_route_duration_minutes: 30,
      route_duration_status: 'exceeded',
      route_duration_label: expect.stringContaining('超過'),
      recommended: false,
      recommendation_reason: '稼働上限を超過',
    });
    expect(vehicle.route_duration_minutes).toBeGreaterThan(30);
  });

  it('recommends vehicles only for unassigned visits in the same site', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_site_1',
        pharmacist_id: 'user_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        priority: 'normal',
        site_id: 'site_1',
        route_order: null,
        vehicle_resource_id: null,
        vehicle_resource: null,
        time_window_start: new Date(2026, 5, 12, 11, 0),
        time_window_end: new Date(2026, 5, 12, 11, 30),
        confirmed_at: null,
        facility_batch_id: null,
        facility_batch: null,
        case_: { patient: { name: '田中 一郎' } },
      },
    ]);
    visitVehicleResourceFindManyMock.mockResolvedValue([
      {
        id: 'vehicle_site_2',
        label: '別拠点車両',
        site_id: 'site_2',
        vehicle_code: 'VEH-DEMO-002',
        travel_mode: 'DRIVE',
        max_stops: 8,
        available: true,
      },
      {
        id: 'vehicle_site_1',
        label: '同一拠点車両',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'DRIVE',
        max_stops: 1,
        available: true,
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.vehicle_resources).toEqual([
      expect.objectContaining({
        id: 'vehicle_site_2',
        recommended: false,
        recommendation_reason: '空き 8件',
      }),
      expect.objectContaining({
        id: 'vehicle_site_1',
        recommended: true,
        recommendation_reason: '同一拠点の未割当 1件を受けられます',
      }),
    ]);
  });
});
