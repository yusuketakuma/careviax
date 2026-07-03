import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  visitScheduleFindManyMock,
  workflowExceptionFindManyMock,
  dispenseTaskFindManyMock,
  facilityFindManyMock,
  visitRecordCountMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  visitScheduleFindManyMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  visitRecordCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: { findMany: visitScheduleFindManyMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    facility: { findMany: facilityFindManyMock },
    visitRecord: { count: visitRecordCountMock },
  },
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const ORIGINAL_TZ = process.env.TZ;

function createRequest() {
  return new NextRequest('http://localhost/api/visits/today-preparation');
}

function buildSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule_1',
    time_window_start: new Date(Date.UTC(1970, 0, 1, 10, 0)),
    time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 45)),
    route_order: 1,
    pre_visit_checklist_completed: true,
    facility_batch_id: null,
    facility_batch: null,
    vehicle_resource: { label: '訪問車1' },
    preparation: {
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      prepared_at: new Date('2026-06-12T08:30:00+09:00'),
      updated_at: new Date('2026-06-12T08:30:00+09:00'),
    },
    case_: {
      required_visit_support: null,
      care_team_links: [
        {
          role: 'physician',
          is_primary: true,
          phone: '03-0000-0001',
          email: null,
          fax: '03-0000-0002',
        },
        {
          role: 'nurse',
          is_primary: true,
          phone: '03-0000-0003',
          email: null,
          fax: '03-0000-0004',
        },
        {
          role: 'care_manager',
          is_primary: true,
          phone: '03-0000-0005',
          email: null,
          fax: '03-0000-0006',
        },
      ],
      patient: {
        id: 'patient_1',
        name: '患者A',
        allergy_info: null,
        contacts: [
          {
            is_primary: true,
            is_emergency_contact: true,
            phone: '090-0000-0001',
            email: null,
            fax: null,
          },
        ],
        scheduling_preference: {
          swallowing_route: null,
          preferred_contact_name: null,
          preferred_contact_phone: null,
          visit_before_contact_required: true,
          parking_available: true,
          care_level: '要介護2',
        },
      },
    },
    cycle: {
      overall_status: 'set_audited',
      prescription_intakes: [{ lines: [] }],
      dispense_tasks: [],
    },
    ...overrides,
  };
}

const EXPECTED_CARD_KEYS = [
  'accent',
  'actions',
  'checks',
  'is_facility',
  'meta_label',
  'note',
  'note_tone',
  'patient_count',
  'prep_done',
  'prep_total',
  'safety_tags',
  'schedule_id',
  'time_label',
  'title',
  'visit_mode_href',
];

describe('/api/visits/today-preparation', () => {
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
    visitScheduleFindManyMock.mockResolvedValue([]);
    workflowExceptionFindManyMock.mockResolvedValue([]);
    dispenseTaskFindManyMock.mockResolvedValue([]);
    facilityFindManyMock.mockResolvedValue([]);
    visitRecordCountMock.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty preparation board when there are no schedules', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.cards).toEqual([]);
    expect(json.data.visit_count).toBe(0);
    expect(json.data.facility_patient_count).toBe(0);
  });

  it('redacts workflow exception free text from the visit preparation board blockers', async () => {
    workflowExceptionFindManyMock.mockResolvedValue([
      {
        id: 'exception_1',
        exception_type: 'dispense_audit_rejected',
        description: '患者A の ワルファリン 監査差戻し詳細を確認してください',
        severity: 'critical',
        created_at: new Date('2026-06-12T07:50:00+09:00'),
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(workflowExceptionFindManyMock.mock.calls[0][0].select).toEqual({
      id: true,
      exception_type: true,
      patient_id: true,
      severity: true,
      created_at: true,
    });
    const json = await response.json();
    expect(json.data.blocked_reasons).toEqual([
      expect.objectContaining({
        id: 'exception_1',
        label: '対応が必要な未解決項目があります',
        severity: 'critical',
        category: '調剤',
        action_label: '状況を見る →',
        action_href: '/dispense',
      }),
    ]);
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('患者A');
    expect(serialized).not.toContain('ワルファリン');
    expect(serialized).not.toContain('監査差戻し詳細');
  });

  it('JST 朝(UTC では前日)でも scheduled_date(@db.Date)をローカル日付の UTC レンジで比較する', async () => {
    vi.useFakeTimers();
    // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls[0][0].where;
    expect(where.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(where.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });

  it('adds a departure warning when a home visit has patient foundation gaps', async () => {
    const rawScheduleId = 'schedule/1?mode=x#frag';
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientHref = `/patients/${encodeURIComponent(rawPatientId)}`;
    const encodedVisitModeHref = `/visits/${encodeURIComponent(rawScheduleId)}/record`;

    visitScheduleFindManyMock.mockResolvedValue([
      buildSchedule({
        id: rawScheduleId,
        case_: {
          care_team_links: [],
          patient: {
            id: rawPatientId,
            name: '患者A',
            allergy_info: null,
            contacts: [],
            scheduling_preference: {
              swallowing_route: null,
              preferred_contact_name: null,
              preferred_contact_phone: null,
              visit_before_contact_required: true,
              parking_available: null,
              care_level: null,
            },
          },
        },
      }),
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    const json = await response.json();

    expect(json.data.cards).toHaveLength(1);
    expect(json.data.cards[0]).toEqual(
      expect.objectContaining({
        accent: 'caution',
        note: '出発前に正本確認: 訪問前連絡先・駐車可否・介護度 ほか1件',
        note_tone: 'warning',
        schedule_id: rawScheduleId,
        time_label: '10:00',
        visit_mode_href: encodedVisitModeHref,
      }),
    );
    expect(json.data.cards[0].actions).toEqual([
      { label: 'カードへ', href: encodedPatientHref },
      {
        label: 'ルート詳細',
        href: `/schedules?focus=schedule&schedule_id=${encodeURIComponent(rawScheduleId)}`,
      },
    ]);
    expect(JSON.stringify(json)).not.toContain(`/visits/${rawScheduleId}/record`);
  });

  it('encodes the audit-branch patient card action while keeping the audit action', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientHref = `/patients/${encodeURIComponent(rawPatientId)}`;

    visitScheduleFindManyMock.mockResolvedValue([
      buildSchedule({
        case_: {
          patient: {
            id: rawPatientId,
            name: '患者A',
            allergy_info: null,
            contacts: [
              {
                is_primary: true,
                is_emergency_contact: true,
                phone: '090-0000-0001',
                email: null,
                fax: null,
              },
            ],
            scheduling_preference: {
              swallowing_route: null,
              preferred_contact_name: null,
              preferred_contact_phone: null,
              visit_before_contact_required: true,
              parking_available: true,
              care_level: '要介護2',
            },
          },
        },
        cycle: {
          overall_status: 'audit_pending',
          prescription_intakes: [
            {
              lines: [{ packaging_instruction_tags: ['narcotic'], dispensing_method: null }],
            },
          ],
          dispense_tasks: [{ due_date: null, audits: [] }],
        },
      }),
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.cards).toHaveLength(1);
    expect(json.data.cards[0].checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'carry-narcotic',
          state: 'alert',
        }),
      ]),
    );
    expect(json.data.cards[0]).toEqual(
      expect.objectContaining({
        note: '監査が間に合わない場合: 11:00繰り下げ案を反映できます(スケジュールで調整)',
        time_label: '10:00',
      }),
    );
    expect(json.data.cards[0].actions).toEqual([
      { label: '監査へ', href: '/audit' },
      { label: 'カードへ', href: encodedPatientHref },
    ]);
  });

  it('adds only categorical home-visit-intake safety tags to a home visit card', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      buildSchedule({
        case_: {
          required_visit_support: {
            home_visit_intake: {
              special_medical_procedures: [
                'tpn',
                'home_oxygen',
                'narcotics',
                'unregistered procedure free text',
              ],
              special_medical_notes: '中心静脈カテーテルの自由記載メモは出さない',
              narcotics_base: true,
              narcotics_rescue: false,
              infection_isolation: 'contact',
            },
          },
          care_team_links: [
            {
              role: 'physician',
              is_primary: true,
              phone: '03-0000-0001',
              email: null,
              fax: '03-0000-0002',
            },
          ],
          patient: {
            id: 'patient_1',
            name: '患者A',
            allergy_info: null,
            contacts: [
              {
                is_primary: true,
                is_emergency_contact: true,
                phone: '090-0000-0001',
                email: null,
                fax: null,
              },
            ],
            scheduling_preference: {
              swallowing_route: null,
              preferred_contact_name: null,
              preferred_contact_phone: null,
              visit_before_contact_required: true,
              parking_available: true,
              care_level: '要介護2',
            },
          },
        },
      }),
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock.mock.calls[0][0].select.case_.select).toEqual(
      expect.objectContaining({ required_visit_support: true }),
    );
    expect(Object.keys(json.data.cards[0]).sort()).toEqual(EXPECTED_CARD_KEYS);
    expect(json.data.cards[0].safety_tags).toEqual([
      'narcotic',
      'infection_isolation',
      'procedure:home_oxygen',
      'procedure:tpn',
    ]);
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('中心静脈カテーテルの自由記載メモ');
    expect(serialized).not.toContain('unregistered procedure free text');
    expect(serialized).not.toContain('special_medical_notes');
    expect(serialized).not.toContain('090-0000-0001');
  });

  it('adds a facility packet warning when one batched patient has foundation gaps', async () => {
    const rawLeadScheduleId = 'facility-schedule/1?mode=x#frag';
    const encodedVisitModeHref = `/visits/${encodeURIComponent(rawLeadScheduleId)}/record`;

    visitScheduleFindManyMock.mockResolvedValue([
      buildSchedule({
        id: rawLeadScheduleId,
        facility_batch_id: 'batch_1',
        facility_batch: {
          id: 'batch_1',
          facility_id: 'facility_1',
          patient_ids: ['patient_1', 'patient_2'],
          estimated_duration: 90,
        },
        case_: {
          care_team_links: [],
          patient: {
            id: 'patient_1',
            name: '患者A',
            allergy_info: null,
            contacts: [],
            scheduling_preference: {
              swallowing_route: null,
              preferred_contact_name: null,
              preferred_contact_phone: null,
              visit_before_contact_required: true,
              parking_available: null,
              care_level: null,
            },
          },
        },
      }),
      buildSchedule({
        id: 'schedule_2',
        facility_batch_id: 'batch_1',
        facility_batch: {
          id: 'batch_1',
          facility_id: 'facility_1',
          patient_ids: ['patient_1', 'patient_2'],
          estimated_duration: 90,
        },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([{ id: 'facility_1', name: 'グリーンヒル' }]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    const json = await response.json();

    expect(json.data.cards).toHaveLength(1);
    expect(json.data.cards[0]).toEqual(
      expect.objectContaining({
        title: '施設グリーンヒル',
        patient_count: 2,
        schedule_id: rawLeadScheduleId,
        visit_mode_href: encodedVisitModeHref,
        prep_done: 4,
        prep_total: 4,
        accent: 'caution',
        note: '正本未確認の患者が1名います — 出発前に患者カードで確認してください',
        note_tone: 'warning',
      }),
    );
    expect(json.data.cards[0].actions).toEqual([
      { label: 'セットへ', href: '/set' },
      {
        label: '施設パケット',
        href: `/schedules?focus=schedule&schedule_id=${encodeURIComponent(rawLeadScheduleId)}`,
      },
    ]);
    expect(JSON.stringify(json)).not.toContain(`/visits/${rawLeadScheduleId}/record`);
  });

  it('aggregates categorical home-visit-intake safety tags across facility visit patients', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      buildSchedule({
        id: 'schedule_facility_1',
        facility_batch_id: 'batch_1',
        facility_batch: {
          id: 'batch_1',
          facility_id: 'facility_1',
          patient_ids: ['patient_1', 'patient_2'],
          estimated_duration: 90,
        },
        case_: {
          required_visit_support: {
            home_visit_intake: {
              special_medical_procedures: ['tpn'],
              special_medical_notes: '施設患者1のメモは出さない',
              infection_isolation: 'droplet',
            },
          },
          care_team_links: [],
          patient: {
            id: 'patient_1',
            name: '患者A',
            allergy_info: null,
            contacts: [
              {
                is_primary: true,
                is_emergency_contact: true,
                phone: '090-0000-0001',
                email: null,
                fax: null,
              },
            ],
            scheduling_preference: {
              swallowing_route: null,
              preferred_contact_name: null,
              preferred_contact_phone: null,
              visit_before_contact_required: true,
              parking_available: true,
              care_level: '要介護2',
            },
          },
        },
      }),
      buildSchedule({
        id: 'schedule_facility_2',
        facility_batch_id: 'batch_1',
        facility_batch: {
          id: 'batch_1',
          facility_id: 'facility_1',
          patient_ids: ['patient_1', 'patient_2'],
          estimated_duration: 90,
        },
        case_: {
          required_visit_support: {
            home_visit_intake: {
              special_medical_procedures: ['home_oxygen'],
              narcotics_rescue: true,
            },
          },
          care_team_links: [],
          patient: {
            id: 'patient_2',
            name: '患者B',
            allergy_info: null,
            contacts: [
              {
                is_primary: true,
                is_emergency_contact: true,
                phone: '090-0000-0002',
                email: null,
                fax: null,
              },
            ],
            scheduling_preference: {
              swallowing_route: null,
              preferred_contact_name: null,
              preferred_contact_phone: null,
              visit_before_contact_required: true,
              parking_available: true,
              care_level: '要介護1',
            },
          },
        },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([{ id: 'facility_1', name: 'グリーンヒル' }]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.cards).toHaveLength(1);
    expect(json.data.cards[0].safety_tags).toEqual([
      'narcotic',
      'infection_isolation',
      'procedure:home_oxygen',
      'procedure:tpn',
    ]);
    expect(JSON.stringify(json)).not.toContain('施設患者1のメモ');
  });

  it('returns a fixed no-store 500 when the preparation board aggregation fails', async () => {
    visitScheduleFindManyMock.mockRejectedValueOnce(
      new Error('患者A 保険番号 123456789 の訪問準備集計に失敗しました'),
    );

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('患者A');
    expect(serialized).not.toContain('123456789');
    expect(serialized).not.toContain('訪問準備集計');
  });

  it('rethrows Next.js control-flow errors instead of converting them to a fixed 500', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    visitScheduleFindManyMock.mockRejectedValueOnce(redirectError);

    await expect(GET(createRequest(), { params: Promise.resolve({}) })).rejects.toBe(redirectError);
  });

  it.each(['.', '..'])(
    'returns a fixed no-store 500 when a home visit_mode_href is built from a dot-segment schedule id (%s)',
    async (dotScheduleId) => {
      visitScheduleFindManyMock.mockResolvedValue([buildSchedule({ id: dotScheduleId })]);

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

      expect(response.status).toBe(500);
      expectSensitiveNoStore(response);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(dotScheduleId);
      expect(serialized).not.toContain('患者A');
    },
  );

  it.each(['.', '..'])(
    'returns a fixed no-store 500 when a facility visit_mode_href is built from a dot-segment lead schedule id (%s)',
    async (dotScheduleId) => {
      visitScheduleFindManyMock.mockResolvedValue([
        buildSchedule({
          id: dotScheduleId,
          facility_batch_id: 'batch_1',
          facility_batch: {
            id: 'batch_1',
            facility_id: 'facility_1',
            patient_ids: ['patient_1', 'patient_2'],
            estimated_duration: 90,
          },
        }),
      ]);
      facilityFindManyMock.mockResolvedValue([{ id: 'facility_1', name: 'グリーンヒル' }]);

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

      expect(response.status).toBe(500);
      expectSensitiveNoStore(response);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(dotScheduleId);
      expect(serialized).not.toContain('患者A');
    },
  );
});
