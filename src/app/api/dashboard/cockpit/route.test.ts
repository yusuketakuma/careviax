import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  medicationCycleGroupByMock,
  medicationCycleFindManyMock,
  dispenseTaskFindManyMock,
  setPlanFindManyMock,
  visitRecordFindManyMock,
  careReportFindManyMock,
  careReportCountMock,
  taskCommentFindManyMock,
  userFindManyMock,
  queryRawMock,
  medicationStockQueryRawMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  workflowExceptionFindManyMock,
  taskFindManyMock,
  taskCountMock,
  careCaseFindManyMock,
  membershipFindManyMock,
  pharmacistShiftFindManyMock,
  inboundCommunicationEventFindManyMock,
  inboundCommunicationEventCountMock,
  inboundCommunicationSignalFindManyMock,
  inboundCommunicationSignalCountMock,
  visitScheduleContactLogFindManyMock,
  visitScheduleContactLogCountMock,
  deliveryRecordFindManyMock,
  deliveryRecordCountMock,
  patientFindManyMock,
  serverCacheGetMock,
  serverCacheSetMock,
  withOrgContextMock,
  billingCandidateFindManyMock,
  billingCandidateCountMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  medicationCycleGroupByMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCountMock: vi.fn(),
  taskCommentFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  medicationStockQueryRawMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  inboundCommunicationEventFindManyMock: vi.fn(),
  inboundCommunicationEventCountMock: vi.fn(),
  inboundCommunicationSignalFindManyMock: vi.fn(),
  inboundCommunicationSignalCountMock: vi.fn(),
  visitScheduleContactLogFindManyMock: vi.fn(),
  visitScheduleContactLogCountMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  deliveryRecordCountMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  serverCacheGetMock: vi.fn(),
  serverCacheSetMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingCandidateCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { groupBy: medicationCycleGroupByMock, findMany: medicationCycleFindManyMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    setPlan: { findMany: setPlanFindManyMock },
    visitRecord: { findMany: visitRecordFindManyMock },
    careReport: { findMany: careReportFindManyMock, count: careReportCountMock },
    taskComment: { findMany: taskCommentFindManyMock },
    user: { findMany: userFindManyMock },
    $queryRaw: queryRawMock,
    visitSchedule: { findMany: visitScheduleFindManyMock, count: visitScheduleCountMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
    task: { findMany: taskFindManyMock, count: taskCountMock },
    careCase: { findMany: careCaseFindManyMock },
    membership: { findMany: membershipFindManyMock },
    pharmacistShift: { findMany: pharmacistShiftFindManyMock },
    inboundCommunicationEvent: {
      findMany: inboundCommunicationEventFindManyMock,
      count: inboundCommunicationEventCountMock,
    },
    inboundCommunicationSignal: {
      findMany: inboundCommunicationSignalFindManyMock,
      count: inboundCommunicationSignalCountMock,
    },
    visitScheduleContactLog: {
      findMany: visitScheduleContactLogFindManyMock,
      count: visitScheduleContactLogCountMock,
    },
    deliveryRecord: {
      findMany: deliveryRecordFindManyMock,
      count: deliveryRecordCountMock,
    },
    patient: { findMany: patientFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/utils/server-cache', () => ({
  serverCache: {
    get: serverCacheGetMock,
    set: serverCacheSetMock,
  },
}));

import { GET } from './route';
import { GET as GETDetails } from './details/route';
import { GET as GETSummary } from './summary/route';
import { GET as GETTeam } from './team/route';
import { GET as GETComments } from './comments/route';
import { GET as GETInbound } from './inbound/route';
import { GET as GETReportBilling } from './report-billing/route';
import { GET as GETStockRisks } from './stock-risks/route';

function createRequest(search = '', path = '/api/dashboard/cockpit') {
  return new NextRequest(`http://localhost${path}${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectMeasuredJsonContentLength(response: Response, body: unknown) {
  expect(response.headers.get('content-length')).toBe(
    String(new TextEncoder().encode(JSON.stringify(body)).length),
  );
}

function buildAuditTask(args: {
  id: string;
  priority?: string;
  dueDate?: Date | null;
  audits?: Array<{ result: string }>;
  patientName?: string;
  lineTags?: string[];
  packagingInstructions?: string | null;
}) {
  return {
    id: args.id,
    priority: args.priority ?? 'normal',
    due_date: args.dueDate ?? null,
    updated_at: new Date('2026-06-12T08:00:00'),
    audits: args.audits ?? [],
    cycle: {
      id: `cycle_${args.id}`,
      case_: { patient: { name: args.patientName ?? '患者A' } },
      prescription_intakes: [
        {
          id: `intake_${args.id}`,
          prescribed_date: new Date('2026-06-01T00:00:00'),
          lines: [
            {
              packaging_instruction_tags: args.lineTags ?? [],
              packaging_instructions: args.packagingInstructions ?? null,
              notes: null,
              dispensing_method: null,
            },
          ],
        },
      ],
    },
  };
}

describe('/api/dashboard/cockpit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 42));
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContextMock });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    serverCacheGetMock.mockReturnValue(undefined);
    authContextMock.role = 'admin';
    medicationCycleGroupByMock.mockResolvedValue([
      { overall_status: 'dispensed', _count: { id: 10 } },
      { overall_status: 'audit_pending', _count: { id: 14 } },
      { overall_status: 'visit_completed', _count: { id: 2 } },
    ]);
    queryRawMock.mockResolvedValue([
      {
        task_id: 'task_plain',
        count: BigInt(2),
        total_count: BigInt(2),
        narcotic_count: BigInt(1),
        earliest_due_at: new Date(2026, 5, 12, 11, 0),
      },
      {
        task_id: 'task_narcotic',
        total_count: BigInt(2),
      },
    ]);
    dispenseTaskFindManyMock.mockResolvedValue([
      buildAuditTask({
        id: 'task_plain',
        priority: 'urgent',
        dueDate: new Date(2026, 5, 12, 11, 0),
        patientName: '佐々木 ハル',
      }),
      buildAuditTask({
        id: 'task_narcotic',
        priority: 'normal',
        dueDate: new Date(2026, 5, 12, 12, 0),
        patientName: '田中 一郎',
        lineTags: ['narcotic'],
        packagingInstructions: '冷所保管',
      }),
      buildAuditTask({
        id: 'task_done',
        audits: [{ result: 'approved' }],
      }),
    ]);
    visitScheduleFindManyMock.mockImplementation((args?: { select?: Record<string, unknown> }) => {
      if (args?.select?.preparation) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'visit_1',
          visit_type: 'regular',
          schedule_status: 'planned',
          // @db.Time は壁時計を UTC parts に格納する(Date.UTC で表現)。
          time_window_start: new Date(Date.UTC(2026, 5, 12, 10, 30)),
          time_window_end: new Date(Date.UTC(2026, 5, 12, 11, 30)),
          facility_batch_id: null,
          case_: { patient: { name: '伊藤' } },
        },
      ]);
    });
    visitScheduleCountMock.mockResolvedValue(0);
    workflowExceptionFindManyMock.mockResolvedValue([
      {
        id: 'exception_1',
        exception_type: 'missing_visit_consent',
        description: 'ご家族の同意待ち(新規契約)',
        severity: 'critical',
        created_at: new Date(2026, 5, 11, 9, 42),
      },
      {
        id: 'exception_2',
        exception_type: 'unknown_type',
        description: '送付先の確認(やまもと内科)',
        severity: 'warning',
        created_at: new Date(2026, 5, 12, 9, 12),
      },
    ]);
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(2);
    careCaseFindManyMock.mockResolvedValue([]);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist', user: { name: '山田 太郎' } },
      { user_id: 'user_2', role: 'clerk', user: { name: '鈴木 さくら' } },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    medicationCycleFindManyMock.mockResolvedValue([]);
    setPlanFindManyMock.mockResolvedValue([]);
    visitRecordFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    careReportCountMock.mockResolvedValue(0);
    taskCommentFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    inboundCommunicationEventFindManyMock.mockResolvedValue([]);
    inboundCommunicationEventCountMock.mockResolvedValue(0);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([]);
    inboundCommunicationSignalCountMock.mockResolvedValue(0);
    medicationStockQueryRawMock.mockResolvedValue([]);
    visitScheduleContactLogFindManyMock.mockResolvedValue([]);
    visitScheduleContactLogCountMock.mockResolvedValue(0);
    deliveryRecordFindManyMock.mockResolvedValue([]);
    deliveryRecordCountMock.mockResolvedValue(0);
    patientFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          findMany: careReportFindManyMock,
          count: careReportCountMock,
        },
        deliveryRecord: {
          findMany: deliveryRecordFindManyMock,
          count: deliveryRecordCountMock,
        },
        inboundCommunicationSignal: {
          findMany: inboundCommunicationSignalFindManyMock,
          count: inboundCommunicationSignalCountMock,
        },
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
          count: visitScheduleCountMock,
        },
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
          count: billingCandidateCountMock,
        },
        patient: { findMany: patientFindManyMock },
        $queryRaw: medicationStockQueryRawMock,
      }),
    );
    billingCandidateFindManyMock.mockResolvedValue([]);
    billingCandidateCountMock.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cockpit aggregate with narcotics-first audit queue', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      authContextMock,
      expect.any(Function),
    );
    const json = await response.json();

    expect(json.data.cycle_status_counts).toEqual({
      dispensed: 10,
      audit_pending: 14,
      visit_completed: 2,
    });

    // チームの余白: 薬剤師 → 事務の順、シフト未登録は 9:00-18:00 勤務扱い(now=9:42)
    expect(json.data.team_capacity).toEqual([
      expect.objectContaining({ user_id: 'user_1', role_label: '薬', status: 'working' }),
      expect.objectContaining({ user_id: 'user_2', role_label: '事務', status: 'working' }),
    ]);

    // 監査済み(approved)タスクは除外され、麻薬を含むタスクが先頭に並ぶ
    expect(json.data.audit_pending_count).toBe(2);
    expect(json.data.audit_queue_total_count).toBe(2);
    expect(json.data.audit_queue_visible_count).toBe(2);
    expect(json.data.audit_queue_hidden_count).toBe(0);
    expect(json.data.narcotic_audit_count).toBe(1);
    expect(json.data.audit_queue.map((item: { task_id: string }) => item.task_id)).toEqual([
      'task_narcotic',
      'task_plain',
    ]);
    const auditQuery = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0];
    expect(auditQuery?.where?.id).toEqual({ in: ['task_plain', 'task_narcotic'] });
    expect(json.data.audit_queue[0]).toMatchObject({
      patient_name: '田中 一郎',
      has_narcotic: true,
      handling_tags: ['narcotic', 'cold_storage'],
      intake_id: 'intake_task_narcotic',
      prescribed_date: '2026-06-01',
    });

    expect(json.data.today_visits).toEqual([
      {
        id: 'visit_1',
        patient_name: '伊藤',
        visit_type: 'regular',
        schedule_status: 'planned',
        // 壁時計 "HH:MM" でシリアライズ(TZ 非依存; client は再パースしない)。
        time_start: '10:30',
        time_end: '11:30',
        facility_batch_id: null,
      },
    ]);

    expect(json.data.blocked_reasons).toEqual([
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'critical',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/patients',
      },
      {
        id: 'exception_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/workflow',
      },
    ]);

    expect(json.data.carryover_count).toBe(2);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:admin:user_1:2026-06-12:team'),
      expect.objectContaining({
        audit_pending_count: 2,
        audit_queue_total_count: 2,
        audit_queue_visible_count: 2,
        audit_queue_hidden_count: 0,
      }),
      15_000,
    );
  });

  it('keeps the visible audit queue capped while reporting the exact total count', async () => {
    queryRawMock.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, index) => ({
        task_id: `task_${index}`,
        total_count: BigInt(37),
      })),
    );
    dispenseTaskFindManyMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) =>
        buildAuditTask({
          id: `task_${index}`,
          priority: index === 0 ? 'emergency' : 'normal',
          dueDate: new Date(2026, 5, 12, 10, index),
          patientName: `患者${index}`,
        }),
      ),
    );

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.audit_pending_count).toBe(37);
    expect(json.data.audit_queue_total_count).toBe(37);
    expect(json.data.audit_queue_visible_count).toBe(5);
    expect(json.data.audit_queue_hidden_count).toBe(32);
    expect(json.data.audit_queue).toHaveLength(5);

    const auditQuery = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0];
    expect(auditQuery?.take).toBe(30);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it('serves a cached cockpit response without rerunning aggregate queries', async () => {
    serverCacheGetMock.mockReturnValueOnce({
      generated_at: '2026-06-12T00:00:00.000Z',
      scope: { requested: 'team', applied: 'team', can_view_team: true },
      cycle_status_counts: { audit_pending: 1 },
      audit_pending_count: 1,
      narcotic_audit_count: 0,
      audit_queue: [],
      today_visits: [],
      blocked_reasons: [],
      carryover_count: 0,
      team_capacity: [],
    });

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { cycle_status_counts: { audit_pending: 1 } },
    });
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
  });

  it('returns a PHI-minimized summary segment without details or team reads', async () => {
    const response = (await GETSummary(createRequest('', '/api/dashboard/cockpit/summary'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    const json = await response.json();
    expectMeasuredJsonContentLength(response, json);

    expect(json.data).toMatchObject({
      audit_pending_count: 2,
      audit_queue_total_count: 2,
      narcotic_audit_count: 1,
      earliest_audit_due_at: new Date(2026, 5, 12, 11, 0).toISOString(),
      today_visit_count: 1,
      today_visit_times: ['10:30'],
    });
    expect(json.data.audit_queue).toBeUndefined();
    expect(json.data.today_visits).toBeUndefined();
    expect(json.data.blocked_reasons).toBeUndefined();
    expect(json.data.team_capacity).toBeUndefined();

    const body = JSON.stringify(json);
    expect(body).not.toContain('田中 一郎');
    expect(body).not.toContain('佐々木 ハル');
    expect(body).not.toContain('伊藤');
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { time_window_start: true },
      }),
    );
    expect(visitScheduleFindManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ case_: expect.anything() }),
      }),
    );
    expect(workflowExceptionFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:admin:user_1:2026-06-12:team:summary'),
      expect.objectContaining({ today_visit_count: 1 }),
      15_000,
    );
  });

  it('returns the details segment without cycle count or team capacity reads', async () => {
    inboundCommunicationEventCountMock.mockResolvedValue(1);
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_urgent',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_channel: 'mcs',
        sender_name: '山田 花子',
        sender_role: 'nurse',
        sender_organization_name: '訪問看護ステーションA',
        sender_contact: '090-0000-0000',
        event_type: 'medication_stock_report',
        received_at: new Date('2026-06-12T00:20:00.000Z'),
        occurred_at: new Date('2026-06-12T00:10:00.000Z'),
        raw_text: '湿布は残り4枚です。',
        normalized_summary: '湿布残数4枚の報告',
        attachment_count: 0,
        has_medication_stock_signal: true,
        has_patient_safety_signal: true,
        has_schedule_signal: false,
        has_report_signal: false,
        processing_status: 'signals_extracted',
      },
    ]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_urgent',
        inbound_event_id: 'event_urgent',
        signal_domain: 'medication_stock',
        signal_type: 'observed_quantity',
        extracted_text: '湿布は残り4枚',
        extracted_medication_name: '湿布',
        extracted_quantity: 4,
        extracted_unit: 'sheet',
        review_status: 'needs_review',
        action_status: 'not_linked',
        source_confidence: 'text_parsed_high',
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '田中 一郎' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.audit_queue.map((item: { task_id: string }) => item.task_id)).toEqual([
      'task_narcotic',
      'task_plain',
    ]);
    expect(json.data.today_visits).toEqual([
      expect.objectContaining({ id: 'visit_1', patient_name: '伊藤' }),
    ]);
    expect(json.data.blocked_reasons).toHaveLength(2);
    expect(json.data.carryover_count).toBe(2);
    expect(json.data.urgent_total_count).toBe(5);
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'audit:task_narcotic',
      'task:exception_1',
      'inbound:event_urgent',
      'audit:task_plain',
      'task:exception_2',
    ]);
    expect(json.data.urgent_source_links).toEqual([
      {
        source: 'audit',
        label: '監査待ち',
        total_count: 2,
        visible_count: 2,
        hidden_count: 0,
        href: '/audit?filter=dashboard_urgent',
      },
      {
        source: 'inbound',
        label: '他職種受信',
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        href: '/communications/inbound?status=needs_review',
      },
      {
        source: 'task',
        label: 'タスク',
        total_count: 2,
        visible_count: 2,
        hidden_count: 0,
        href: '/tasks?status=&context=dashboard_home',
      },
    ]);
    expect(
      json.data.urgent_source_links.every(
        (link: { href: string }) => link.href.startsWith('/') && !link.href.startsWith('//'),
      ),
    ).toBe(true);
    expect(json.data.urgent_items[1]).toMatchObject({
      source: 'task',
      source_label: '止まっている理由',
      reference_label: '患者',
      title: 'ご家族の同意待ち(新規契約)',
      summary: '患者: ご家族の同意待ち(新規契約)',
      action_href: '/patients',
      action_label: '再連絡する',
    });
    expect(json.data.urgent_items[2]).toMatchObject({
      source: 'inbound',
      source_label: 'MCS',
      patient_name: '田中 一郎',
      title: 'MCS受信: 安全確認が必要',
      summary: '湿布 / 4sheet / 湿布は残り4枚',
      action_href: '/patients/patient_1#inbound-communications',
    });
    expect(json.data.cycle_status_counts).toBeUndefined();
    expect(json.data.team_capacity).toBeUndefined();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:admin:user_1:2026-06-12:team:details'),
      expect.objectContaining({ carryover_count: 2 }),
      15_000,
    );
  });

  it('adds generic operational tasks to the unified urgent queue without duplicating inbound task sources', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'op_task_1',
        display_id: 'TASK-001',
        task_type: 'patient_self_report_followup',
        title: '患者自己申告の確認',
        description: '疼痛増悪の自己申告を確認する',
        status: 'pending',
        priority: 'urgent',
        assigned_to: 'user_1',
        due_date: new Date('2026-06-12T01:30:00.000Z'),
        sla_due_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_task',
        created_at: new Date('2026-06-12T00:05:00.000Z'),
        updated_at: new Date('2026-06-12T00:10:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_task', name: '患者 タスク' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    const taskItem = json.data.urgent_items.find(
      (item: { id: string }) => item.id === 'task:op_task_1',
    );
    expect(taskItem).toMatchObject({
      source: 'task',
      source_id: 'op_task_1',
      patient_id: 'patient_task',
      patient_name: '患者 タスク',
      title: '患者自己申告の確認',
      summary: '疼痛増悪の自己申告を確認する',
      due_at: new Date('2026-06-12T01:30:00.000Z').toISOString(),
      waiting_since: new Date('2026-06-12T00:05:00.000Z').toISOString(),
      action_href: '/patients/patient_task/collaboration',
      action_label: '自己申告を確認',
    });
    expect(taskItem.badges).toEqual(
      expect.arrayContaining([
        { label: '緊急', tone: 'danger' },
        { label: '未着手', tone: 'neutral' },
      ]),
    );
    expect(json.data.urgent_total_count).toBe(5);

    const taskQuery = taskFindManyMock.mock.calls.at(-1)?.[0];
    expect(taskQuery?.where).toMatchObject({
      org_id: 'org_1',
      status: { in: ['pending', 'in_progress'] },
      task_type: {
        notIn: expect.arrayContaining([
          'core.inbound_communication_review_required',
          'pharmacy.inbound_medication_stock_signal_review_required',
          'pharmacy.inbound_low_stock_unquantified_report',
          'pharmacy.inbound_medication_safety_review_required',
          'pharmacy.inbound_schedule_request_review_required',
        ]),
      },
    });
    expect(taskQuery?.take).toBe(13);
    // Generic task source avoids an exact count query unless the limit+1 sentinel overflows.
    expect(taskCountMock).toHaveBeenCalledTimes(1);
  });

  it('adds overdue callback follow-ups to the unified urgent queue', async () => {
    visitScheduleContactLogCountMock.mockResolvedValue(1);
    visitScheduleContactLogFindManyMock.mockResolvedValue([
      {
        id: 'callback_1',
        patient_id: 'patient_callback',
        schedule_id: 'schedule_callback',
        outcome: 'attempted',
        contact_name: '長女',
        note: '訪問時間の再調整で折返し',
        callback_due_at: new Date(2026, 5, 12, 9, 30),
        called_at: new Date(2026, 5, 12, 9, 0),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_callback', name: '折返 花子' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.urgent_total_count).toBe(5);
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'audit:task_narcotic',
      'task:exception_1',
      'callback:callback_1',
      'audit:task_plain',
      'task:exception_2',
    ]);
    expect(json.data.urgent_items[2]).toMatchObject({
      source: 'callback',
      source_label: '折返し',
      reference_label: '未接続',
      severity: 'urgent',
      patient_id: 'patient_callback',
      patient_name: '折返 花子',
      title: '患者連絡の折返し期限超過',
      summary: '訪問時間の再調整で折返し',
      due_at: new Date(2026, 5, 12, 9, 30).toISOString(),
      waiting_since: new Date(2026, 5, 12, 9, 0).toISOString(),
      action_href: '/schedules?focus=schedule&schedule_id=schedule_callback',
      action_label: '折返しを確認',
    });
    expect(visitScheduleContactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 12,
        where: expect.objectContaining({
          org_id: 'org_1',
        }),
      }),
    );
  });

  it('uses role focus priority for warning urgent items without demoting blocking work', async () => {
    authContextMock.role = 'clerk';
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { ...authContextMock, role: 'clerk' },
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    dispenseTaskFindManyMock.mockResolvedValue([
      buildAuditTask({
        id: 'task_plain',
        priority: 'normal',
        dueDate: new Date(2026, 5, 12, 11, 0),
        patientName: '佐々木 ハル',
      }),
      buildAuditTask({
        id: 'task_narcotic',
        priority: 'normal',
        dueDate: new Date(2026, 5, 12, 12, 0),
        patientName: '田中 一郎',
        lineTags: ['narcotic'],
        packagingInstructions: '冷所保管',
      }),
    ]);
    visitScheduleContactLogCountMock.mockResolvedValue(1);
    visitScheduleContactLogFindManyMock.mockResolvedValue([
      {
        id: 'callback_late',
        patient_id: 'patient_callback',
        schedule_id: 'schedule_callback',
        outcome: 'attempted',
        contact_name: '長女',
        note: '午後の折返し',
        callback_due_at: new Date(2026, 5, 12, 11, 0),
        called_at: new Date('2026-06-12T08:00:00'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_callback', name: '折返 花子' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toMatchObject({ applied: 'mine', can_view_team: false });
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'audit:task_narcotic',
      'task:exception_1',
      'callback:callback_late',
      'audit:task_plain',
      'task:exception_2',
    ]);
    expect(json.data.urgent_items[2]).toMatchObject({
      source: 'callback',
      severity: 'warning',
      due_at: new Date(2026, 5, 12, 11, 0).toISOString(),
    });
    expect(json.data.urgent_items[3]).toMatchObject({
      source: 'audit',
      severity: 'warning',
      due_at: new Date(2026, 5, 12, 11, 0).toISOString(),
    });
  });

  it('adds reviewed medication stock apply waits to the unified urgent queue', async () => {
    inboundCommunicationSignalCountMock.mockResolvedValue(1);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_stock_apply',
        patient_id: 'patient_stock',
        case_id: 'case_stock',
        inbound_event_id: 'event_stock',
        signal_type: 'out_of_stock_text',
        extracted_text: '湿布がなくなりました',
        extracted_medication_name: '湿布A',
        extracted_quantity: null,
        extracted_unit: null,
        source_confidence: 'manual',
        review_status: 'accepted',
        action_status: 'not_linked',
        created_at: new Date(2026, 5, 12, 8, 50),
        updated_at: new Date(2026, 5, 12, 9, 5),
        inbound_event: {
          id: 'event_stock',
          patient_id: 'patient_stock',
          case_id: 'case_stock',
          source_channel: 'mcs',
          sender_role: 'nurse',
          normalized_summary: '湿布不足の報告',
          received_at: new Date(2026, 5, 12, 8, 45),
          raw_text: '訪問看護師 山田 090-9999-9999 湿布Aがなくなりました',
          sender_contact: '090-9999-9999',
          external_url: 'https://example.invalid/secret',
          attachments: [{ storage_key: 'private/storage/key' }],
        },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_stock', name: '残数 太郎' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.urgent_total_count).toBe(5);
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'audit:task_narcotic',
      'task:exception_1',
      'medication_stock:signal_stock_apply',
      'audit:task_plain',
      'task:exception_2',
    ]);
    expect(json.data.urgent_items[2]).toMatchObject({
      source: 'medication_stock',
      source_id: 'signal_stock_apply',
      source_label: '残数管理',
      reference_label: 'MCS',
      severity: 'urgent',
      patient_id: 'patient_stock',
      patient_name: '残数 太郎',
      title: '外用薬・頓服薬の不足報告',
      summary: '湿布A: 湿布がなくなりました',
      due_at: new Date(2026, 5, 12, 8, 45).toISOString(),
      waiting_since: new Date(2026, 5, 12, 8, 45).toISOString(),
      action_href: '/patients/patient_stock#medication-stock-events',
      action_label: '残数報告を確認',
    });

    const responseBody = JSON.stringify(json.data.urgent_items);
    expect(responseBody).not.toContain('sender_contact');
    expect(responseBody).not.toContain('090-9999-9999');
    expect(responseBody).not.toContain('external_url');
    expect(responseBody).not.toContain('storage_key');
    expect(responseBody).not.toContain('private/storage/key');

    expect(inboundCommunicationSignalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              org_id: 'org_1',
              signal_domain: 'medication_stock',
            }),
            { review_status: { in: ['accepted', 'auto_accepted'] } },
            { action_status: { in: ['not_linked', 'linked_to_task'] } },
          ],
        },
        take: 40,
      }),
    );
  });

  it('adds failed report deliveries to the unified urgent queue', async () => {
    deliveryRecordCountMock.mockResolvedValue(1);
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        id: 'delivery_failed',
        channel: 'fax',
        recipient_name: 'やまもと内科',
        failure_reason: 'FAX送信エラー',
        retry_count: 1,
        updated_at: new Date(2026, 5, 12, 9, 20),
        report: {
          id: 'report_failed',
          patient_id: 'patient_report',
          report_type: 'physician_report',
        },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_report', name: '報告 太郎' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.urgent_total_count).toBe(5);
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'report_delivery:delivery_failed',
      'audit:task_narcotic',
      'task:exception_1',
      'audit:task_plain',
      'task:exception_2',
    ]);
    expect(json.data.urgent_items[0]).toMatchObject({
      source: 'report',
      source_label: '報告書送付',
      reference_label: 'FAX',
      severity: 'blocking',
      patient_id: 'patient_report',
      patient_name: '報告 太郎',
      title: '報告書の送付失敗',
      summary: 'やまもと内科 / FAX / 理由: FAX送信エラー',
      due_at: new Date(2026, 5, 12, 9, 20).toISOString(),
      action_href: '/reports/report_failed?action=resend&delivery_id=delivery_failed',
      action_label: '宛先確認・再送',
    });
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 12,
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'failed',
        }),
      }),
    );
  });

  it('adds current-month billing candidates to the unified urgent queue without leaking raw evidence', async () => {
    billingCandidateCountMock.mockResolvedValue(1);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_blocked',
        patient_id: 'patient_billing',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT',
        billing_name: '在宅患者訪問薬剤管理指導料',
        updated_at: new Date(2026, 5, 12, 9, 10),
        source_snapshot: {
          validation_layers: {
            close_review: { message: '鈴木次郎様 090-1111-2222 個別事情' },
          },
        },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_billing', name: '算定 花子' }]);

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.urgent_total_count).toBe(5);
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'audit:task_narcotic',
      'task:exception_1',
      'audit:task_plain',
      'billing:candidate_blocked',
      'task:exception_2',
    ]);
    expect(json.data.urgent_items[3]).toMatchObject({
      source: 'billing',
      source_label: '算定候補',
      reference_label: '2026-06 / MED_HOME_VISIT',
      severity: 'warning',
      patient_id: 'patient_billing',
      patient_name: '算定 花子',
      title: '算定候補の確認待ち',
      summary:
        '在宅患者訪問薬剤管理指導料 の算定候補が未確認です。請求候補画面で根拠を確認してください。',
      due_at: null,
      waiting_since: new Date(2026, 5, 12, 9, 10).toISOString(),
      action_href:
        '/billing/candidates?billing_month=2026-06-01&status=candidate&candidate_id=candidate_blocked&patient_id=patient_billing',
      action_label: '算定候補へ',
    });

    const responseBody = JSON.stringify(json.data.urgent_items);
    expect(responseBody).not.toContain('source_snapshot');
    expect(responseBody).not.toContain('validation_layers');
    expect(responseBody).not.toContain('090-1111-2222');
    expect(responseBody).not.toContain('個別事情');

    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContextMock,
      maxWaitMs: 2000,
      timeoutMs: 3000,
    });
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        billing_domain: 'home_care',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        status: 'candidate',
      },
      orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
      take: 12,
      select: {
        id: true,
        patient_id: true,
        billing_month: true,
        billing_code: true,
        billing_name: true,
        updated_at: true,
      },
    });
    expect(billingCandidateCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        billing_domain: 'home_care',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        status: 'candidate',
      },
    });
  });

  it('adds incomplete visit preparation work to the unified urgent queue without leaking raw preparation evidence', async () => {
    visitScheduleCountMock.mockResolvedValue(1);
    visitScheduleFindManyMock.mockImplementation(
      (args?: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => {
        if (args?.select?.preparation) {
          return Promise.resolve([
            {
              id: 'visit_prep_blocked',
              display_id: 'VP-001',
              visit_type: 'regular',
              priority: 'normal',
              schedule_status: 'planned',
              scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
              time_window_start: new Date(Date.UTC(2026, 5, 12, 10, 0)),
              carry_items_status: 'blocked',
              pre_visit_checklist_completed: false,
              updated_at: new Date(2026, 5, 12, 8, 55),
              carry_items: { note: '患者 佐藤 090-9999-9999 東京都 アムロジピン 個別事情' },
              escalation_reason: '患者 佐藤 個別事情',
              preparation: {
                id: 'prep_blocked',
                org_id: 'org_1',
                prepared_at: null,
                updated_at: new Date(2026, 5, 12, 9, 5),
                medication_changes_reviewed: true,
                carry_items_confirmed: false,
                previous_issues_reviewed: true,
                route_confirmed: false,
                offline_synced: true,
                checklist: { raw: '患者 佐藤 090-9999-9999' },
                route_plan_snapshot: { raw: '東京都 アムロジピン' },
              },
              case_: {
                patient: {
                  id: 'patient_visit_prep',
                  name: '訪問 準備',
                },
              },
            },
          ]);
        }
        return Promise.resolve([
          {
            id: 'visit_1',
            visit_type: 'regular',
            schedule_status: 'planned',
            time_window_start: new Date(Date.UTC(2026, 5, 12, 10, 30)),
            time_window_end: new Date(Date.UTC(2026, 5, 12, 11, 30)),
            facility_batch_id: null,
            case_: { patient: { name: '伊藤' } },
          },
        ]);
      },
    );

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.urgent_total_count).toBe(5);
    expect(json.data.urgent_items.map((item: { id: string }) => item.id)).toEqual([
      'visit_preparation:visit_prep_blocked',
      'audit:task_narcotic',
      'task:exception_1',
      'audit:task_plain',
      'task:exception_2',
    ]);
    expect(json.data.urgent_items[0]).toMatchObject({
      source: 'visit_preparation',
      source_id: 'prep_blocked',
      source_label: '訪問準備',
      reference_label: 'VP-001 / 10:00',
      severity: 'blocking',
      patient_id: 'patient_visit_prep',
      patient_name: '訪問 準備',
      title: '訪問持参物がブロック中です',
      summary: expect.stringContaining('未完了:'),
      action_href: '/visits/visit_prep_blocked/record',
      action_label: '準備を確認',
    });
    expect(json.data.urgent_items[0].summary).toContain('持参物ステータス未解決');
    expect(json.data.urgent_items[0].summary).toContain('持参薬・物品確認');

    const responseBody = JSON.stringify(json.data.urgent_items);
    expect(responseBody).not.toContain('carry_items');
    expect(responseBody).not.toContain('checklist');
    expect(responseBody).not.toContain('route_plan_snapshot');
    expect(responseBody).not.toContain('escalation_reason');
    expect(responseBody).not.toContain('090-9999-9999');
    expect(responseBody).not.toContain('東京都');
    expect(responseBody).not.toContain('アムロジピン');

    const prepQuery = visitScheduleFindManyMock.mock.calls.find(
      ([args]) => args?.select?.preparation,
    )?.[0];
    expect(prepQuery).toMatchObject({
      take: 12,
      where: expect.objectContaining({
        org_id: 'org_1',
        schedule_status: { in: ['planned', 'in_preparation'] },
      }),
      select: {
        id: true,
        display_id: true,
        visit_type: true,
        priority: true,
        schedule_status: true,
        scheduled_date: true,
        time_window_start: true,
        carry_items_status: true,
        pre_visit_checklist_completed: true,
        updated_at: true,
        preparation: {
          select: {
            id: true,
            org_id: true,
            prepared_at: true,
            updated_at: true,
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
          },
        },
        case_: {
          select: {
            patient: { select: { id: true, name: true } },
          },
        },
      },
    });
    expect(prepQuery?.select).not.toHaveProperty('carry_items');
    expect(prepQuery?.select).not.toHaveProperty('escalation_reason');
    expect(prepQuery?.select?.preparation?.select).not.toHaveProperty('checklist');
    expect(prepQuery?.select?.preparation?.select).not.toHaveProperty('route_plan_snapshot');
    expect(visitScheduleCountMock).toHaveBeenCalledWith({ where: prepQuery?.where });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContextMock,
      maxWaitMs: 2000,
      timeoutMs: 3000,
    });
  });

  it('skips billing urgent reads when the dashboard viewer lacks billing permission', async () => {
    authContextMock.role = 'clerk';

    const response = (await GETDetails(createRequest('', '/api/dashboard/cockpit/details'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.urgent_items.map((item: { source: string }) => item.source)).not.toContain(
      'billing',
    );
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(billingCandidateCountMock).not.toHaveBeenCalled();
  });

  it('scopes billing urgent reads by assigned patients for non-admin billing roles', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GETDetails(
      createRequest('?scope=team', '/api/dashboard/cockpit/details'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    expect(billingCandidateFindManyMock.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      org_id: 'org_1',
      billing_domain: 'home_care',
      status: 'candidate',
      patient_id: { in: ['patient_1'] },
    });
    expect(billingCandidateCountMock.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      patient_id: { in: ['patient_1'] },
    });
  });

  it('scopes visit preparation urgent reads by assigned care cases for non-admin members', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GETDetails(
      createRequest('?scope=team', '/api/dashboard/cockpit/details'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    const prepFindQuery = visitScheduleFindManyMock.mock.calls.find(
      ([args]) => args?.select?.preparation,
    )?.[0];
    const prepCountQuery = visitScheduleCountMock.mock.calls.at(-1)?.[0];
    expect(prepFindQuery?.where).toMatchObject({
      org_id: 'org_1',
      OR: [
        { case_id: { in: ['case_1'] } },
        { case_: { org_id: 'org_1', patient_id: { in: ['patient_1'] } } },
      ],
    });
    expect(prepCountQuery?.where).toEqual(prepFindQuery?.where);
  });

  it('returns medication stock risks from formal inbound signals without full cockpit fields', async () => {
    inboundCommunicationSignalCountMock.mockImplementation(() => {
      throw new Error('PERF-DB-002 legacy stock-risk count path must not run');
    });
    inboundCommunicationSignalFindManyMock.mockImplementation(() => {
      throw new Error('PERF-DB-002 legacy stock-risk findMany path must not run');
    });
    medicationStockQueryRawMock.mockResolvedValueOnce([
      {
        id: 'signal_urgent',
        patient_id: 'patient_stock_1',
        case_id: 'case_stock_1',
        inbound_event_id: 'event_urgent',
        signal_type: 'out_of_stock_text',
        extracted_text: '湿布がなくなりました',
        extracted_medication_name: '湿布A',
        extracted_quantity: null,
        extracted_unit: null,
        source_confidence: 'manual',
        review_status: 'needs_review',
        action_status: 'not_linked',
        created_at: new Date(2026, 5, 12, 8, 10),
        updated_at: new Date(2026, 5, 12, 9, 20),
        inbound_event_patient_id: 'patient_stock_1',
        inbound_event_case_id: 'case_stock_1',
        inbound_event_source_channel: 'mcs',
        inbound_event_sender_role: 'nurse',
        inbound_event_normalized_summary: '湿布不足の報告',
        inbound_event_received_at: new Date(2026, 5, 12, 9, 0),
        total_count: BigInt(6),
        urgent_count: BigInt(2),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
        linked_to_stock_event_count: BigInt(2),
        sender_name: '訪問看護師 山田',
        sender_contact: '090-9999-9999',
        raw_text: '湿布がなくなりました。090-9999-9999',
        external_url: 'https://example.invalid/secret',
        attachment: { storage_key: 'private/storage/key' },
      },
      {
        id: 'signal_usage',
        patient_id: 'patient_stock_2',
        case_id: null,
        inbound_event_id: 'event_usage',
        signal_type: 'usage_delta',
        extracted_text: null,
        extracted_medication_name: 'カロナール',
        extracted_quantity: 2,
        extracted_unit: '錠',
        source_confidence: 'text_parsed_high',
        review_status: 'accepted',
        action_status: 'not_linked',
        created_at: new Date(2026, 5, 12, 8, 15),
        updated_at: new Date(2026, 5, 12, 8, 50),
        inbound_event_patient_id: 'patient_stock_2',
        inbound_event_case_id: null,
        inbound_event_source_channel: 'phone',
        inbound_event_sender_role: 'family',
        inbound_event_normalized_summary: 'カロナールを2錠使用',
        inbound_event_received_at: new Date(2026, 5, 12, 8, 30),
        total_count: BigInt(6),
        urgent_count: BigInt(2),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
        linked_to_stock_event_count: BigInt(2),
        raw_text: 'カロナールを2錠使いました。secret@example.com',
      },
      {
        id: 'signal_missing_medication',
        patient_id: 'patient_stock_3',
        case_id: null,
        inbound_event_id: 'event_missing',
        signal_type: 'observed_quantity',
        extracted_text: '薬が残り4枚です',
        extracted_medication_name: null,
        extracted_quantity: 4,
        extracted_unit: '枚',
        source_confidence: 'text_parsed_low',
        review_status: 'needs_review',
        action_status: 'linked_to_task',
        created_at: new Date(2026, 5, 12, 8, 20),
        updated_at: new Date(2026, 5, 12, 8, 45),
        inbound_event_patient_id: 'patient_stock_3',
        inbound_event_case_id: null,
        inbound_event_source_channel: 'fax',
        inbound_event_sender_role: 'facility_staff',
        inbound_event_normalized_summary: null,
        inbound_event_received_at: new Date(2026, 5, 12, 8, 40),
        total_count: BigInt(6),
        urgent_count: BigInt(2),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
        linked_to_stock_event_count: BigInt(2),
      },
      {
        id: 'signal_linked',
        patient_id: 'patient_stock_4',
        case_id: null,
        inbound_event_id: 'event_linked',
        signal_type: 'low_stock_text',
        extracted_text: '軟膏が少ないです',
        extracted_medication_name: '軟膏B',
        extracted_quantity: null,
        extracted_unit: null,
        source_confidence: 'manual',
        review_status: 'accepted',
        action_status: 'linked_to_stock_event',
        created_at: new Date(2026, 5, 12, 8, 25),
        updated_at: new Date(2026, 5, 12, 8, 35),
        inbound_event_patient_id: 'patient_stock_4',
        inbound_event_case_id: null,
        inbound_event_source_channel: 'manual',
        inbound_event_sender_role: 'pharmacist',
        inbound_event_normalized_summary: null,
        inbound_event_received_at: new Date(2026, 5, 12, 8, 35),
        total_count: BigInt(6),
        urgent_count: BigInt(2),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
        linked_to_stock_event_count: BigInt(2),
      },
    ]);
    medicationStockQueryRawMock.mockResolvedValueOnce([]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_stock_1', name: '残数 一郎' },
      { id: 'patient_stock_2', name: '残数 二郎' },
      { id: 'patient_stock_3', name: '残数 三郎' },
      { id: 'patient_stock_4', name: '残数 四郎' },
    ]);

    const response = (await GETStockRisks(createRequest('', '/api/dashboard/cockpit/stock-risks'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.stock_summary).toEqual({
      urgent_shortage_count: 2,
      shortage_expected_count: 1,
      usage_unknown_count: 1,
      equivalence_review_count: 1,
      inbound_stock_signal_count: 6,
      ledger_stock_risk_count: 0,
      linked_to_stock_event_count: 2,
    });
    expect(json.data.stock_items_total_count).toBe(6);
    expect(json.data.stock_items_visible_count).toBe(4);
    expect(json.data.stock_items_hidden_count).toBe(2);
    expect(json.data.cycle_status_counts).toBeUndefined();
    expect(json.data.audit_queue).toBeUndefined();
    expect(json.data.today_visits).toBeUndefined();
    expect(json.data.items).toBeUndefined();
    expect(json.data.stock_items.map((item: { id: string }) => item.id)).toEqual([
      'medication_stock_signal:signal_urgent',
      'medication_stock_signal:signal_usage',
      'medication_stock_signal:signal_missing_medication',
      'medication_stock_signal:signal_linked',
    ]);
    expect(json.data.stock_items[0]).toMatchObject({
      risk_level: 'urgent',
      medication_name: '湿布A',
      patient_name: '残数 一郎',
      source_text: '湿布がなくなりました',
      source_label: 'MCS',
      action_href: '/patients/patient_stock_1#medication-stock-events',
      action_label: '残数報告を確認',
    });
    expect(json.data.stock_items[1]).toMatchObject({
      risk_level: 'usage_unknown',
      quantity_label: '2錠',
      source_text: 'カロナールを2錠使用',
    });
    expect(json.data.stock_items[2]).toMatchObject({
      risk_level: 'review_required',
      medication_name: null,
      quantity_label: '4枚',
    });
    expect(json.data.stock_items[3]).toMatchObject({
      risk_level: 'linked',
      action_label: '残数反映を確認',
    });

    const responseBody = JSON.stringify(json.data);
    expect(responseBody).not.toContain('sender_contact');
    expect(responseBody).not.toContain('訪問看護師 山田');
    expect(responseBody).not.toContain('external_url');
    expect(responseBody).not.toContain('attachment');
    expect(responseBody).not.toContain('storage_key');
    expect(responseBody).not.toContain('090-9999-9999');
    expect(responseBody).not.toContain('secret@example.com');

    expect(inboundCommunicationSignalFindManyMock).not.toHaveBeenCalled();
    expect(inboundCommunicationSignalCountMock).not.toHaveBeenCalled();
    expect(medicationStockQueryRawMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContextMock,
      maxWaitMs: 2000,
      timeoutMs: 3000,
    });
    expect(serverCacheSetMock).not.toHaveBeenCalled();
  });

  it('adds medication stock ledger snapshot risks without leaking raw instructions', async () => {
    medicationStockQueryRawMock.mockResolvedValueOnce([]);
    medicationStockQueryRawMock.mockResolvedValueOnce([
      {
        stock_item_id: 'stock_item_urgent',
        stock_item_display_id: 'MS-001',
        patient_id: 'patient_ledger_1',
        case_id: 'case_ledger_1',
        display_name: '湿布A',
        ingredient_name: 'ロキソプロフェン',
        strength: '100mg',
        dosage_form: '貼付剤',
        route: '外用',
        unit: 'sheet',
        medication_category: 'topical',
        managing_party: 'family',
        equivalence_review_status: 'not_required',
        equivalence_confidence: 'exact_code',
        item_updated_at: new Date(2026, 5, 12, 8, 20),
        snapshot_id: 'snapshot_urgent',
        current_quantity: '2',
        last_observed_quantity: '2',
        last_observed_at: new Date(2026, 5, 12, 8, 10),
        estimated_daily_usage: '1',
        usage_confidence: 'medium',
        estimated_stockout_date: new Date(Date.UTC(2026, 5, 14, 0, 0)),
        days_until_stockout: 2,
        stock_risk_level: 'urgent',
        risk_reason_code: 'raw instruction 090-1111-2222',
        calculated_at: new Date(2026, 5, 12, 8, 30),
        total_count: BigInt(4),
        urgent_count: BigInt(1),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
      },
      {
        stock_item_id: 'stock_item_shortage',
        stock_item_display_id: 'MS-002',
        patient_id: 'patient_ledger_2',
        case_id: null,
        display_name: '軟膏B',
        ingredient_name: 'ヘパリン類似物質',
        strength: null,
        dosage_form: '軟膏',
        route: '外用',
        unit: 'tube',
        medication_category: 'external',
        managing_party: 'patient',
        equivalence_review_status: 'not_required',
        equivalence_confidence: 'exact_code',
        item_updated_at: new Date(2026, 5, 12, 8, 10),
        snapshot_id: 'snapshot_shortage',
        current_quantity: '1',
        last_observed_quantity: '1',
        last_observed_at: new Date(2026, 5, 12, 8, 0),
        estimated_daily_usage: '0.5',
        usage_confidence: 'high',
        estimated_stockout_date: new Date(Date.UTC(2026, 5, 16, 0, 0)),
        days_until_stockout: 4,
        stock_risk_level: 'shortage_expected',
        risk_reason_code: null,
        calculated_at: new Date(2026, 5, 12, 8, 25),
        total_count: BigInt(4),
        urgent_count: BigInt(1),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
      },
      {
        stock_item_id: 'stock_item_usage',
        stock_item_display_id: 'MS-003',
        patient_id: 'patient_ledger_3',
        case_id: null,
        display_name: 'カロナール錠500',
        ingredient_name: 'アセトアミノフェン',
        strength: '500mg',
        dosage_form: '錠剤',
        route: '内服',
        unit: 'tablet',
        medication_category: 'prn',
        managing_party: 'patient',
        equivalence_review_status: 'not_required',
        equivalence_confidence: 'ingredient_strength_form',
        item_updated_at: new Date(2026, 5, 12, 8, 0),
        snapshot_id: 'snapshot_usage',
        current_quantity: '6',
        last_observed_quantity: '6',
        last_observed_at: new Date(2026, 5, 11, 8, 0),
        estimated_daily_usage: null,
        usage_confidence: 'unknown',
        estimated_stockout_date: null,
        days_until_stockout: null,
        stock_risk_level: 'ok',
        risk_reason_code: null,
        calculated_at: new Date(2026, 5, 12, 8, 15),
        total_count: BigInt(4),
        urgent_count: BigInt(1),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
      },
      {
        stock_item_id: 'stock_item_equivalence',
        stock_item_display_id: 'MS-004',
        patient_id: 'patient_ledger_4',
        case_id: null,
        display_name: '不明薬',
        ingredient_name: null,
        strength: null,
        dosage_form: null,
        route: null,
        unit: 'dose',
        medication_category: 'other',
        managing_party: 'unknown',
        equivalence_review_status: 'needs_review',
        equivalence_confidence: 'uncertain',
        item_updated_at: new Date(2026, 5, 12, 7, 50),
        snapshot_id: null,
        current_quantity: null,
        last_observed_quantity: null,
        last_observed_at: null,
        estimated_daily_usage: null,
        usage_confidence: null,
        estimated_stockout_date: null,
        days_until_stockout: null,
        stock_risk_level: null,
        risk_reason_code: '患者 太郎 secret@example.com',
        calculated_at: null,
        total_count: BigInt(4),
        urgent_count: BigInt(1),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(1),
        equivalence_review_count: BigInt(1),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_ledger_1', name: '台帳 一郎' },
      { id: 'patient_ledger_2', name: '台帳 二郎' },
      { id: 'patient_ledger_3', name: '台帳 三郎' },
      { id: 'patient_ledger_4', name: '台帳 四郎' },
    ]);

    const response = (await GETStockRisks(createRequest('', '/api/dashboard/cockpit/stock-risks'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.stock_summary).toEqual({
      urgent_shortage_count: 1,
      shortage_expected_count: 1,
      usage_unknown_count: 1,
      equivalence_review_count: 1,
      inbound_stock_signal_count: 0,
      ledger_stock_risk_count: 4,
      linked_to_stock_event_count: 0,
    });
    expect(json.data.stock_items_total_count).toBe(4);
    expect(json.data.stock_items_visible_count).toBe(4);
    expect(json.data.stock_items.map((item: { id: string }) => item.id)).toEqual([
      'medication_stock_snapshot:snapshot_urgent',
      'medication_stock_snapshot:snapshot_shortage',
      'medication_stock_snapshot:snapshot_usage',
      'medication_stock_snapshot:stock_item_equivalence',
    ]);
    expect(json.data.stock_items[0]).toMatchObject({
      source: 'stock_snapshot',
      risk_level: 'urgent',
      medication_name: '湿布A',
      quantity_label: '2枚',
      source_label: '残数台帳',
      source_text: '残数 2枚 / 推定切れ日 2026-06-14',
      action_href: '/patients/patient_ledger_1#medication-stock-events',
      action_label: '残数台帳を確認',
      signal_id: null,
      inbound_event_id: null,
      stock_item_id: 'stock_item_urgent',
      snapshot_id: 'snapshot_urgent',
    });
    expect(json.data.stock_items[2]).toMatchObject({
      risk_level: 'usage_unknown',
      quantity_label: '6錠',
      source_text: '残数 6錠 / 使用頻度未確認',
    });
    expect(json.data.stock_items[3]).toMatchObject({
      risk_level: 'review_required',
      source_text: '名寄せ確認待ち',
      quantity_label: null,
    });

    const responseBody = JSON.stringify(json.data);
    expect(responseBody).not.toContain('risk_reason_code');
    expect(responseBody).not.toContain('raw instruction');
    expect(responseBody).not.toContain('090-1111-2222');
    expect(responseBody).not.toContain('secret@example.com');
    expect(responseBody).not.toContain('usage_instruction_text');
    expect(responseBody).not.toContain('indication_text');
    expect(inboundCommunicationSignalFindManyMock).not.toHaveBeenCalled();
    expect(inboundCommunicationSignalCountMock).not.toHaveBeenCalled();
    expect(medicationStockQueryRawMock).toHaveBeenCalledTimes(2);
  });

  it('scopes medication stock risks by assigned patients and cases for non-admin members', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GETStockRisks(
      createRequest('?scope=team', '/api/dashboard/cockpit/stock-risks'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    expect(inboundCommunicationSignalFindManyMock).not.toHaveBeenCalled();
    expect(inboundCommunicationSignalCountMock).not.toHaveBeenCalled();
    expect(medicationStockQueryRawMock).toHaveBeenCalledTimes(2);
    const signalQuery = medicationStockQueryRawMock.mock.calls[0]?.[0] as {
      strings?: readonly string[];
      values?: unknown[];
    };
    const signalSql = signalQuery.strings?.join('?') ?? String(signalQuery);
    expect(signalSql).toContain('signal."patient_id"');
    expect(signalSql).toContain('signal."case_id"');
    expect(signalQuery.values).toEqual(expect.arrayContaining(['org_1', 'patient_1', 'case_1']));
  });

  it('returns empty medication stock risks without stock DB reads for empty assignment scope', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([]);

    const response = (await GETStockRisks(
      createRequest('?scope=team', '/api/dashboard/cockpit/stock-risks'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    expect(json.data.stock_summary).toEqual({
      urgent_shortage_count: 0,
      shortage_expected_count: 0,
      usage_unknown_count: 0,
      equivalence_review_count: 0,
      inbound_stock_signal_count: 0,
      ledger_stock_risk_count: 0,
      linked_to_stock_event_count: 0,
    });
    expect(json.data.stock_items).toEqual([]);
    expect(json.data.stock_items_total_count).toBe(0);
    expect(json.data.stock_items_visible_count).toBe(0);
    expect(json.data.stock_items_hidden_count).toBe(0);
    expect(inboundCommunicationSignalFindManyMock).not.toHaveBeenCalled();
    expect(inboundCommunicationSignalCountMock).not.toHaveBeenCalled();
    expect(medicationStockQueryRawMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('returns the report-billing segment without full cockpit fields or raw evidence', async () => {
    careReportCountMock.mockResolvedValue(1);
    deliveryRecordCountMock.mockImplementation(
      (args?: { where?: { status?: { in?: string[] } } }) => {
        const statuses = args?.where?.status?.in ?? [];
        if (statuses.includes('failed')) return Promise.resolve(1);
        if (statuses.includes('response_waiting')) return Promise.resolve(1);
        return Promise.resolve(0);
      },
    );
    billingCandidateCountMock.mockResolvedValue(1);
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_draft',
        patient_id: 'patient_draft',
        report_type: 'physician_report',
        status: 'draft',
        updated_at: new Date(2026, 5, 12, 8, 50),
        content: { raw: '患者 090-0000-0000 報告書本文' },
      },
    ]);
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        id: 'delivery_failed',
        channel: 'fax',
        recipient_name: 'やまもと内科',
        recipient_contact: '090-1111-2222',
        failure_reason: 'FAX送信エラー',
        status: 'failed',
        retry_count: 1,
        updated_at: new Date(2026, 5, 12, 9, 20),
        report: {
          id: 'report_failed',
          patient_id: 'patient_failed',
          report_type: 'physician_report',
        },
      },
      {
        id: 'delivery_waiting',
        channel: 'email',
        recipient_name: '訪問看護ST',
        recipient_contact: 'secret@example.com',
        failure_reason: null,
        status: 'response_waiting',
        retry_count: 0,
        updated_at: new Date(2026, 5, 12, 8, 40),
        report: {
          id: 'report_waiting',
          patient_id: 'patient_waiting',
          report_type: 'nurse_share',
        },
      },
    ]);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_open',
        patient_id: 'patient_billing',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT',
        billing_name: '在宅患者訪問薬剤管理指導料',
        updated_at: new Date(2026, 5, 12, 9, 10),
        source_snapshot: {
          validation_layers: { raw: '患者個別事情 090-2222-3333 token-like-value' },
        },
        calculation_breakdown: { raw: '算定根拠全文' },
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_draft', name: '下書き 太郎' },
      { id: 'patient_failed', name: '送付 花子' },
      { id: 'patient_waiting', name: '確認 次郎' },
      { id: 'patient_billing', name: '算定 三郎' },
    ]);

    const response = (await GETReportBilling(
      createRequest('', '/api/dashboard/cockpit/report-billing'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.reports).toEqual({
      draft_needed_count: 1,
      delivery_failed_count: 1,
      waiting_confirmation_count: 1,
    });
    expect(json.data.billing).toEqual({
      blocker_count: 1,
      close_queue_count: 1,
      month_end_risk_count: 0,
      can_view_billing: true,
    });
    expect(json.data.items_total_count).toBe(4);
    expect(json.data.items_visible_count).toBe(4);
    expect(json.data.items_hidden_count).toBe(0);
    expect(json.data.cycle_status_counts).toBeUndefined();
    expect(json.data.audit_queue).toBeUndefined();
    expect(json.data.today_visits).toBeUndefined();
    expect(json.data.team_capacity).toBeUndefined();
    expect(json.data.items.map((item: { id: string }) => item.id)).toEqual([
      'report_delivery:delivery_failed',
      'report:report_draft',
      'report_delivery:delivery_waiting',
      'billing:candidate_open',
    ]);
    expect(json.data.items[0]).toMatchObject({
      kind: 'report_delivery_failed',
      source_id: 'delivery_failed',
      patient_id: 'patient_failed',
      patient_name: '送付 花子',
      title: '報告書の送付失敗',
      summary: 'やまもと内科 / FAX / 理由: FAX送信エラー',
      severity: 'blocking',
      reference_label: 'FAX',
      due_at: new Date(2026, 5, 12, 9, 20).toISOString(),
      waiting_since: new Date(2026, 5, 12, 9, 20).toISOString(),
      action_href: '/reports/report_failed?action=resend&delivery_id=delivery_failed',
      action_label: '宛先確認・再送',
    });
    expect(json.data.items[3]).toMatchObject({
      kind: 'billing_candidate_pending',
      source_id: 'candidate_open',
      patient_id: 'patient_billing',
      patient_name: '算定 三郎',
      reference_label: '2026-06 / MED_HOME_VISIT',
      action_href:
        '/billing/candidates?billing_month=2026-06-01&status=candidate&candidate_id=candidate_open&patient_id=patient_billing',
    });

    const responseBody = JSON.stringify(json.data);
    expect(responseBody).not.toContain('content');
    expect(responseBody).not.toContain('source_snapshot');
    expect(responseBody).not.toContain('calculation_breakdown');
    expect(responseBody).not.toContain('validation_layers');
    expect(responseBody).not.toContain('recipient_contact');
    expect(responseBody).not.toContain('secret@example.com');
    expect(responseBody).not.toContain('090-1111-2222');
    expect(responseBody).not.toContain('090-2222-3333');

    expect(careReportFindManyMock.mock.calls.at(-1)?.[0]?.select).toEqual({
      id: true,
      patient_id: true,
      report_type: true,
      status: true,
      updated_at: true,
    });
    expect(deliveryRecordFindManyMock.mock.calls.at(-1)?.[0]?.select).toEqual({
      id: true,
      channel: true,
      recipient_name: true,
      failure_reason: true,
      status: true,
      retry_count: true,
      updated_at: true,
      report: {
        select: {
          id: true,
          patient_id: true,
          report_type: true,
        },
      },
    });
    expect(billingCandidateFindManyMock.mock.calls.at(-1)?.[0]?.select).toEqual({
      id: true,
      patient_id: true,
      billing_month: true,
      billing_code: true,
      billing_name: true,
      updated_at: true,
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContextMock,
      maxWaitMs: 2000,
      timeoutMs: 3000,
    });
  });

  it('skips report-billing billing reads when the dashboard viewer lacks billing permission', async () => {
    authContextMock.role = 'clerk';
    careReportCountMock.mockResolvedValue(1);
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_draft',
        patient_id: 'patient_draft',
        report_type: 'physician_report',
        status: 'draft',
        updated_at: new Date(2026, 5, 12, 8, 50),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_draft', name: '下書き 太郎' }]);

    const response = (await GETReportBilling(
      createRequest('', '/api/dashboard/cockpit/report-billing'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.reports.draft_needed_count).toBe(1);
    expect(json.data.billing).toEqual({
      blocker_count: 0,
      close_queue_count: 0,
      month_end_risk_count: 0,
      can_view_billing: false,
    });
    expect(json.data.items.map((item: { kind: string }) => item.kind)).toEqual(['report_draft']);
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(billingCandidateCountMock).not.toHaveBeenCalled();
  });

  it('scopes report-billing reads by assigned patients and cases for non-admin members', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GETReportBilling(
      createRequest('?scope=team', '/api/dashboard/cockpit/report-billing'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    expect(careReportFindManyMock.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      org_id: 'org_1',
      OR: [{ patient_id: { in: ['patient_1'] } }, { case_id: { in: ['case_1'] } }],
    });
    expect(deliveryRecordFindManyMock.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      org_id: 'org_1',
      report: {
        OR: [{ patient_id: { in: ['patient_1'] } }, { case_id: { in: ['case_1'] } }],
      },
    });
    expect(billingCandidateFindManyMock.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      org_id: 'org_1',
      patient_id: { in: ['patient_1'] },
    });
  });

  it('returns the team segment without audit or exception reads', async () => {
    const response = (await GETTeam(createRequest('', '/api/dashboard/cockpit/team'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.team_capacity).toEqual([
      expect.objectContaining({ user_id: 'user_1', role_label: '薬', status: 'working' }),
      expect.objectContaining({ user_id: 'user_2', role_label: '事務', status: 'working' }),
    ]);
    expect(json.data.audit_queue).toBeUndefined();
    expect(json.data.blocked_reasons).toBeUndefined();
    expect(json.data.cycle_status_counts).toBeUndefined();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(workflowExceptionFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:admin:user_1:2026-06-12:team:team'),
      expect.objectContaining({ team_capacity: expect.any(Array) }),
      15_000,
    );
  });

  it('returns a PHI-minimized comments segment without cockpit cache writes', async () => {
    taskCommentFindManyMock.mockResolvedValue([
      {
        id: 'comment_1',
        entity_type: 'medication_cycle',
        entity_id: 'cycle_1',
        content:
          '監査前に家族連絡の結果だけ確認してください。長い自由記載は一覧では短く切ります。'.repeat(
            2,
          ),
        author_id: 'user_2',
        mentions: ['user_1'],
        created_at: new Date('2026-06-12T00:35:00.000Z'),
      },
      {
        id: 'comment_2',
        entity_type: 'care_report',
        entity_id: 'report_1',
        content: '報告書の送付先を確認済みです。',
        author_id: 'user_1',
        mentions: [],
        created_at: new Date('2026-06-12T00:30:00.000Z'),
      },
      {
        id: 'comment_unknown',
        entity_type: 'external_share',
        entity_id: 'share_1',
        content: 'unknown entity',
        author_id: 'user_2',
        mentions: [],
        created_at: new Date('2026-06-12T00:20:00.000Z'),
      },
    ]);
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_1', patient_id: 'patient_1' }]);
    careReportFindManyMock.mockResolvedValue([{ id: 'report_1' }]);
    userFindManyMock.mockResolvedValue([
      { id: 'user_1', name: '山田 太郎' },
      { id: 'user_2', name: '鈴木 さくら' },
    ]);

    const response = (await GETComments(createRequest('', '/api/dashboard/cockpit/comments'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.comments_total_count).toBe(2);
    expect(json.data.comments_visible_count).toBe(2);
    expect(json.data.comments_hidden_count).toBe(0);
    expect(json.data.comments).toEqual([
      expect.objectContaining({
        id: 'comment_1',
        entity_type: 'medication_cycle',
        entity_label: '処方サイクル',
        author_name: '鈴木 さくら',
        mentions_me: true,
        authored_by_me: false,
        href: '/patients/patient_1',
      }),
      expect.objectContaining({
        id: 'comment_2',
        entity_type: 'care_report',
        entity_label: '報告書',
        author_name: '山田 太郎',
        mentions_me: false,
        authored_by_me: true,
        href: '/reports/report_1',
      }),
    ]);
    expect(json.data.comments[0].content_excerpt.length).toBeLessThanOrEqual(96);
    expect(JSON.stringify(json)).not.toContain('"content"');
    expect(JSON.stringify(json)).not.toContain('unknown entity');
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
    expect(userFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user_2', 'user_1'] }, org_id: 'org_1' },
      }),
    );
  });

  it('filters comments by personal assignment scope for non-admin members', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    taskCommentFindManyMock.mockResolvedValue([
      {
        id: 'comment_patient_allowed',
        entity_type: 'patient',
        entity_id: 'patient_1',
        content: '担当患者のコメント',
        author_id: 'user_2',
        mentions: [],
        created_at: new Date('2026-06-12T00:35:00.000Z'),
      },
      {
        id: 'comment_patient_denied',
        entity_type: 'patient',
        entity_id: 'patient_other',
        content: '担当外患者のコメント',
        author_id: 'user_2',
        mentions: [],
        created_at: new Date('2026-06-12T00:34:00.000Z'),
      },
      {
        id: 'comment_cycle_allowed',
        entity_type: 'medication_cycle',
        entity_id: 'cycle_allowed',
        content: '担当ケースのサイクル',
        author_id: 'user_3',
        mentions: ['user_1'],
        created_at: new Date('2026-06-12T00:33:00.000Z'),
      },
      {
        id: 'comment_cycle_denied',
        entity_type: 'medication_cycle',
        entity_id: 'cycle_denied',
        content: '担当外ケースのサイクル',
        author_id: 'user_3',
        mentions: [],
        created_at: new Date('2026-06-12T00:32:00.000Z'),
      },
    ]);
    medicationCycleFindManyMock.mockResolvedValue([
      { id: 'cycle_allowed', patient_id: 'patient_1' },
    ]);
    userFindManyMock.mockResolvedValue([
      { id: 'user_2', name: '鈴木 さくら' },
      { id: 'user_3', name: '佐藤 恵' },
    ]);

    const response = (await GETComments(createRequest('', '/api/dashboard/cockpit/comments'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'mine',
      applied: 'mine',
      can_view_team: false,
    });
    expect(json.data.comments.map((comment: { id: string }) => comment.id)).toEqual([
      'comment_patient_allowed',
      'comment_cycle_allowed',
    ]);
    expect(JSON.stringify(json)).not.toContain('担当外患者');
    expect(JSON.stringify(json)).not.toContain('担当外ケース');
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['cycle_allowed', 'cycle_denied'] },
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
  });

  it('returns an empty comments segment without author lookups', async () => {
    taskCommentFindManyMock.mockResolvedValue([]);

    const response = (await GETComments(createRequest('', '/api/dashboard/cockpit/comments'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        comments: [],
        comments_total_count: 0,
        comments_visible_count: 0,
        comments_hidden_count: 0,
      },
    });
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
  });

  it('returns authorized inbound communication details without cockpit cache writes', async () => {
    inboundCommunicationEventCountMock.mockResolvedValue(2);
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_channel: 'mcs',
        sender_name: '山田 花子',
        sender_role: 'nurse',
        sender_organization_name: '訪問看護ステーションA',
        sender_contact: '090-0000-0000',
        event_type: 'medication_stock_report',
        received_at: new Date('2026-06-12T00:20:00.000Z'),
        occurred_at: new Date('2026-06-12T00:10:00.000Z'),
        raw_text: '湿布は残り4枚です。痛みが強く使用頻度が増えています。',
        normalized_summary: '訪問看護師から湿布残数4枚と使用増加の報告',
        attachment_count: 1,
        has_medication_stock_signal: true,
        has_patient_safety_signal: true,
        has_schedule_signal: false,
        has_report_signal: true,
        processing_status: 'signals_extracted',
      },
      {
        id: 'event_2',
        patient_id: null,
        case_id: null,
        source_channel: 'phone',
        sender_name: '佐藤 太郎',
        sender_role: 'care_manager',
        sender_organization_name: '居宅介護支援B',
        sender_contact: '093-000-0000',
        event_type: 'schedule_request',
        received_at: new Date('2026-06-12T00:15:00.000Z'),
        occurred_at: null,
        raw_text: '来週の訪問時間を変更したいです。',
        normalized_summary: null,
        attachment_count: 0,
        has_medication_stock_signal: false,
        has_patient_safety_signal: false,
        has_schedule_signal: true,
        has_report_signal: false,
        processing_status: 'unprocessed',
      },
    ]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_1',
        inbound_event_id: 'event_1',
        signal_domain: 'medication_stock',
        signal_type: 'observed_quantity',
        extracted_text: '湿布は残り4枚',
        extracted_medication_name: '湿布',
        extracted_quantity: 4,
        extracted_unit: 'sheet',
        review_status: 'needs_review',
        action_status: 'not_linked',
        source_confidence: 'text_parsed_high',
      },
      {
        id: 'signal_2',
        inbound_event_id: 'event_1',
        signal_domain: 'medication_safety',
        signal_type: 'side_effect_suspected',
        extracted_text: '痛みが強く使用頻度が増えています',
        extracted_medication_name: null,
        extracted_quantity: null,
        extracted_unit: null,
        review_status: 'needs_review',
        action_status: 'not_linked',
        source_confidence: 'text_parsed_low',
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '田中 一郎' }]);

    const response = (await GETInbound(createRequest('', '/api/dashboard/cockpit/inbound'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    const json = await response.json();
    expect(json.data).toMatchObject({
      inbound_total_count: 2,
      inbound_visible_count: 2,
      inbound_hidden_count: 0,
      inbound_needs_review_count: 2,
      inbound_urgent_count: 1,
      inbound_medication_stock_signal_count: 1,
      inbound_safety_signal_count: 1,
    });
    expect(json.data.inbound_items[0]).toMatchObject({
      id: 'inbound_communication:event_1',
      event_id: 'event_1',
      channel: 'mcs',
      channel_label: 'MCS',
      status: 'needs_review',
      priority: 'urgent',
      patient_id: 'patient_1',
      patient_name: '田中 一郎',
      sender_name: '山田 花子',
      sender_role: 'nurse',
      sender_contact: '090-0000-0000',
      raw_text: '湿布は残り4枚です。痛みが強く使用頻度が増えています。',
      normalized_summary: '訪問看護師から湿布残数4枚と使用増加の報告',
      attachment_count: 1,
      action_href: '/patients/patient_1#inbound-communications',
      action_label: '受信情報を確認',
    });
    expect(json.data.inbound_items[0].signals).toEqual([
      expect.objectContaining({
        id: 'signal_1',
        signal_domain: 'medication_stock',
        extracted_medication_name: '湿布',
        extracted_quantity: 4,
        extracted_unit: 'sheet',
      }),
      expect.objectContaining({
        id: 'signal_2',
        signal_domain: 'medication_safety',
      }),
    ]);
    expect(json.data.inbound_items[1]).toMatchObject({
      channel: 'phone',
      channel_label: '電話',
      patient_id: null,
      action_href: '/communications/inbound?event=event_2',
    });
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1' },
        take: 40,
      }),
    );
    expect(inboundCommunicationEventCountMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
    });
    expect(inboundCommunicationSignalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          inbound_event_id: { in: ['event_1', 'event_2'] },
        },
      }),
    );
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
  });

  it('returns a false-empty inbound segment without signal or patient lookups', async () => {
    const response = (await GETInbound(createRequest('', '/api/dashboard/cockpit/inbound'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        inbound_items: [],
        inbound_total_count: 0,
        inbound_visible_count: 0,
        inbound_hidden_count: 0,
        inbound_needs_review_count: 0,
      },
    });
    expect(inboundCommunicationSignalFindManyMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
  });

  it('uses the personal assignment scope when an admin requests mine', async () => {
    authContextMock.role = 'admin';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_admin_1', patient_id: 'patient_admin_1' }]);

    const response = (await GET(createRequest('?scope=mine'), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'mine',
      applied: 'mine',
      can_view_team: true,
    });
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const cycleWhere = medicationCycleGroupByMock.mock.calls.at(-1)?.[0]?.where;
    expect(cycleWhere?.case_id).toEqual({ in: ['case_admin_1'] });

    const taskWhere = taskCountMock.mock.calls.at(-1)?.[0]?.where;
    expect(taskWhere?.OR).toEqual([
      { assigned_to: 'user_1' },
      { related_entity_type: 'patient', related_entity_id: { in: ['patient_admin_1'] } },
      { related_entity_type: 'case', related_entity_id: { in: ['case_admin_1'] } },
    ]);
  });

  it('falls back to mine when a non-admin requests team scope', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GET(createRequest('?scope=team'), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const auditWhere = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(auditWhere?.cycle).toEqual({ case_id: { in: ['case_1'] } });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:pharmacist:user_1:2026-06-12:mine'),
      expect.objectContaining({
        scope: { requested: 'team', applied: 'mine', can_view_team: false },
      }),
      15_000,
    );
  });

  it('JST でも scheduled_date(@db.Date)は UTC レンジ、created_at(DateTime)はローカル深夜で比較する', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);

      const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
      expect(visitWhere?.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(visitWhere?.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');

      // 繰越タスク(created_at, 実時刻)は JST 当日開始の実時刻(JST 0:00 = 前日 15:00Z)
      const taskWhere = taskCountMock.mock.calls.at(-1)?.[0]?.where;
      expect(taskWhere?.created_at.lt.toISOString()).toBe('2026-06-11T15:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('UTC ランタイム(prod)の JST 早朝でも繰越タスクは JST 当日開始の実時刻で数える(CE03)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。
      // 旧実装(setHours ローカル深夜)は UTC 深夜 2026-06-11T00:00Z を境界にし、
      // JST 当日早朝に作られたタスクを繰越に誤カウントしていた。
      vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);

      // @db.Date(scheduled_date)は JST 当日の UTC 深夜レンジ
      const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
      expect(visitWhere?.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(visitWhere?.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');

      // created_at(実時刻)は JST 当日開始の実時刻(= 2026-06-11T15:00Z)。旧実装は 2026-06-11T00:00Z。
      const taskWhere = taskCountMock.mock.calls.at(-1)?.[0]?.where;
      expect(taskWhere?.created_at.lt.toISOString()).toBe('2026-06-11T15:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('scopes queries by assigned care cases for non-admin members', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const cycleWhere = medicationCycleGroupByMock.mock.calls.at(-1)?.[0]?.where;
    expect(cycleWhere?.case_id).toEqual({ in: ['case_1'] });

    const auditWhere = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(auditWhere?.cycle).toEqual({ case_id: { in: ['case_1'] } });

    const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(visitWhere?.case_id).toEqual({ in: ['case_1'] });
  });

  it.each([
    ['?scope=', 'scope が不正です'],
    ['?scope=%20team', 'scope が不正です'],
    ['?scope=mine%20', 'scope が不正です'],
    ['?scope=all', 'scope が不正です'],
  ])('rejects malformed scope query "%s" before cache or DB reads', async (search, message) => {
    const response = (await GET(createRequest(search), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        scope: [message],
      },
    });
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate scope query before cache or DB reads', async () => {
    const response = (await GET(createRequest('?scope=mine&scope=team'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        scope: ['scope は1つだけ指定してください'],
      },
    });
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('wraps auth failure responses in no-store headers before cache or DB reads', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when cockpit aggregate reads fail', async () => {
    const unsafeError = new Error(
      'raw_patient_secret raw_dashboard_secret SQL_SECRET stack_secret raw-error text',
    );
    unsafeError.name = 'crafted.raw_patient_secret.raw_dashboard_secret.SQL_SECRET.stack_secret';
    medicationCycleGroupByMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw_patient_secret');
    expect(body).not.toContain('raw_dashboard_secret');
    expect(body).not.toContain('SQL_SECRET');
    expect(body).not.toContain('stack_secret');
    expect(body).not.toContain('crafted.raw_patient_secret');
    expect(body).not.toContain('raw-error text');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_cockpit_unhandled_error',
        route: '/api/dashboard/cockpit',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext, loggedError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    expect(loggedError).toBe(unsafeError);
    const logged = JSON.stringify(routeContext);
    expect(logged).not.toContain('raw_patient_secret');
    expect(logged).not.toContain('raw_dashboard_secret');
    expect(logged).not.toContain('SQL_SECRET');
    expect(logged).not.toContain('stack_secret');
    expect(logged).not.toContain('raw-error text');
    expect(logged).not.toContain(unsafeError.name);
  });
});
