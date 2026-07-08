import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  patientFindManyMock,
  patientCountMock,
  dispenseTaskFindManyMock,
  workflowExceptionFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  patientFindManyMock: vi.fn(),
  patientCountMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: { findMany: patientFindManyMock, count: patientCountMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
  },
}));

import { GET } from './route';

const ORIGINAL_TZ = process.env.TZ;

function createRequest(search = '?scope=all') {
  return new NextRequest(`http://localhost/api/patients/board${search}`);
}

type PatientBoardTestMedicationCycle = {
  id: string;
  overall_status: string;
  exception_status: string | null;
  updated_at: Date;
  prescription_intakes: Array<{
    lines: Array<{
      packaging_instruction_tags: string[];
      dispensing_method: string | null;
    }>;
  }>;
  inquiries: Array<{ inquired_at: Date; resolved_at: Date | null }>;
  dispense_tasks: Array<{
    due_date: Date | null;
    audits: Array<{ result: string }>;
  }>;
  workflow_exceptions: Array<{
    exception_type: string;
    description: string;
    created_at: Date;
  }>;
};

function buildPatientRow(scheduledDate: Date) {
  return {
    id: 'patient_1',
    name: '佐藤 花子',
    name_kana: 'サトウ ハナコ',
    birth_date: new Date('1940-01-15T00:00:00.000Z'),
    medical_insurance_number: 'medical_1',
    care_insurance_number: null,
    allergy_info: null,
    scheduling_preference: {
      swallowing_route: null,
      preferred_contact_name: null,
      preferred_contact_phone: '090-1111-2222',
      visit_before_contact_required: false,
      parking_available: false,
      care_level: 'care_3',
    },
    contacts: [
      {
        is_primary: true,
        is_emergency_contact: true,
        phone: '090-1111-2222',
        email: null,
        fax: null,
      },
    ],
    residences: [],
    lab_observations: [],
    consents: [{ id: 'consent_1' }],
    cases: [
      {
        id: 'case_1',
        status: 'active',
        management_plans: [
          {
            id: 'plan_1',
            next_review_date: null,
          },
        ],
        care_team_links: [
          {
            role: 'physician',
            phone: '03-1111-1111',
            email: null,
            fax: '03-1111-1112',
            is_primary: true,
          },
          {
            role: 'nurse',
            phone: '03-2222-2222',
            email: null,
            fax: '03-2222-2223',
            is_primary: true,
          },
          {
            role: 'care_manager',
            phone: '03-3333-3333',
            email: null,
            fax: '03-3333-3334',
            is_primary: true,
          },
        ],
        care_reports: [] as Array<{ id: string; status: string }>,
        medication_cycles: [] as PatientBoardTestMedicationCycle[],
        visit_schedules: [
          {
            id: 'schedule_1',
            scheduled_date: scheduledDate,
            time_window_start: null,
            carry_items_status: 'ready',
            facility_batch_id: null,
            facility_batch: null,
            preparation: null,
          },
        ],
      },
    ],
  };
}

describe('/api/patients/board', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    patientFindManyMock.mockResolvedValue([]);
    patientCountMock.mockResolvedValue(0);
    dispenseTaskFindManyMock.mockResolvedValue([]);
    workflowExceptionFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('JST 朝(UTC では前日)でも visit_schedules を当日 UTC 深夜以降で絞り込む', async () => {
    vi.useFakeTimers();
    // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);

    const select = patientFindManyMock.mock.calls[0][0].select;
    const scheduleWhere = select.cases.select.visit_schedules.where;
    expect(scheduleWhere.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(select.contacts).toMatchObject({
      orderBy: [
        { is_primary: 'desc' },
        { is_emergency_contact: 'desc' },
        { created_at: 'asc' },
        { id: 'asc' },
      ],
      take: 10,
    });
    expect(select.contacts.select).toMatchObject({
      is_primary: true,
      is_emergency_contact: true,
      phone: true,
      email: true,
      fax: true,
    });
    expect(select.cases.select.care_team_links).toMatchObject({
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    expect(select.cases.select.care_team_links.select).toMatchObject({
      role: true,
      phone: true,
      email: true,
      fax: true,
      is_primary: true,
    });
    expect(select.cases.take).toBeUndefined();
    expect(select.cases.orderBy).toEqual([{ updated_at: 'desc' }, { id: 'desc' }]);
    expect(select.residences.select).toEqual({
      facility_id: true,
      building_id: true,
    });
    expect(select.lab_observations).toMatchObject({
      orderBy: [{ measured_at: 'desc' }, { id: 'desc' }],
      take: 1,
    });
    expect(
      select.cases.select.medication_cycles.select.prescription_intakes.select.lines,
    ).toMatchObject({
      orderBy: [{ line_number: 'asc' }, { id: 'asc' }],
      take: 50,
      select: {
        packaging_instruction_tags: true,
        dispensing_method: true,
      },
    });
    expect(select.cases.select.visit_schedules.select).toMatchObject({
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

  it('UTC 深夜で保存された当日の scheduled_date を「本日訪問」と判定する', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    // @db.Date 規約どおり UTC 深夜で保存された「今日」の予定
    const patient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
    (
      patient.cases[0]!.visit_schedules[0]! as { time_window_start: Date | null }
    ).time_window_start = new Date(Date.UTC(1970, 0, 1, 9, 0));
    patientFindManyMock.mockResolvedValue([patient]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const bodyText = await response.clone().text();
    expect(response.headers.get('content-length')).toBe(
      String(new TextEncoder().encode(bodyText).length),
    );
    const json = JSON.parse(bodyText);
    expect(json.meta.facets.chip_counts.visit_today).toBe(1);
    expect(json.data[0]).toMatchObject({
      attention: 'visit_today',
      next_visit_date: '2026-06-12',
      next_visit_time: '09:00',
      operation_summary: ['準備未完', '連絡先あり', '駐車場なし', '要介護 3'],
      foundation_summary: {
        status: 'needs_confirmation',
        label: '未確認1件',
        items: ['訪問準備未完'],
      },
      foundation_href: '/patients/patient_1#patient-foundation',
      link_label: '訪問へ',
      link_href: '/schedules?focus=schedule&schedule_id=schedule_1',
    });
    expect(JSON.stringify(json.data[0])).not.toContain('090-1111-2222');
    expect(json.meta).toMatchObject({
      assigned_total: 1,
      total_count: 1,
      returned_count: 1,
      has_more: false,
      next_cursor: null,
    });
  });

  it('UTC runtime の日本早朝でも日本業務日の予定を本日訪問として集計する', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z'));
      const patient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
      (
        patient.cases[0]!.visit_schedules[0]! as { time_window_start: Date | null }
      ).time_window_start = new Date(Date.UTC(1970, 0, 1, 9, 0));
      patientFindManyMock.mockResolvedValue([
        patient,
        {
          ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')),
          id: 'patient_future',
          name: '未来 太郎',
        },
      ]);
      patientCountMock.mockResolvedValue(2);

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

      expect(response.status).toBe(200);
      const select = patientFindManyMock.mock.calls[0][0].select;
      const scheduleWhere = select.cases.select.visit_schedules.where;
      expect(scheduleWhere.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      const json = await response.json();
      expect(json.meta.facets.chip_counts.visit_today).toBe(1);
      expect(json.meta.facets.today_visit_count).toBe(1);
      expect(json.data[0]).toMatchObject({
        attention: 'visit_today',
        next_visit_date: '2026-06-12',
        next_visit_time: '09:00',
      });
      expect(json.data[1]).toMatchObject({
        patient_id: 'patient_future',
        attention: 'steady',
        next_visit_date: '2026-06-13',
        operation_summary: ['連絡先あり', '駐車場なし', '要介護 3'],
      });
      expect(json.data[1].operation_summary).not.toContain('準備未完');
      expect(json.data[1].operation_summary).not.toContain('訪問準備済');
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('keeps assigned_total separate from the filtered page metadata', async () => {
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([buildPatientRow(new Date('2026-06-12T00:00:00.000Z'))]);
    patientCountMock.mockResolvedValue(30);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.meta.assigned_total).toBe(30);
    expect(json.meta.total_count).toBe(1);
    expect(json.meta.count_basis).toMatchObject({
      total_count: 'filtered_result_exact',
      chip_counts: 'scope_search_foundation_exact',
      foundation_issue_counts: 'scope_search_without_active_foundation_issue_exact',
    });
    expect(json.data.length).toBe(1);
    expect(json.meta.has_more).toBe(false);
  });

  it('encodes patient card and schedule hrefs while preserving raw patient ids', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const fallbackPatientId = 'patient/1?tab=x#frag';
    const staticLinkPatientId = 'patient/2?tab=x#frag';
    const scheduleId = '../schedule with space?x=1#frag';
    const fallbackPatientHref = `/patients/${encodeURIComponent(fallbackPatientId)}`;
    const staticLinkPatientHref = `/patients/${encodeURIComponent(staticLinkPatientId)}`;
    const scheduleHref = `/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`;
    const staticLinkPatient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
    staticLinkPatient.id = staticLinkPatientId;
    staticLinkPatient.name = '訪問 リンク';
    staticLinkPatient.cases[0]!.visit_schedules[0]!.id = scheduleId;
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-20T00:00:00.000Z')),
        id: fallbackPatientId,
        name: 'カード 遷移',
        cases: [],
      },
      staticLinkPatient,
    ]);
    patientCountMock.mockResolvedValue(2);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    const cardsByPatientId = new Map(
      json.data.map((card: { patient_id: string }) => [card.patient_id, card]),
    );
    const fallbackCard = cardsByPatientId.get(fallbackPatientId);
    const staticLinkCard = cardsByPatientId.get(staticLinkPatientId);

    expect(fallbackCard).toMatchObject({
      patient_id: fallbackPatientId,
      link_label: 'カードへ',
      link_href: fallbackPatientHref,
      foundation_href: `${fallbackPatientHref}#patient-foundation`,
    });
    expect(staticLinkCard).toMatchObject({
      patient_id: staticLinkPatientId,
      link_label: '訪問へ',
      link_href: scheduleHref,
      foundation_href: `${staticLinkPatientHref}#patient-foundation`,
    });
    expect(JSON.stringify(json)).not.toContain(`/patients/${fallbackPatientId}`);
    expect(JSON.stringify(json)).not.toContain(`/patients/${staticLinkPatientId}`);
    expect(JSON.stringify(json)).not.toContain(scheduleId);
  });

  it('focuses reply-wait patient cards on the exact pending report', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const reportId = 'report/1?tab=x#frag';
    const patient = buildPatientRow(new Date('2026-06-20T00:00:00.000Z'));
    patient.cases[0]!.care_reports = [{ id: reportId, status: 'failed' }];
    patient.cases[0]!.medication_cycles = [
      {
        id: 'cycle_1',
        overall_status: 'reported',
        exception_status: 'report_failed',
        updated_at: new Date('2026-06-10T00:00:00.000Z'),
        prescription_intakes: [{ lines: [] }],
        inquiries: [],
        dispense_tasks: [],
        workflow_exceptions: [],
      },
    ];
    patientFindManyMock.mockResolvedValue([patient]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const select = patientFindManyMock.mock.calls[0][0].select;
    expect(select.cases.select.care_reports).toEqual({
      where: { status: { in: ['response_waiting', 'failed'] } },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: 1,
      select: {
        id: true,
        status: true,
      },
    });

    const json = await response.json();
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_1',
      attention: 'reply_wait',
      status_text: '報告先の返信待ち 1日 — 再送できます',
      link_label: '報告・共有へ',
      link_href: `/reports/${encodeURIComponent(reportId)}`,
    });
    expect(JSON.stringify(json.data[0])).not.toContain(reportId);
  });

  it('does not return primary residence full address in the board card payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        residences: [
          {
            address: '東京都千代田区丸の内1-1-1',
            facility: null,
            building_id: null,
          },
        ],
      },
    ]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data[0]).not.toHaveProperty('address');
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_1',
      residence_kind: 'home',
      residence_label: '在宅',
    });
    expect(JSON.stringify(json)).not.toContain('東京都千代田区丸の内1-1-1');
  });

  it('does not expose facility names in the board residence label or search payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        residences: [
          {
            address: '東京都千代田区丸の内1-1-1',
            facility_id: 'facility_unique',
            facility: { name: '青空レジデンス丸の内' },
            building_id: null,
          },
        ],
      },
    ]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data[0]).toMatchObject({
      residence_kind: 'facility',
      residence_label: '施設',
    });
    expect(JSON.stringify(json)).not.toContain('青空レジデンス丸の内');
    expect(JSON.stringify(json)).not.toContain('丸の内');
    expect(JSON.stringify(json)).not.toContain('東京都千代田区');
  });

  it.each(['partial', 'blocked'] as const)(
    'prepared_at があっても持参物ステータス %s なら患者ボードでは準備未完扱いにする',
    async (carryItemsStatus) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      const patient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
      const careCase = patient.cases[0];
      patientFindManyMock.mockResolvedValue([
        {
          ...patient,
          cases: [
            {
              ...careCase,
              visit_schedules: [
                {
                  ...careCase.visit_schedules[0],
                  carry_items_status: carryItemsStatus,
                  preparation: {
                    prepared_at: new Date('2026-06-12T07:30:00+09:00'),
                    medication_changes_reviewed: true,
                    carry_items_confirmed: true,
                    previous_issues_reviewed: true,
                    route_confirmed: true,
                    offline_synced: true,
                  },
                },
              ],
            },
          ],
        },
      ]);
      patientCountMock.mockResolvedValue(1);

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.data[0]).toMatchObject({
        status_text: '本日訪問 — 出発前チェックを確認',
        operation_summary: ['準備未完', '連絡先あり', '駐車場なし', '要介護 3'],
        foundation_summary: {
          status: 'needs_confirmation',
          label: '未確認1件',
          items: ['訪問準備未完'],
        },
      });
      expect(JSON.stringify(json.data[0])).not.toContain('訪問準備済');
      expect(JSON.stringify(json.data[0])).not.toContain('準備完了');
    },
  );

  it('希望連絡先名だけでは患者カードを連絡先あり扱いにせず、連携先信頼性も同じ基準で未確認にする', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        scheduling_preference: {
          swallowing_route: null,
          preferred_contact_name: '長男',
          preferred_contact_phone: null,
          visit_before_contact_required: false,
          parking_available: true,
          care_level: 'care_3',
        },
        contacts: [],
        cases: [
          {
            id: 'case_newer_on_hold',
            status: 'on_hold',
            management_plans: [{ id: 'plan_on_hold', next_review_date: null }],
            care_team_links: [
              {
                role: 'physician',
                phone: '03-1111-1111',
                email: null,
                fax: '03-1111-1112',
                is_primary: true,
              },
              {
                role: 'nurse',
                phone: '03-2222-2222',
                email: null,
                fax: '03-2222-2223',
                is_primary: true,
              },
              {
                role: 'care_manager',
                phone: '03-3333-3333',
                email: null,
                fax: '03-3333-3334',
                is_primary: true,
              },
            ],
            medication_cycles: [],
            visit_schedules: [],
          },
          {
            id: 'case_active',
            status: 'active',
            management_plans: [{ id: 'plan_active', next_review_date: null }],
            care_team_links: [
              {
                role: 'physician',
                phone: '03-1111-1111',
                email: null,
                fax: null,
                is_primary: true,
              },
            ],
            medication_cycles: [],
            visit_schedules: [
              {
                scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
                time_window_start: null,
                carry_items_status: 'ready',
                facility_batch_id: null,
                facility_batch: null,
                preparation: null,
              },
            ],
          },
        ],
      },
    ]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data[0]).toMatchObject({
      operation_summary: ['準備未完', '連絡先未設定', '駐車場あり', '要介護 3'],
      foundation_summary: {
        status: 'needs_confirmation',
        label: '未確認3件',
        items: ['連絡先未設定', '連携先1件', '訪問準備未完'],
      },
    });
  });

  it('filters board cards by foundation issue using the derived foundation summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
      {
        ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')),
        id: 'patient_missing_contact',
        name: '連絡 不足',
        scheduling_preference: {
          swallowing_route: null,
          preferred_contact_name: '長男',
          preferred_contact_phone: null,
          visit_before_contact_required: false,
          parking_available: true,
          care_level: 'care_3',
        },
        contacts: [],
      },
    ]);
    patientCountMock.mockResolvedValue(2);

    const response = (await GET(createRequest('?scope=all&foundation_issue=missing_contact'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock.mock.calls[0][0]).not.toHaveProperty('take');
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_missing_contact',
      foundation_summary: {
        items: expect.arrayContaining(['連絡先未設定']),
      },
    });
    expect(json.meta.facets.foundation_issue_counts).toMatchObject({
      needs_confirmation: 2,
      missing_contact: 1,
    });
    expect(json.meta.assigned_total).toBe(2);
    expect(json.meta.total_count).toBe(1);
    expect(json.meta.has_more).toBe(false);
  });

  it.each([
    ['missing_parking', 'patient_missing_parking', '駐車未確認'],
    ['missing_care_level', 'patient_missing_care_level', '介護度未確認'],
    ['missing_insurance', 'patient_missing_insurance', '保険確認1件'],
    ['missing_consent_plan', 'patient_missing_consent_plan', '同意・計画未確認'],
  ] as const)(
    'filters board cards by expanded foundation issue %s',
    async (issue, patientId, expectedItem) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      const matchingPatient = {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        id: patientId,
        name: `対象 ${issue}`,
        scheduling_preference: {
          ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')).scheduling_preference,
          parking_available: issue === 'missing_parking' ? null : true,
          care_level: issue === 'missing_care_level' ? null : 'care_3',
        },
        medical_insurance_number: issue === 'missing_insurance' ? null : 'medical_1',
        care_insurance_number: null,
        consents: issue === 'missing_consent_plan' ? [] : [{ id: 'consent_1' }],
      };
      patientFindManyMock.mockResolvedValue([
        buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        matchingPatient,
      ]);
      patientCountMock.mockResolvedValue(2);

      const response = (await GET(createRequest(`?scope=all&foundation_issue=${issue}`), {
        params: Promise.resolve({}),
      }))!;

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toMatchObject({
        patient_id: patientId,
        foundation_issue_keys: [issue],
        foundation_summary: {
          items: expect.arrayContaining([expectedItem]),
        },
      });
      expect(json.meta.facets.foundation_issue_counts[issue]).toBe(1);
    },
  );

  it('keeps foundation issue counts on the unselected board basis when a DB prefilter is active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const insurancePatient = {
      ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
      id: 'patient_missing_insurance',
      medical_insurance_number: null,
      care_insurance_number: null,
    };
    const missingContactPatient = {
      ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')),
      id: 'patient_missing_contact',
      scheduling_preference: {
        ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')).scheduling_preference,
        preferred_contact_phone: null,
      },
      contacts: [],
    };
    patientFindManyMock
      .mockResolvedValueOnce([insurancePatient])
      .mockResolvedValueOnce([insurancePatient, missingContactPatient]);
    patientCountMock.mockResolvedValue(2);

    const response = (await GET(createRequest('?scope=all&foundation_issue=missing_insurance'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].patient_id).toBe('patient_missing_insurance');
    expect(json.meta.facets.foundation_issue_counts).toMatchObject({
      missing_insurance: 1,
      missing_contact: 1,
      needs_confirmation: 2,
    });
    expect(patientFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.not.objectContaining({ AND: expect.any(Array) }),
      }),
    );
  });

  it('sorts matching cards before applying the cursor page limit and reports has_more', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const patients = Array.from({ length: 81 }, (_, index) => ({
      ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
      id: `patient_${String(index).padStart(2, '0')}`,
      name: `患者 ${String(index).padStart(2, '0')}`,
      name_kana: `カンジャ ${String(index).padStart(2, '0')}`,
    }));
    patients[80] = {
      ...patients[80]!,
      id: 'patient_urgent_last_in_db_order',
      name: '最後 緊急',
      name_kana: 'ンンンン',
      cases: [
        {
          ...patients[80]!.cases[0]!,
          medication_cycles: [
            {
              id: 'cycle_urgent',
              overall_status: 'dispensed',
              exception_status: null,
              updated_at: new Date('2026-06-12T08:00:00+09:00'),
              prescription_intakes: [
                {
                  lines: [
                    {
                      packaging_instruction_tags: ['narcotic'],
                      dispensing_method: null,
                    },
                  ],
                },
              ],
              dispense_tasks: [
                {
                  due_date: new Date('2026-06-12T00:05:00.000Z'),
                  audits: [],
                },
              ],
              inquiries: [],
              workflow_exceptions: [],
            },
          ],
        },
      ],
    };
    patientFindManyMock.mockResolvedValue(patients);
    patientCountMock.mockResolvedValue(81);

    const response = (await GET(createRequest('?scope=all&foundation_issue=needs_confirmation'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(60);
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_urgent_last_in_db_order',
      attention: 'urgent_now',
    });
    expect(json.meta.total_count).toBe(81);
    expect(json.meta.has_more).toBe(true);
    expect(json.meta.next_cursor).toEqual(expect.any(String));
  });

  it('returns stable cursor pages with exact non-page-derived counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const patients = ['A', 'B', 'C'].map((suffix, index) => ({
      ...buildPatientRow(new Date(`2026-06-${20 + index}T00:00:00.000Z`)),
      id: `patient_${suffix.toLowerCase()}`,
      name: `患者 ${suffix}`,
      name_kana: `カンジャ ${suffix}`,
    }));
    patientFindManyMock.mockResolvedValue(patients);
    patientCountMock.mockResolvedValue(3);

    const first = (await GET(createRequest('?scope=all&limit=2'), {
      params: Promise.resolve({}),
    }))!;
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
      'patient_a',
      'patient_b',
    ]);
    expect(firstJson.meta).toMatchObject({
      limit: 2,
      returned_count: 2,
      total_count: 3,
      has_more: true,
    });
    expect(firstJson.meta.next_cursor).toEqual(expect.any(String));
    expect(firstJson.meta.facets.chip_counts.visit_today).toBe(0);
    expect(firstJson.meta.facets.safety_tagged_count).toBe(0);

    const second = (await GET(
      createRequest(`?scope=all&limit=2&cursor=${encodeURIComponent(firstJson.meta.next_cursor)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
      'patient_c',
    ]);
    expect(secondJson.meta).toMatchObject({
      limit: 2,
      returned_count: 1,
      total_count: 3,
      has_more: false,
      next_cursor: null,
    });
  });

  it('rejects tampered and filter-mismatched cursors before querying patients', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-20T00:00:00.000Z')),
        id: 'patient_a',
        name: '患者 A',
      },
      {
        ...buildPatientRow(new Date('2026-06-21T00:00:00.000Z')),
        id: 'patient_b',
        name: '患者 B',
      },
    ]);
    patientCountMock.mockResolvedValue(2);

    const first = (await GET(createRequest('?scope=all&limit=1'), {
      params: Promise.resolve({}),
    }))!;
    const firstJson = await first.json();
    const cursor = firstJson.meta.next_cursor as string;
    expect(cursor).toEqual(expect.any(String));

    patientFindManyMock.mockClear();
    patientCountMock.mockClear();

    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`;
    const tamperedResponse = (await GET(
      createRequest(`?scope=all&limit=1&cursor=${encodeURIComponent(tampered)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(tamperedResponse.status).toBe(400);
    expectSensitiveNoStore(tamperedResponse);
    const tamperedBody = await tamperedResponse.json();
    expect(JSON.stringify(tamperedBody)).not.toContain(tampered);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();

    const mismatchResponse = (await GET(
      createRequest(`?scope=mine&limit=1&cursor=${encodeURIComponent(cursor)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(mismatchResponse.status).toBe(400);
    expectSensitiveNoStore(mismatchResponse);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();
  });

  it('does not echo raw q or patient identifiers inside cursor metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-20T00:00:00.000Z')),
        id: 'patient_sensitive_a',
        name: '患者 A',
      },
      {
        ...buildPatientRow(new Date('2026-06-21T00:00:00.000Z')),
        id: 'patient_sensitive_b',
        name: '患者 B',
      },
    ]);
    patientCountMock.mockResolvedValue(2);
    const rawQuery = '東京都千代田区丸の内1-1-1';

    const response = (await GET(
      createRequest(`?scope=all&limit=1&q=${encodeURIComponent(rawQuery)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(response.status).toBe(200);
    const bodyText = await response.text();
    const json = JSON.parse(bodyText);
    expect(json.meta.filters_applied).toMatchObject({
      q_present: true,
      card_filter: 'all',
      sort: 'priority',
    });
    expect(json.meta.next_cursor).toEqual(expect.any(String));
    expect(json.meta.next_cursor).not.toContain('patient_sensitive');
    expect(json.meta.next_cursor).not.toContain(rawQuery);
    expect(bodyText).not.toContain(rawQuery);
  });

  it('applies q as a database-side patient name/kana filter before taking board rows', async () => {
    const response = (await GET(createRequest('?scope=all&q=%E4%BD%90%E8%97%A4'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
          OR: expect.arrayContaining([
            { name: { contains: '佐藤', mode: 'insensitive' } },
            { name_kana: { contains: '佐藤', mode: 'insensitive' } },
            expect.objectContaining({
              residences: expect.objectContaining({ some: expect.any(Object) }),
            }),
            expect.objectContaining({
              contacts: expect.objectContaining({ some: expect.any(Object) }),
            }),
            expect.objectContaining({
              cases: expect.objectContaining({ some: expect.any(Object) }),
            }),
          ]),
        }),
      }),
    );
    expect(patientCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { name: { contains: '佐藤', mode: 'insensitive' } },
          { name_kana: { contains: '佐藤', mode: 'insensitive' } },
        ]),
      }),
    });
  });

  it('combines q with a database-side prefilter for directly expressible foundation issues', async () => {
    const response = (await GET(
      createRequest('?scope=all&q=%E4%BD%90%E8%97%A4&foundation_issue=missing_insurance'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    const expectedInsurancePrefilter = {
      AND: [
        { OR: [{ medical_insurance_number: null }, { medical_insurance_number: '' }] },
        { OR: [{ care_insurance_number: null }, { care_insurance_number: '' }] },
      ],
    };
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
          OR: expect.arrayContaining([
            { name: { contains: '佐藤', mode: 'insensitive' } },
            { name_kana: { contains: '佐藤', mode: 'insensitive' } },
          ]),
          AND: [expectedInsurancePrefilter],
        }),
      }),
    );
    expect(patientCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { name: { contains: '佐藤', mode: 'insensitive' } },
          { name_kana: { contains: '佐藤', mode: 'insensitive' } },
        ]),
      }),
    });
  });

  it('prefilters consent and management-plan foundation gaps at the database boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

    const response = (await GET(createRequest('?scope=all&foundation_issue=missing_consent_plan'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    const prefilter = patientFindManyMock.mock.calls[0][0].where.AND[0];
    expect(prefilter).toMatchObject({
      OR: expect.arrayContaining([
        {
          consents: {
            none: expect.objectContaining({
              consent_type: 'visit_medication_management',
              is_active: true,
              revoked_date: null,
            }),
          },
        },
        {
          cases: {
            some: expect.objectContaining({
              management_plans: { none: expect.any(Object) },
            }),
          },
        },
        {
          cases: {
            some: expect.objectContaining({
              management_plans: {
                some: expect.objectContaining({
                  next_review_date: { lt: new Date('2026-06-12T00:00:00.000Z') },
                }),
              },
            }),
          },
        },
      ]),
    });
    expect(patientCountMock.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('rejects invalid board foundation issue values before querying patients', async () => {
    const response = (await GET(createRequest('?scope=all&foundation_issue=unknown'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'クエリパラメータが不正です',
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();
  });

  it('returns a fixed sensitive no-store error when board aggregate reads fail', async () => {
    patientFindManyMock.mockRejectedValueOnce(new Error('raw patient board failure'));

    const response = (await GET(createRequest('?scope=all'), {
      params: Promise.resolve({}),
    }))!;
    const body = await response.json();

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('サーバー内部でエラーが発生しました');
    expect(JSON.stringify(body)).not.toContain('raw patient board failure');
  });

  it.each([
    ['scope', '?scope=mine&scope=all', { scope: ['scope は1つだけ指定してください'] }],
    ['q', '?scope=all&q=a&q=b', { q: ['q は1つだけ指定してください'] }],
    ['limit', '?scope=all&limit=10&limit=20', { limit: ['limit は1つだけ指定してください'] }],
    ['cursor', '?scope=all&cursor=a&cursor=b', { cursor: ['cursor は1つだけ指定してください'] }],
    [
      'foundation_issue',
      '?scope=all&foundation_issue=missing_contact&foundation_issue=missing_care_team',
      { foundation_issue: ['foundation_issue は1つだけ指定してください'] },
    ],
  ])(
    'rejects duplicate board query parameter %s before querying patients',
    async (_name, search, details) => {
      const response = (await GET(createRequest(search), { params: Promise.resolve({}) }))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: 'クエリパラメータが不正です',
        details,
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(patientCountMock).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '101', 'abc'] as const)(
    'rejects invalid limit %s before querying patients',
    async (limit) => {
      const response = (await GET(createRequest(`?scope=all&limit=${limit}`), {
        params: Promise.resolve({}),
      }))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: 'クエリパラメータが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(patientCountMock).not.toHaveBeenCalled();
    },
  );
});
