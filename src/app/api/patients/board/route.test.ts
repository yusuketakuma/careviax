import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function buildPatientRow(scheduledDate: Date) {
  return {
    id: 'patient_1',
    name: '佐藤 花子',
    birth_date: new Date('1940-01-15T00:00:00.000Z'),
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
    cases: [
      {
        id: 'case_1',
        status: 'active',
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
    expect(select.contacts.select).toMatchObject({
      is_primary: true,
      is_emergency_contact: true,
      phone: true,
      email: true,
      fax: true,
    });
    expect(select.cases.select.care_team_links.select).toMatchObject({
      role: true,
      phone: true,
      email: true,
      fax: true,
      is_primary: true,
    });
    expect(select.residences.select).toEqual({
      facility_id: true,
      building_id: true,
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

    const json = await response.json();
    expect(json.data.chip_counts.visit_today).toBe(1);
    expect(json.data.cards[0]).toMatchObject({
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
    expect(JSON.stringify(json.data.cards[0])).not.toContain('090-1111-2222');
    // assigned_total(1) === displayed(1) → not truncated
    expect(json.data.truncated).toBe(false);
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
      expect(json.data.chip_counts.visit_today).toBe(1);
      expect(json.data.today_visit_count).toBe(1);
      expect(json.data.cards[0]).toMatchObject({
        attention: 'visit_today',
        next_visit_date: '2026-06-12',
        next_visit_time: '09:00',
      });
      expect(json.data.cards[1]).toMatchObject({
        patient_id: 'patient_future',
        attention: 'steady',
        next_visit_date: '2026-06-13',
        operation_summary: ['連絡先あり', '駐車場なし', '要介護 3'],
      });
      expect(json.data.cards[1].operation_summary).not.toContain('準備未完');
      expect(json.data.cards[1].operation_summary).not.toContain('訪問準備済');
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('flags truncated when more patients exist than the name-ordered fetch returns', async () => {
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([buildPatientRow(new Date('2026-06-12T00:00:00.000Z'))]);
    // 30 assigned patients but the name-ordered fetch returned 1 card → board is truncated,
    // so a high-priority patient beyond the fetch limit could be hidden.
    patientCountMock.mockResolvedValue(30);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.assigned_total).toBe(30);
    expect(json.data.cards.length).toBe(1);
    expect(json.data.truncated).toBe(true);
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
      json.data.cards.map((card: { patient_id: string }) => [card.patient_id, card]),
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
    expect(JSON.stringify(json.data.cards)).not.toContain(`/patients/${fallbackPatientId}`);
    expect(JSON.stringify(json.data.cards)).not.toContain(`/patients/${staticLinkPatientId}`);
    expect(JSON.stringify(json.data.cards)).not.toContain(scheduleId);
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
    expect(json.data.cards[0]).not.toHaveProperty('address');
    expect(json.data.cards[0]).toMatchObject({
      patient_id: 'patient_1',
      residence_kind: 'home',
      residence_label: '在宅',
    });
    expect(JSON.stringify(json.data)).not.toContain('東京都千代田区丸の内1-1-1');
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
    expect(json.data.cards[0]).toMatchObject({
      residence_kind: 'facility',
      residence_label: '施設',
    });
    expect(JSON.stringify(json.data)).not.toContain('青空レジデンス丸の内');
    expect(JSON.stringify(json.data)).not.toContain('丸の内');
    expect(JSON.stringify(json.data)).not.toContain('東京都千代田区');
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
      expect(json.data.cards[0]).toMatchObject({
        status_text: '本日訪問 — 出発前チェックを確認',
        operation_summary: ['準備未完', '連絡先あり', '駐車場なし', '要介護 3'],
        foundation_summary: {
          status: 'needs_confirmation',
          label: '未確認1件',
          items: ['訪問準備未完'],
        },
      });
      expect(JSON.stringify(json.data.cards[0])).not.toContain('訪問準備済');
      expect(JSON.stringify(json.data.cards[0])).not.toContain('準備完了');
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
    expect(json.data.cards[0]).toMatchObject({
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
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 500,
      }),
    );
    const json = await response.json();
    expect(json.data.cards).toHaveLength(1);
    expect(json.data.cards[0]).toMatchObject({
      patient_id: 'patient_missing_contact',
      foundation_summary: {
        items: expect.arrayContaining(['連絡先未設定']),
      },
    });
    // foundation_issue filter reduced cards to 1 of 2 FETCHED, but the fetch was NOT
    // capped (assigned_total 2 === fetched 2) — filtering is not truncation.
    expect(json.data.assigned_total).toBe(2);
    expect(json.data.truncated).toBe(false);
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
});
