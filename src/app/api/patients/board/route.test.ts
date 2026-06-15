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

function createRequest() {
  return new NextRequest('http://localhost/api/patients/board?scope=all');
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
      parking_available: false,
      care_level: 'care_3',
    },
    residences: [],
    lab_observations: [],
    cases: [
      {
        id: 'case_1',
        status: 'active',
        medication_cycles: [],
        visit_schedules: [
          {
            scheduled_date: scheduledDate,
            time_window_start: null,
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

    const select = patientFindManyMock.mock.calls[0][0].select;
    const scheduleWhere = select.cases.select.visit_schedules.where;
    expect(scheduleWhere.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  it('UTC 深夜で保存された当日の scheduled_date を「本日訪問」と判定する', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    // @db.Date 規約どおり UTC 深夜で保存された「今日」の予定
    patientFindManyMock.mockResolvedValue([buildPatientRow(new Date('2026-06-12T00:00:00.000Z'))]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data.chip_counts.visit_today).toBe(1);
    expect(json.data.cards[0]).toMatchObject({
      attention: 'visit_today',
      next_visit_date: '2026-06-12',
      operation_summary: ['準備未完', '連絡先あり', '駐車場なし', '要介護 3'],
    });
    expect(JSON.stringify(json.data.cards[0])).not.toContain('090-1111-2222');
  });
});
