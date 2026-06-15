import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

type TxOverrides = {
  schedules?: unknown[];
  draftReports?: unknown[];
  facilities?: unknown[];
  deliveries?: unknown[];
  requests?: unknown[];
  responses?: unknown[];
  patients?: unknown[];
  templateCount?: number;
  deliveryCount?: number;
};

function mockTx(overrides: TxOverrides = {}) {
  withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue(overrides.schedules ?? []),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue(overrides.draftReports ?? []),
      },
      facility: {
        findMany: vi.fn().mockResolvedValue(overrides.facilities ?? []),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue(overrides.deliveries ?? []),
        count: vi.fn().mockResolvedValue(overrides.deliveryCount ?? 0),
      },
      communicationRequest: {
        findMany: vi.fn().mockResolvedValue(overrides.requests ?? []),
      },
      communicationResponse: {
        findMany: vi.fn().mockResolvedValue(overrides.responses ?? []),
      },
      patient: {
        findMany: vi.fn().mockResolvedValue(overrides.patients ?? []),
      },
      template: {
        count: vi.fn().mockResolvedValue(overrides.templateCount ?? 0),
      },
    }),
  );
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
    const json = await res!.json();
    expect(json.data.draft_rows).toEqual([]);
    expect(json.data.counts).toEqual({ to_write: 0, waiting: 0, resolved: 0 });
  });

  it('builds draft rows with recipient labels, narcotic note and facility batching', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_1',
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
          id: 'sched_3',
          time_window_start: new Date('2026-06-11T06:30:00.000Z'),
          facility_batch_id: 'batch_1',
          facility_batch: { id: 'batch_1', facility_id: 'fac_1', patient_ids: Array(12).fill('p') },
          case_: { patient: { id: 'p3', name: '入居者A' }, care_team_links: [] },
          cycle: null,
          visit_record: null,
        },
        {
          id: 'sched_4',
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
    expect(first.action).toEqual({ label: '→ 訪問へ', href: '/visits' });

    expect(second.recipient_label).toBe('医師(山本先生)+ケアマネ');
    // 危険区分メモは隠さない
    expect(second.note).toBe('麻薬使用状況を含む');

    expect(third.patient_label).toBe('施設グリーンヒル');
    expect(third.recipient_label).toBe('施設(看護師長)');
    expect(third.note).toBe('12名分を1通に集約');

    expect(json.data.counts.to_write).toBe(3);
  });

  it('marks completed visits without report drafts as not-created generation candidates', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_ready',
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
    expect(json.data.draft_rows).toHaveLength(1);
    expect(json.data.draft_rows[0]).toMatchObject({
      id: 'sched_ready',
      status: 'ready_to_generate',
      visit_record_id: 'visit_record_1',
      action: null,
    });
  });

  it('aggregates waiting replies (delivery + inquiry) and resolved-today entries', async () => {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 86_400_000);
    const twoDaysAgo = new Date(now - 2 * 86_400_000);
    mockTx({
      deliveries: [
        {
          id: 'del_1',
          sent_at: threeDaysAgo,
          report: {
            id: 'rep_1',
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
          patient_id: 'p_takahashi',
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
        { id: 'p_takahashi', name: '高橋 茂' },
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
    expect(oldest.actions).toEqual([{ label: '再送する', href: '/reports/rep_1', kind: 'button' }]);
    expect(second.title).toBe('高橋 茂 様 — みどり医院への疑義照会');
    expect(second.waiting_days).toBe(2);
    expect(second.actions).toEqual([
      { label: '電話で確認', href: '/communications', kind: 'button' },
      { label: '→ カードへ', href: '/patients/p_takahashi', kind: 'link' },
    ]);

    expect(json.data.resolved_today).toHaveLength(1);
    expect(json.data.resolved_today[0].title).toBe('佐々木 ハル 様 — 残薬照会(やまもと内科)');
    expect(json.data.resolved_today[0].action).toEqual({ label: '→ 調剤へ', href: '/dispensing' });

    expect(json.data.evidence).toEqual({ template_count: 3, monthly_delivery_count: 14 });
    expect(json.data.counts).toEqual({ to_write: 0, waiting: 2, resolved: 1 });
  });

  it('returns 400 on invalid date param', async () => {
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-6-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
  });
});
