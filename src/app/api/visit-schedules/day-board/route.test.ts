import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  membershipFindManyMock,
  visitScheduleFindManyMock,
  dispenseTaskGroupByMock,
  taskGroupByMock,
  taskFindManyMock,
  medicationCycleCountMock,
  proposalFindManyMock,
  facilityFindManyMock,
  contactLogFindManyMock,
  pharmacistShiftFindManyMock,
  visitVehicleResourceFindManyMock,
  consentRecordFindManyMock,
  firstVisitDocumentFindManyMock,
  managementPlanFindManyMock,
  billingEvidenceFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  membershipFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  dispenseTaskGroupByMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  contactLogFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
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
    task: { groupBy: taskGroupByMock, findMany: taskFindManyMock },
    medicationCycle: { count: medicationCycleCountMock },
    visitScheduleProposal: { findMany: proposalFindManyMock },
    facility: { findMany: facilityFindManyMock },
    visitScheduleContactLog: { findMany: contactLogFindManyMock },
    pharmacistShift: { findMany: pharmacistShiftFindManyMock },
    visitVehicleResource: { findMany: visitVehicleResourceFindManyMock },
    consentRecord: { findMany: consentRecordFindManyMock },
    firstVisitDocument: { findMany: firstVisitDocumentFindManyMock },
    managementPlan: { findMany: managementPlanFindManyMock },
    billingEvidence: { findMany: billingEvidenceFindManyMock },
  },
}));

import { GET } from './route';

function createRequest(date?: string) {
  const url = new URL('http://localhost/api/visit-schedules/day-board');
  if (date) url.searchParams.set('date', date);
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

describe('/api/visit-schedules/day-board', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // ローカル(JST 想定)の朝。@db.Date 境界バグはこの時間帯で前日落ちしていた
    vi.setSystemTime(new Date(2026, 5, 12, 9, 0));
    vi.clearAllMocks();
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    dispenseTaskGroupByMock.mockResolvedValue([]);
    taskGroupByMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    medicationCycleCountMock.mockResolvedValue(0);
    proposalFindManyMock.mockResolvedValue([]);
    facilityFindManyMock.mockResolvedValue([]);
    contactLogFindManyMock.mockResolvedValue([]);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    visitVehicleResourceFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);
    billingEvidenceFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries scheduled_date with the UTC-midnight range for the local date key', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.where;
    const select = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.select;
    // ローカル 2026-06-12 → UTC midnight 範囲。ローカル深夜(6/11T15:00Z)を渡すと
    // Prisma の @db.Date 切り捨てで前日扱いになり、当日訪問が全件こぼれる(回帰防止)
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
    expect(select).toMatchObject({
      cycle: { select: { overall_status: true } },
      carry_items_status: true,
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
        select: expect.not.objectContaining({ metadata: true }),
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
    ]);
    expect(JSON.stringify(json.data)).not.toContain('090-0000-0000');
    expect(JSON.stringify(json.data)).not.toContain('自由記載は出さない');
  });

  it('drops members who are shift-unavailable for the day', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
      { role: 'clerk', user: { id: 'user_4', name: '田中 真' } },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([{ user_id: 'user_4' }]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.staff.map((member: { id: string }) => member.id)).toEqual(['user_1']);
    const shiftWhere = pharmacistShiftFindManyMock.mock.calls.at(0)?.[0]?.where;
    expect(shiftWhere?.available).toBe(false);
    expect(shiftWhere?.date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
  });

  it('compares proposal impact ranges with the stored UTC date values', async () => {
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
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    const impactWhere = visitScheduleFindManyMock.mock.calls.at(1)?.[0]?.where;
    expect(impactWhere?.OR?.[0]?.scheduled_date).toEqual({
      gte: new Date('2026-06-13T00:00:00.000Z'),
      lt: new Date('2026-06-14T00:00:00.000Z'),
    });

    const proposal = json.data.pending_proposals[0];
    // 同日訪問 1 件(60分 + 移動30分)が余白試算に乗る = UTC 日付キー同士の一致が機能
    expect(proposal.idle_before_minutes).toBe(480 - 90);
    expect(proposal.proposed_date).toBe('2026-06-13');
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
        available: true,
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
