import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const HOSTILE_EXISTING_REPORT_ID = 'report/existing?tab=x#frag';
const HOSTILE_WAITING_REPORT_ID = 'report/waiting?tab=x#frag';
const HOSTILE_SENT_REPORT_ID = 'report/sent?tab=x#frag';
const HOSTILE_DRAFT_REPORT_ID = 'report/draft?tab=x#frag';
const HOSTILE_FAILED_REPORT_ID = 'report/failed?tab=x#frag';
const HOSTILE_DRAFT_SCHEDULE_ID = 'sched/1?tab=x#frag';
const HOSTILE_FACILITY_SCHEDULE_ID = 'facility/sched?tab=x#frag';

const { authMock, membershipFindFirstMock, withOrgContextMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

type TxOverrides = {
  schedules?: unknown[];
  draftReports?: unknown[];
  recentReports?: unknown[];
  recentReportCount?: number;
  facilities?: unknown[];
  deliveries?: unknown[];
  waitingDeliveryCount?: number;
  requests?: unknown[];
  waitingRequestCount?: number;
  responses?: unknown[];
  resolvedResponseCount?: number;
  patients?: unknown[];
  billingCandidates?: unknown[];
  templateCount?: number;
  deliveryCount?: number;
};

function mockTx(overrides: TxOverrides = {}) {
  const tx = {
    visitSchedule: {
      findMany: vi.fn().mockResolvedValue(overrides.schedules ?? []),
    },
    careReport: {
      findMany: vi.fn().mockImplementation((args?: { take?: number; orderBy?: unknown }) => {
        if (args?.take) {
          const rows = overrides.recentReports ?? [];
          return Promise.resolve(rows.slice(0, args.take));
        }
        return Promise.resolve(overrides.draftReports ?? []);
      }),
      count: vi
        .fn()
        .mockResolvedValue(overrides.recentReportCount ?? (overrides.recentReports ?? []).length),
    },
    facility: {
      findMany: vi.fn().mockResolvedValue(overrides.facilities ?? []),
    },
    deliveryRecord: {
      findMany: vi.fn().mockResolvedValue(overrides.deliveries ?? []),
      count: vi.fn().mockImplementation((args?: { where?: { status?: string } }) => {
        if (args?.where?.status === 'response_waiting') {
          return Promise.resolve(
            overrides.waitingDeliveryCount ?? (overrides.deliveries ?? []).length,
          );
        }
        return Promise.resolve(overrides.deliveryCount ?? 0);
      }),
    },
    communicationRequest: {
      findMany: vi.fn().mockResolvedValue(overrides.requests ?? []),
      count: vi
        .fn()
        .mockResolvedValue(overrides.waitingRequestCount ?? (overrides.requests ?? []).length),
    },
    communicationResponse: {
      findMany: vi.fn().mockResolvedValue(overrides.responses ?? []),
      count: vi
        .fn()
        .mockResolvedValue(overrides.resolvedResponseCount ?? (overrides.responses ?? []).length),
    },
    patient: {
      findMany: vi.fn().mockResolvedValue(overrides.patients ?? []),
    },
    billingCandidate: {
      findMany: vi
        .fn()
        .mockImplementation((args?: { take?: number; where?: { OR?: unknown[] } }) => {
          let rows = overrides.billingCandidates ?? [];
          if (
            Array.isArray(args?.where?.OR) &&
            JSON.stringify(args.where.OR).includes('validation_layers')
          ) {
            rows = rows.filter((candidate) =>
              JSON.stringify((candidate as { source_snapshot?: unknown }).source_snapshot).includes(
                '"blocked"',
              ),
            );
          }
          return Promise.resolve(typeof args?.take === 'number' ? rows.slice(0, args.take) : rows);
        }),
    },
    template: {
      count: vi.fn().mockResolvedValue(overrides.templateCount ?? 0),
    },
  };
  withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn(tx),
  );
  return tx;
}

describe('/api/care-reports/today-workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
  });

  it('returns empty workspace aggregates with 200', async () => {
    mockTx();
    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    const json = await res!.json();
    expect(json.data.draft_rows).toEqual([]);
    expect(json.data.created_reports).toEqual([]);
    expect(json.data.open_issues).toEqual([]);
    expect(json.data.counts).toEqual({
      to_write: 0,
      waiting: 0,
      resolved: 0,
      created: 0,
      open_issues: 0,
    });
    expect(json.data.count_metadata).toEqual({
      to_write: {
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        limit: null,
        truncated: false,
        count_basis: 'full_result',
      },
      waiting: {
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        limit: 5,
        truncated: false,
        count_basis: 'database_total',
      },
      resolved: {
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        limit: 3,
        truncated: false,
        count_basis: 'database_total',
      },
      created: {
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        limit: 12,
        truncated: false,
        count_basis: 'database_total',
      },
      open_issues: {
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        limit: 12,
        truncated: false,
        count_basis: 'derived_visible_window',
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      }),
    );
  });

  it('uses Japan business date and instant ranges when date is omitted under UTC runtime', async () => {
    const tx = mockTx({
      schedules: [
        {
          id: 'sched_jst_midnight',
          schedule_status: 'planned',
          time_window_start: new Date('2026-06-12T01:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_jst', name: '田中 一郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: null,
        },
      ],
      patients: [{ id: 'p_jst', name: '田中 一郎' }],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z'));
    try {
      const req = createRequest('http://localhost/api/care-reports/today-workspace');
      const res = await GET(req, { params: Promise.resolve({}) });

      expect(res!.status).toBe(200);
      expect(tx.visitSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scheduled_date: {
              gte: new Date('2026-06-12T00:00:00.000Z'),
              lt: new Date('2026-06-13T00:00:00.000Z'),
            },
          }),
        }),
      );
      expect(tx.communicationResponse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            responded_at: {
              gte: new Date('2026-06-11T15:00:00.000Z'),
              lt: new Date('2026-06-12T15:00:00.000Z'),
            },
          }),
        }),
      );
      expect(tx.deliveryRecord.count).toHaveBeenCalledWith({
        where: {
          org_id: 'org_1',
          sent_at: {
            gte: new Date('2026-05-31T15:00:00.000Z'),
            lt: new Date('2026-06-30T15:00:00.000Z'),
          },
        },
      });
      expect(tx.billingCandidate.findMany).toHaveBeenCalled();
      for (const [args] of tx.billingCandidate.findMany.mock.calls) {
        expect(args.where.billing_month).toEqual(new Date('2026-06-01T00:00:00.000Z'));
      }
      await expect(res!.json()).resolves.toMatchObject({
        data: {
          generated_at: '2026-06-11T15:30:00.000Z',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds draft rows with recipient labels, narcotic note and facility batching', async () => {
    mockTx({
      schedules: [
        {
          id: HOSTILE_DRAFT_SCHEDULE_ID,
          schedule_status: 'planned',
          time_window_start: new Date('2026-06-11T01:30:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p1', name: '伊藤 キヨ' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [{ packaging_instruction_tags: [] }] }] },
          visit_record: null,
        },
        {
          id: 'sched_2',
          schedule_status: 'planned',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p2', name: '田中 一郎' },
            care_team_links: [
              { role: 'physician', name: '山本 健', is_primary: true },
              { role: 'care_manager', name: '中島 桜', is_primary: false },
            ],
          },
          cycle: {
            prescription_intakes: [
              { lines: [{ packaging_instruction_tags: ['narcotic', 'cold_storage'] }] },
            ],
          },
          visit_record: null,
        },
        // 施設一括(同一 batch の 2 行 → 1 行に集約)
        {
          id: HOSTILE_FACILITY_SCHEDULE_ID,
          schedule_status: 'planned',
          time_window_start: new Date('2026-06-11T06:30:00.000Z'),
          facility_batch_id: 'batch_1',
          facility_batch: { id: 'batch_1', facility_id: 'fac_1', patient_ids: Array(12).fill('p') },
          case_: { patient: { id: 'p3', name: '入居者A' }, care_team_links: [] },
          cycle: null,
          visit_record: null,
        },
        {
          id: 'sched_4',
          schedule_status: 'planned',
          time_window_start: new Date('2026-06-11T06:40:00.000Z'),
          facility_batch_id: 'batch_1',
          facility_batch: { id: 'batch_1', facility_id: 'fac_1', patient_ids: Array(12).fill('p') },
          case_: { patient: { id: 'p4', name: '入居者B' }, care_team_links: [] },
          cycle: null,
          visit_record: null,
        },
      ],
      facilities: [{ id: 'fac_1', name: '施設グリーンヒル' }],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.draft_rows).toHaveLength(3);
    const [first, second, third] = json.data.draft_rows;

    expect(first.patient_label).toBe('伊藤 キヨ 様');
    expect(first.recipient_label).toBe('ケアマネ(中島様)');
    expect(first.status).toBe('before_visit');
    expect(first.visit_record_id).toBeNull();
    expect(first.note).toBeNull();
    expect(first.generation_targets).toEqual([]);
    expect(first.action).toEqual({
      label: '→ 訪問へ',
      href: `/visits/${encodeURIComponent(HOSTILE_DRAFT_SCHEDULE_ID)}/record`,
    });
    expect(first.action?.href).not.toBe(`/visits/${HOSTILE_DRAFT_SCHEDULE_ID}/record`);

    expect(second.recipient_label).toBe('医師(山本先生)+ケアマネ');
    // 危険区分メモは隠さない
    expect(second.note).toBe('麻薬使用状況を含む');
    expect(second.generation_targets).toEqual([]);

    expect(third.patient_label).toBe('施設グリーンヒル');
    expect(third.recipient_label).toBe('施設(看護師長)');
    expect(third.note).toBe('12名分を1通に集約');
    expect(third.generation_targets).toEqual([
      { report_type: 'facility_handoff', label: '施設向け' },
    ]);
    expect(third.action).toEqual({
      label: '→ 施設パケットへ',
      href: `/visits/${encodeURIComponent(HOSTILE_FACILITY_SCHEDULE_ID)}/facility-packet`,
    });
    expect(third.action?.href).not.toBe(`/visits/${HOSTILE_FACILITY_SCHEDULE_ID}/facility-packet`);

    expect(json.data.counts.to_write).toBe(3);
  });

  it('marks completed visits without report drafts as not-created generation candidates', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_ready',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p2', name: '田中 一郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: {
            id: 'visit_record_1',
            updated_at: new Date('2026-06-11T04:45:00.000Z'),
          },
        },
      ],
      draftReports: [],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.draft_rows).toHaveLength(1);
    expect(json.data.draft_rows[0]).toMatchObject({
      id: 'sched_ready',
      status: 'ready_to_generate',
      visit_record_id: 'visit_record_1',
      visit_record_updated_at: '2026-06-11T04:45:00.000Z',
      generation_targets: [{ report_type: 'care_manager_report', label: 'ケアマネ向け' }],
      action: null,
    });
  });

  it('does not offer report generation for unfinished visit records', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_in_progress',
          schedule_status: 'in_progress',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p2', name: '田中 一郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_1' },
        },
      ],
      draftReports: [],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.draft_rows[0]).toMatchObject({
      status: 'before_visit',
      visit_record_id: 'visit_record_1',
      generation_targets: [],
      action: { label: '→ 訪問へ', href: '/visits/sched_in_progress/record' },
    });
  });

  it('treats sent reports as existing detail targets instead of draft targets', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_sent',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p2', name: '田中 一郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_1' },
        },
      ],
      draftReports: [
        {
          id: HOSTILE_EXISTING_REPORT_ID,
          visit_record_id: 'visit_record_1',
          report_type: 'care_manager_report',
          status: 'sent',
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.draft_rows[0]).toMatchObject({
      status: 'report_existing',
      visit_record_id: 'visit_record_1',
      generation_targets: [],
      action: {
        label: '→ 詳細へ',
        href: `/reports/${encodeURIComponent(HOSTILE_EXISTING_REPORT_ID)}`,
      },
    });
    expect(json.data.draft_rows[0].action.href).not.toBe(`/reports/${HOSTILE_EXISTING_REPORT_ID}`);
  });

  it('keeps missing professional report types as generation targets when one report already exists', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_partial',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p2', name: '田中 一郎' },
            care_team_links: [
              { role: 'physician', name: '山本 健', is_primary: true },
              { role: 'care_manager', name: '中島 桜', is_primary: false },
            ],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: {
            id: 'visit_record_1',
            updated_at: new Date('2026-06-11T04:45:00.000Z'),
          },
        },
      ],
      draftReports: [
        {
          id: HOSTILE_EXISTING_REPORT_ID,
          visit_record_id: 'visit_record_1',
          report_type: 'physician_report',
          status: 'sent',
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.draft_rows[0]).toMatchObject({
      status: 'ready_to_generate',
      visit_record_id: 'visit_record_1',
      generation_targets: [{ report_type: 'care_manager_report', label: 'ケアマネ向け' }],
      action: {
        label: '→ 詳細へ',
        href: `/reports/${encodeURIComponent(HOSTILE_EXISTING_REPORT_ID)}`,
      },
    });
  });

  it('aggregates waiting replies (delivery + inquiry) and resolved-today entries', async () => {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 86_400_000);
    const twoDaysAgo = new Date(now - 2 * 86_400_000);
    const inquiryPatientId = 'patient/1?tab=x#frag';
    const inquiryPatientHref = `/patients/${encodeURIComponent(inquiryPatientId)}`;
    mockTx({
      deliveries: [
        {
          id: 'del_1',
          sent_at: threeDaysAgo,
          report: {
            id: HOSTILE_WAITING_REPORT_ID,
            patient_id: 'p_kato',
            report_type: 'care_manager_report',
            content: { title: 'ケアマネへの服薬状況報告' },
          },
        },
      ],
      requests: [
        {
          id: 'req_1',
          subject: 'みどり医院への疑義照会',
          patient_id: inquiryPatientId,
          status: 'sent',
          related_entity_type: 'tracing_report',
          related_entity_id: 'tracing/1?x=y#frag',
          requested_at: twoDaysAgo,
        },
      ],
      responses: [
        {
          id: 'resp_1',
          responded_at: new Date(now),
          request: { subject: '残薬照会(やまもと内科)', patient_id: 'p_sasaki' },
        },
      ],
      patients: [
        { id: 'p_kato', name: '加藤 ミサ' },
        { id: inquiryPatientId, name: '高橋 茂' },
        { id: 'p_sasaki', name: '佐々木 ハル' },
      ],
      templateCount: 3,
      deliveryCount: 14,
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.waiting_replies).toHaveLength(2);
    const [oldest, second] = json.data.waiting_replies;
    expect(oldest.title).toBe('加藤 ミサ 様 — ケアマネへの服薬状況報告');
    expect(oldest.waiting_days).toBe(3);
    expect(oldest.actions).toEqual([
      {
        label: '再送する',
        href: `/reports/${encodeURIComponent(HOSTILE_WAITING_REPORT_ID)}?action=resend&delivery_id=del_1`,
        kind: 'button',
      },
    ]);
    expect(JSON.stringify(oldest.actions)).not.toContain(`/reports/${HOSTILE_WAITING_REPORT_ID}`);
    expect(second.title).toBe('高橋 茂 様 — みどり医院への疑義照会');
    expect(second.waiting_days).toBe(2);
    expect(second.actions).toEqual([
      {
        label: '依頼を確認',
        href: `/communications/requests?status=sent&patient_id=${encodeURIComponent(
          inquiryPatientId,
        )}&request_id=req_1&related_entity_type=tracing_report&related_entity_id=${encodeURIComponent(
          'tracing/1?x=y#frag',
        )}`,
        kind: 'button',
      },
      { label: '→ カードへ', href: inquiryPatientHref, kind: 'link' },
    ]);
    expect(JSON.stringify(json.data.waiting_replies)).not.toContain(
      `/patients/${inquiryPatientId}`,
    );

    expect(json.data.resolved_today).toHaveLength(1);
    expect(json.data.resolved_today[0].title).toBe('佐々木 ハル 様 — 残薬照会(やまもと内科)');
    expect(json.data.resolved_today[0].action).toEqual({ label: '→ 調剤へ', href: '/dispense' });

    expect(json.data.evidence).toEqual({ template_count: 3, monthly_delivery_count: 14 });
    expect(json.data.counts).toEqual({
      to_write: 0,
      waiting: 2,
      resolved: 1,
      created: 0,
      open_issues: 0,
    });
  });

  it('separates total, visible, and hidden counts for limited workspace lists', async () => {
    const now = Date.now();
    mockTx({
      deliveries: Array.from({ length: 5 }, (_, index) => ({
        id: `del_${index}`,
        sent_at: new Date(now - (index + 1) * 86_400_000),
        report: {
          id: `report_waiting_${index}`,
          patient_id: `patient_${index}`,
          report_type: 'care_manager_report',
          content: { title: `報告 ${index}` },
        },
      })),
      waitingDeliveryCount: 7,
      requests: [],
      waitingRequestCount: 2,
      responses: Array.from({ length: 3 }, (_, index) => ({
        id: `resp_${index}`,
        responded_at: new Date(now - index * 60_000),
        request: { subject: `回答 ${index}`, patient_id: `patient_${index}` },
      })),
      resolvedResponseCount: 5,
      recentReports: Array.from({ length: 12 }, (_, index) => ({
        id: `report_created_${index}`,
        patient_id: `patient_${index}`,
        report_type: 'care_manager_report',
        status: 'sent',
        content: {},
        created_at: new Date(now - index * 60_000),
        updated_at: new Date(now - index * 60_000),
        delivery_records: [],
      })),
      recentReportCount: 20,
      patients: Array.from({ length: 12 }, (_, index) => ({
        id: `patient_${index}`,
        name: `患者 ${index}`,
      })),
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.waiting_replies).toHaveLength(5);
    expect(json.data.resolved_today).toHaveLength(3);
    expect(json.data.created_reports).toHaveLength(12);
    expect(json.data.counts).toMatchObject({
      waiting: 9,
      resolved: 5,
      created: 20,
    });
    expect(json.data.count_metadata).toMatchObject({
      waiting: {
        total_count: 9,
        visible_count: 5,
        hidden_count: 4,
        limit: 5,
        truncated: true,
        count_basis: 'database_total',
      },
      resolved: {
        total_count: 5,
        visible_count: 3,
        hidden_count: 2,
        limit: 3,
        truncated: true,
        count_basis: 'database_total',
      },
      created: {
        total_count: 20,
        visible_count: 12,
        hidden_count: 8,
        limit: 12,
        truncated: true,
        count_basis: 'database_total',
      },
    });
  });

  it('focuses waiting inquiry secondary actions on related report, visit, and schedule records', async () => {
    const now = Date.now();
    const reportEntityId = 'care/report?x=y#frag';
    const visitRecordEntityId = 'visit/record?x=y#frag';
    const scheduleEntityId = 'schedule/1?x=y#frag';
    const fallbackPatientId = 'patient/fallback?x=y#frag';
    mockTx({
      requests: [
        {
          id: 'req_report',
          subject: '報告書返信確認',
          patient_id: 'patient_1',
          status: 'sent',
          related_entity_type: 'care_report',
          related_entity_id: reportEntityId,
          requested_at: new Date(now - 4 * 86_400_000),
        },
        {
          id: 'req_visit',
          subject: '訪問記録確認',
          patient_id: 'patient_1',
          status: 'sent',
          related_entity_type: 'visit_record',
          related_entity_id: visitRecordEntityId,
          requested_at: new Date(now - 3 * 86_400_000),
        },
        {
          id: 'req_schedule',
          subject: '訪問予定確認',
          patient_id: 'patient_1',
          status: 'sent',
          related_entity_type: 'visit_schedule',
          related_entity_id: scheduleEntityId,
          requested_at: new Date(now - 2 * 86_400_000),
        },
        {
          id: 'req_dot_report',
          subject: '不正な報告書ID',
          patient_id: fallbackPatientId,
          status: 'sent',
          related_entity_type: 'care_report',
          related_entity_id: '.',
          requested_at: new Date(now - 86_400_000),
        },
      ],
      patients: [
        { id: 'patient_1', name: '田中 一郎' },
        { id: fallbackPatientId, name: '佐藤 花子' },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    type WaitingReplyResult = {
      id: string;
      actions: Array<{ label: string; href: string; kind: string }>;
    };
    const repliesById = new Map<string, WaitingReplyResult>(
      (json.data.waiting_replies as WaitingReplyResult[]).map((reply) => [reply.id, reply]),
    );

    expect(repliesById.get('request-req_report')?.actions[1]).toEqual({
      label: '→ 報告書詳細',
      href: `/reports/${encodeURIComponent(reportEntityId)}`,
      kind: 'link',
    });
    expect(repliesById.get('request-req_visit')?.actions[1]).toEqual({
      label: '→ 訪問詳細',
      href: `/visits/${encodeURIComponent(visitRecordEntityId)}`,
      kind: 'link',
    });
    expect(repliesById.get('request-req_schedule')?.actions[1]).toEqual({
      label: '→ スケジュール',
      href: `/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleEntityId)}`,
      kind: 'link',
    });
    expect(repliesById.get('request-req_dot_report')?.actions[1]).toEqual({
      label: '→ カードへ',
      href: `/patients/${encodeURIComponent(fallbackPatientId)}`,
      kind: 'link',
    });
    expect(JSON.stringify(json.data.waiting_replies)).not.toContain(`/reports/${reportEntityId}`);
    expect(JSON.stringify(json.data.waiting_replies)).not.toContain(
      `/visits/${visitRecordEntityId}`,
    );
  });

  it('lists created reports with professional delivery status and open report issues', async () => {
    mockTx({
      recentReports: [
        {
          id: HOSTILE_SENT_REPORT_ID,
          patient_id: 'p_tanaka',
          report_type: 'physician_report',
          status: 'sent',
          content: {
            title: '主治医への服薬状況報告',
            source_provenance: {
              medication_cycle_id: 'cycle_1',
              prescription_line_ids: ['line_1'],
            },
            billing_context: { payer_basis: 'medical' },
          },
          created_at: new Date('2026-06-10T01:00:00.000Z'),
          updated_at: new Date('2026-06-11T02:00:00.000Z'),
          delivery_records: [
            {
              id: 'delivery_1',
              channel: 'fax',
              recipient_name: '山田 太郎',
              status: 'sent',
              sent_at: new Date('2026-06-11T02:10:00.000Z'),
            },
          ],
        },
        {
          id: HOSTILE_DRAFT_REPORT_ID,
          patient_id: 'p_kato',
          report_type: 'care_manager_report',
          status: 'draft',
          content: { title: 'ケアマネへの共有' },
          created_at: new Date('2026-06-11T03:00:00.000Z'),
          updated_at: new Date('2026-06-11T03:30:00.000Z'),
          delivery_records: [],
        },
        {
          id: HOSTILE_FAILED_REPORT_ID,
          patient_id: 'p_takahashi',
          report_type: 'physician_report',
          status: 'failed',
          content: {
            title: '主治医への再送確認',
            source_provenance: {
              medication_cycle_id: 'cycle_2',
              prescription_line_ids: ['line_2'],
            },
            billing_context: { payer_basis: 'medical' },
          },
          created_at: new Date('2026-06-11T04:00:00.000Z'),
          updated_at: new Date('2026-06-11T04:30:00.000Z'),
          delivery_records: [
            {
              id: 'delivery_failed',
              channel: 'email',
              recipient_name: 'やまもと内科',
              recipient_contact: 'doctor@example.com',
              status: 'failed',
              sent_at: null,
              failure_reason: 'SMTP 550 doctor@example.com 090-1234-5678',
              retry_count: 1,
              updated_at: new Date('2026-06-11T04:40:00.000Z'),
            },
          ],
        },
      ],
      patients: [
        { id: 'p_tanaka', name: '田中 一郎' },
        { id: 'p_kato', name: '加藤 ミサ' },
        { id: 'p_takahashi', name: '高橋 茂' },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.created_reports).toHaveLength(3);
    expect(json.data.created_reports[0]).toMatchObject({
      id: HOSTILE_SENT_REPORT_ID,
      patient_id: 'p_tanaka',
      patient_label: '田中 一郎 様',
      report_type_label: '医師への報告',
      status_label: '送付済',
      reported_to_professional: true,
      last_sent_at: '2026-06-11T02:10:00.000Z',
      last_recipient_label: '山田 太郎',
      last_channel: 'fax',
      action: { label: '→ 詳細へ', href: `/reports/${encodeURIComponent(HOSTILE_SENT_REPORT_ID)}` },
    });
    expect(json.data.created_reports[1]).toMatchObject({
      id: HOSTILE_DRAFT_REPORT_ID,
      patient_id: 'p_kato',
      patient_label: '加藤 ミサ 様',
      reported_to_professional: false,
      last_sent_at: null,
      action: {
        label: '→ 詳細へ',
        href: `/reports/${encodeURIComponent(HOSTILE_DRAFT_REPORT_ID)}`,
      },
    });
    expect(json.data.created_reports[2]).toMatchObject({
      id: HOSTILE_FAILED_REPORT_ID,
      patient_id: 'p_takahashi',
      patient_label: '高橋 茂 様',
      reported_to_professional: false,
      last_sent_at: null,
      failed_delivery: {
        delivery_record_id: 'delivery_failed',
        recipient_label: 'やまもと内科',
        channel: 'email',
        failure_reason: '送付に失敗しました',
        retry_count: 1,
        failed_at: '2026-06-11T04:40:00.000Z',
        action: {
          label: '宛先確認・再送',
          href: `/reports/${encodeURIComponent(HOSTILE_FAILED_REPORT_ID)}?action=resend&delivery_id=delivery_failed`,
        },
      },
      action: {
        label: '→ 詳細へ',
        href: `/reports/${encodeURIComponent(HOSTILE_FAILED_REPORT_ID)}`,
      },
    });
    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${HOSTILE_DRAFT_REPORT_ID}-draft-confirmation`,
          report_id: HOSTILE_DRAFT_REPORT_ID,
          severity: 'critical',
          title: '加藤 ミサ 様 — 薬剤師確認待ち',
          action: {
            label: '確認する',
            href: `/reports/${encodeURIComponent(HOSTILE_DRAFT_REPORT_ID)}`,
          },
        }),
        expect.objectContaining({
          id: `${HOSTILE_DRAFT_REPORT_ID}-prescription-link`,
          report_id: HOSTILE_DRAFT_REPORT_ID,
          severity: 'warning',
        }),
        expect.objectContaining({
          id: `${HOSTILE_DRAFT_REPORT_ID}-billing-context`,
          report_id: HOSTILE_DRAFT_REPORT_ID,
          severity: 'warning',
        }),
        expect.objectContaining({
          id: `${HOSTILE_FAILED_REPORT_ID}-delivery-failed`,
          report_id: HOSTILE_FAILED_REPORT_ID,
          severity: 'critical',
          action: {
            label: '宛先確認・再送',
            href: `/reports/${encodeURIComponent(HOSTILE_FAILED_REPORT_ID)}?action=resend&delivery_id=delivery_failed`,
          },
          description:
            'メール / やまもと内科 / 再送1回 / 理由: 送付に失敗しました。宛先とチャネルを確認して再送してください。',
          failed_delivery: expect.objectContaining({
            delivery_record_id: 'delivery_failed',
            retry_count: 1,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(json.data.created_reports)).not.toContain(
      `/reports/${HOSTILE_SENT_REPORT_ID}`,
    );
    expect(JSON.stringify(json.data.created_reports)).not.toContain(
      `/reports/${HOSTILE_DRAFT_REPORT_ID}`,
    );
    expect(JSON.stringify(json.data.created_reports)).not.toContain(
      `/reports/${HOSTILE_FAILED_REPORT_ID}`,
    );
    expect(JSON.stringify(json.data.open_issues)).not.toContain(
      `/reports/${HOSTILE_DRAFT_REPORT_ID}`,
    );
    expect(JSON.stringify(json.data.open_issues)).not.toContain(
      `/reports/${HOSTILE_FAILED_REPORT_ID}`,
    );
    const responseText = JSON.stringify(json.data);
    expect(responseText).not.toContain('doctor@example.com');
    expect(responseText).not.toContain('090-1234-5678');
    expect(responseText).not.toContain('SMTP 550');
    expect(json.data.counts.created).toBe(3);
    expect(json.data.counts.open_issues).toBe(4);
  });

  it('adds same-workspace billing candidate blockers to report open issues', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      billingCandidates: [
        {
          id: 'candidate_1',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              rule_engine: {
                state: 'manual_review',
                message: '初回訪問の算定条件を確認してください。',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'billing_candidate',
          id: 'billing-candidate-candidate_1',
          billing_candidate_id: 'candidate_1',
          patient_id: 'p_billing',
          severity: 'warning',
          title: '鈴木 次郎 様 — 算定候補の確認待ち',
          description:
            '在宅患者訪問薬剤管理指導料: 算定候補レビューが未確定です。請求候補画面で根拠を確認してください。',
          action: {
            label: '算定候補へ',
            href: '/billing/candidates?billing_month=2026-06-01&candidate_id=candidate_1&patient_id=p_billing',
          },
        }),
      ]),
    );
    expect(json.data.counts.open_issues).toBe(1);
    expect(JSON.stringify(json.data.open_issues)).not.toContain(
      '初回訪問の算定条件を確認してください。',
    );
  });

  it('uses only valid facility-batch patient ids for billing blocker scans', async () => {
    const tx = mockTx({
      schedules: [
        {
          id: 'sched_facility',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: 'batch_1',
          facility_batch: {
            id: 'batch_1',
            facility_id: 'fac_1',
            patient_ids: ['p_facility', '', 123, null, '   '],
          },
          case_: {
            patient: { id: 'p_schedule', name: '代表患者' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_facility' },
        },
      ],
      patients: [
        { id: 'p_schedule', name: '代表患者' },
        { id: 'p_facility', name: '施設患者' },
      ],
      billingCandidates: [
        {
          id: 'candidate_facility',
          patient_id: 'p_facility',
          billing_name: '施設一括 算定候補',
          source_snapshot: {
            validation_layers: {
              close_review: { state: 'blocked', message: '締め確認待ち' },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    for (const [args] of tx.billingCandidate.findMany.mock.calls) {
      expect(args.where.patient_id.in).toEqual(
        expect.arrayContaining(['p_schedule', 'p_facility']),
      );
      expect(args.where.patient_id.in).not.toEqual(expect.arrayContaining(['', 123, null, '   ']));
    }
    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'billing_candidate',
          id: 'billing-candidate-candidate_facility',
          patient_id: 'p_facility',
        }),
      ]),
    );
    expect(JSON.stringify(json.data.open_issues)).not.toContain('123');
  });

  it('does not expose billing candidate blockers to report-only roles', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });
    const tx = mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      billingCandidates: [
        {
          id: 'candidate_1',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              close_review: {
                state: 'blocked',
                message: '鈴木次郎様の個別事情: 090-1111-2222',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(tx.billingCandidate.findMany).not.toHaveBeenCalled();
    expect(json.data.open_issues).toEqual([]);
    const responseText = JSON.stringify(json.data);
    expect(responseText).not.toContain('candidate_1');
    expect(responseText).not.toContain('在宅患者訪問薬剤管理指導料');
    expect(responseText).not.toContain('鈴木次郎様');
    expect(responseText).not.toContain('090-1111-2222');
  });

  it('prioritizes blocked billing validation over earlier manual review layers', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      billingCandidates: [
        {
          id: 'candidate_blocked',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              rule_engine: {
                state: 'manual_review',
                message: 'レビュー待ち',
              },
              close_review: {
                state: 'blocked',
                message: 'レビューで除外',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'billing_candidate',
          id: 'billing-candidate-candidate_blocked',
          severity: 'critical',
          description:
            '在宅患者訪問薬剤管理指導料: 算定候補レビューでブロックされています。請求候補画面で根拠を確認してください。',
        }),
      ]),
    );
    const responseText = JSON.stringify(json.data);
    expect(responseText).not.toContain('レビュー待ち');
    expect(responseText).not.toContain('レビューで除外');
  });

  it('keeps critical billing blockers when report issues exceed the open issue limit', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      recentReports: Array.from({ length: 12 }, (_, index) => ({
        id: `report_${index}`,
        patient_id: `patient_${index}`,
        report_type: 'care_manager_report',
        status: 'confirmed',
        content: {},
        created_at: new Date(`2026-06-11T0${index % 10}:00:00.000Z`),
        updated_at: new Date(`2026-06-11T0${index % 10}:00:00.000Z`),
        delivery_records: [],
      })),
      billingCandidates: [
        {
          id: 'candidate_critical',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              close_review: {
                state: 'blocked',
                message: 'レビューで除外',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toHaveLength(12);
    expect(json.data.open_issues[0]).toEqual(
      expect.objectContaining({
        kind: 'billing_candidate',
        id: 'billing-candidate-candidate_critical',
        severity: 'critical',
      }),
    );
  });

  it('keeps warning billing candidates when same-severity report issues exceed the open issue limit', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      recentReports: Array.from({ length: 12 }, (_, index) => ({
        id: `report_warning_${index}`,
        patient_id: `patient_${index}`,
        report_type: 'care_manager_report',
        status: 'confirmed',
        content: {},
        created_at: new Date(`2026-06-11T0${index % 10}:00:00.000Z`),
        updated_at: new Date(`2026-06-11T0${index % 10}:00:00.000Z`),
        delivery_records: [],
      })),
      billingCandidates: [
        {
          id: 'candidate_warning',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              rule_engine: {
                state: 'manual_review',
                message: 'レビュー待ち',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toHaveLength(12);
    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'billing_candidate',
          id: 'billing-candidate-candidate_warning',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('does not let lower-severity billing candidates displace critical report issues', async () => {
    mockTx({
      recentReports: Array.from({ length: 12 }, (_, index) => ({
        id: `report_critical_${index}`,
        patient_id: `patient_${index}`,
        report_type: 'care_manager_report',
        status: 'draft',
        content: {
          source_provenance: {
            medication_cycle_id: `cycle_${index}`,
            prescription_line_ids: [`line_${index}`],
          },
          billing_context: { payer_basis: 'medical' },
        },
        created_at: new Date(`2026-06-11T0${index % 10}:00:00.000Z`),
        updated_at: new Date(`2026-06-11T0${index % 10}:00:00.000Z`),
        delivery_records: [],
      })),
      patients: Array.from({ length: 12 }, (_, index) => ({
        id: `patient_${index}`,
        name: `患者 ${index}`,
      })),
      billingCandidates: [
        {
          id: 'candidate_warning',
          patient_id: 'patient_0',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              rule_engine: {
                state: 'manual_review',
                message: 'レビュー待ち',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toHaveLength(12);
    expect(
      json.data.open_issues.every((issue: { severity: string }) => issue.severity === 'critical'),
    ).toBe(true);
    expect(json.data.open_issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'billing_candidate',
          id: 'billing-candidate-candidate_warning',
        }),
      ]),
    );
  });

  it('does not let lower-severity report issues displace critical billing candidates', async () => {
    mockTx({
      recentReports: [
        {
          id: 'report_warning',
          patient_id: 'patient_0',
          report_type: 'care_manager_report',
          status: 'confirmed',
          content: {
            source_provenance: {
              medication_cycle_id: 'cycle_1',
              prescription_line_ids: ['line_1'],
            },
            billing_context: { payer_basis: 'medical' },
          },
          created_at: new Date('2026-06-11T04:00:00.000Z'),
          updated_at: new Date('2026-06-11T04:30:00.000Z'),
          delivery_records: [],
        },
      ],
      patients: [{ id: 'patient_0', name: '患者 0' }],
      billingCandidates: Array.from({ length: 13 }, (_, index) => ({
        id: `candidate_critical_${index}`,
        patient_id: 'patient_0',
        billing_name: '在宅患者訪問薬剤管理指導料',
        source_snapshot: {
          validation_layers: {
            close_review: {
              state: 'blocked',
              message: '締めレビューで除外',
            },
          },
        },
      })),
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toHaveLength(12);
    expect(
      json.data.open_issues.every((issue: { severity: string }) => issue.severity === 'critical'),
    ).toBe(true);
    expect(json.data.open_issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'report',
          id: 'report_warning-not-reported',
        }),
      ]),
    );
  });

  it('scans beyond the visible open issue limit and keeps older blocked billing blockers', async () => {
    const tx = mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      billingCandidates: [
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `candidate_manual_${index}`,
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              rule_engine: {
                state: 'manual_review',
                message: 'レビュー待ち',
              },
            },
          },
        })),
        {
          id: 'candidate_blocked_old',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              close_review: {
                state: 'blocked',
                message: '締めレビューで除外',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(tx.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 36 }),
    );
    expect(json.data.open_issues[0]).toEqual(
      expect.objectContaining({
        kind: 'billing_candidate',
        id: 'billing-candidate-candidate_blocked_old',
        severity: 'critical',
      }),
    );
  });

  it('keeps blocked billing blockers even when they fall outside the recent scan cap', async () => {
    const tx = mockTx({
      schedules: [
        {
          id: 'sched_billing',
          schedule_status: 'completed',
          time_window_start: new Date('2026-06-11T05:00:00.000Z'),
          facility_batch_id: null,
          facility_batch: null,
          case_: {
            patient: { id: 'p_billing', name: '鈴木 次郎' },
            care_team_links: [{ role: 'care_manager', name: '中島 桜', is_primary: true }],
          },
          cycle: { prescription_intakes: [{ lines: [] }] },
          visit_record: { id: 'visit_record_billing' },
        },
      ],
      patients: [{ id: 'p_billing', name: '鈴木 次郎' }],
      billingCandidates: [
        ...Array.from({ length: 36 }, (_, index) => ({
          id: `candidate_manual_${index}`,
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              rule_engine: {
                state: 'manual_review',
                message: 'レビュー待ち',
              },
            },
          },
        })),
        {
          id: 'candidate_blocked_outside_recent_cap',
          patient_id: 'p_billing',
          billing_name: '在宅患者訪問薬剤管理指導料',
          source_snapshot: {
            validation_layers: {
              close_review: {
                state: 'blocked',
                message: '締めレビューで除外',
              },
            },
          },
        },
      ],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(tx.billingCandidate.findMany).toHaveBeenCalledTimes(2);
    expect(tx.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 36 }),
    );
    expect(tx.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 12,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              source_snapshot: expect.objectContaining({
                path: ['validation_layers', 'close_review', 'state'],
                equals: 'blocked',
              }),
            }),
          ]),
        }),
      }),
    );
    expect(json.data.open_issues[0]).toEqual(
      expect.objectContaining({
        kind: 'billing_candidate',
        id: 'billing-candidate-candidate_blocked_outside_recent_cap',
        severity: 'critical',
      }),
    );
  });

  it('keeps the top critical report issue when critical billing candidates fill the visible limit', async () => {
    mockTx({
      recentReports: [
        {
          id: 'report_failed',
          patient_id: 'p_report',
          report_type: 'physician_report',
          status: 'failed',
          content: {},
          created_at: new Date('2026-06-11T04:00:00.000Z'),
          updated_at: new Date('2026-06-11T04:30:00.000Z'),
          delivery_records: [
            {
              id: 'delivery_failed',
              channel: 'email',
              recipient_name: 'やまもと内科',
              status: 'failed',
              sent_at: null,
              failure_reason: 'SMTP 550 doctor@example.com',
              retry_count: 1,
              updated_at: new Date('2026-06-11T04:40:00.000Z'),
            },
          ],
        },
      ],
      patients: [{ id: 'p_report', name: '高橋 茂' }],
      billingCandidates: Array.from({ length: 12 }, (_, index) => ({
        id: `candidate_critical_${index}`,
        patient_id: 'p_report',
        billing_name: '在宅患者訪問薬剤管理指導料',
        source_snapshot: {
          validation_layers: {
            close_review: {
              state: 'blocked',
              message: '締めレビューで除外',
            },
          },
        },
      })),
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    expect(json.data.open_issues).toHaveLength(12);
    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'report',
          id: 'report_failed-delivery-failed',
          severity: 'critical',
        }),
      ]),
    );
  });

  it('returns 400 on invalid date param', async () => {
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-6-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    expectSensitiveNoStore(res!);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 400 on impossible date params', async () => {
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-02-31');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    expectSensitiveNoStore(res!);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate date params before workspace reads', async () => {
    const req = createRequest(
      'http://localhost/api/care-reports/today-workspace?date=2026-06-11&date=2026-06-12',
    );
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    expectSensitiveNoStore(res!);
    await expect(res!.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: { date: ['date は1つだけ指定してください'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store internal error when auth plumbing fails', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw today workspace auth patient 山田 花子 token secret'),
    );
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');

    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const payload = await res!.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const payloadText = JSON.stringify(payload);
    expect(payloadText).not.toContain('raw today workspace auth');
    expect(payloadText).not.toContain('山田 花子');
    expect(payloadText).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store internal error when workspace reads fail', async () => {
    withOrgContextMock.mockRejectedValue(
      new Error('raw workspace read patient 山田 花子 token secret'),
    );
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-11');

    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const payload = await res!.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const payloadText = JSON.stringify(payload);
    expect(payloadText).not.toContain('raw workspace read');
    expect(payloadText).not.toContain('山田 花子');
    expect(payloadText).not.toContain('token secret');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      }),
    );
  });
});
