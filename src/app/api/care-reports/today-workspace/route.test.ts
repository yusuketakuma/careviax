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
  recentReports?: unknown[];
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
        findMany: vi.fn().mockImplementation((args?: { take?: number; orderBy?: unknown }) => {
          if (args?.take) return Promise.resolve(overrides.recentReports ?? []);
          return Promise.resolve(overrides.draftReports ?? []);
        }),
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
    expect(json.data.created_reports).toEqual([]);
    expect(json.data.open_issues).toEqual([]);
    expect(json.data.counts).toEqual({
      to_write: 0,
      waiting: 0,
      resolved: 0,
      created: 0,
      open_issues: 0,
    });
  });

  it('builds draft rows with recipient labels, narcotic note and facility batching', async () => {
    mockTx({
      schedules: [
        {
          id: 'sched_1',
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
          id: 'sched_3',
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
      action: { label: '→ 訪問へ', href: '/visits' },
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
      draftReports: [{ id: 'report_sent', visit_record_id: 'visit_record_1', status: 'sent' }],
    });

    const req = createRequest('http://localhost/api/care-reports/today-workspace');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.draft_rows[0]).toMatchObject({
      status: 'report_existing',
      visit_record_id: 'visit_record_1',
      action: { label: '→ 詳細へ', href: '/reports/report_sent' },
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

  it('lists created reports with professional delivery status and open report issues', async () => {
    mockTx({
      recentReports: [
        {
          id: 'report_sent',
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
          id: 'report_draft',
          patient_id: 'p_kato',
          report_type: 'care_manager_report',
          status: 'draft',
          content: { title: 'ケアマネへの共有' },
          created_at: new Date('2026-06-11T03:00:00.000Z'),
          updated_at: new Date('2026-06-11T03:30:00.000Z'),
          delivery_records: [],
        },
        {
          id: 'report_failed',
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
      id: 'report_sent',
      patient_label: '田中 一郎 様',
      report_type_label: '医師への報告',
      status_label: '送付済',
      reported_to_professional: true,
      last_sent_at: '2026-06-11T02:10:00.000Z',
      last_recipient_label: '山田 太郎',
      last_channel: 'fax',
    });
    expect(json.data.created_reports[1]).toMatchObject({
      id: 'report_draft',
      patient_label: '加藤 ミサ 様',
      reported_to_professional: false,
      last_sent_at: null,
    });
    expect(json.data.created_reports[2]).toMatchObject({
      id: 'report_failed',
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
        action: { label: '宛先確認・再送', href: '/reports/report_failed' },
      },
    });
    expect(json.data.open_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'report_draft-draft-confirmation',
          severity: 'critical',
          title: '加藤 ミサ 様 — 薬剤師確認待ち',
        }),
        expect.objectContaining({
          id: 'report_draft-prescription-link',
          severity: 'warning',
        }),
        expect.objectContaining({
          id: 'report_draft-billing-context',
          severity: 'warning',
        }),
        expect.objectContaining({
          id: 'report_failed-delivery-failed',
          severity: 'critical',
          action: { label: '宛先確認・再送', href: '/reports/report_failed' },
          description:
            'メール / やまもと内科 / 再送1回 / 理由: 送付に失敗しました。宛先とチャネルを確認して再送してください。',
          failed_delivery: expect.objectContaining({
            delivery_record_id: 'delivery_failed',
            retry_count: 1,
          }),
        }),
      ]),
    );
    const responseText = JSON.stringify(json.data);
    expect(responseText).not.toContain('doctor@example.com');
    expect(responseText).not.toContain('090-1234-5678');
    expect(responseText).not.toContain('SMTP 550');
    expect(json.data.counts.created).toBe(3);
    expect(json.data.counts.open_issues).toBe(4);
  });

  it('returns 400 on invalid date param', async () => {
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-6-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
  });

  it('returns 400 on impossible date params', async () => {
    const req = createRequest('http://localhost/api/care-reports/today-workspace?date=2026-02-31');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
