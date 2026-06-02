import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  membershipFindManyMock,
  visitRecordFindManyMock,
  careReportFindManyMock,
  pharmacistShiftFindManyMock,
} = vi.hoisted(() => ({
  membershipFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          userId: 'admin_1',
          orgId: 'org_1',
          role: 'admin',
        }),
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findMany: membershipFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/admin/staff-metrics GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipFindManyMock.mockResolvedValue([
      {
        role: 'pharmacist',
        user: {
          id: 'user_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          email: 'yamada@example.com',
          max_weekly_visits: 12,
          max_travel_minutes: 90,
        },
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
      {
        role: 'pharmacist',
        user: {
          id: 'user_2',
          name: '鈴木 花子',
          name_kana: 'スズキ ハナコ',
          email: 'suzuki@example.com',
          max_weekly_visits: 8,
          max_travel_minutes: 60,
        },
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
    ]);
    visitRecordFindManyMock.mockResolvedValue([
      {
        pharmacist_id: 'user_1',
        patient_id: 'patient_1',
        schedule: {
          time_window_start: new Date('2026-03-03T09:00:00Z'),
          time_window_end: new Date('2026-03-03T10:00:00Z'),
        },
      },
      {
        pharmacist_id: 'user_1',
        patient_id: 'patient_2',
        schedule: {
          time_window_start: new Date('2026-03-05T09:00:00Z'),
          time_window_end: new Date('2026-03-05T09:45:00Z'),
        },
      },
      {
        pharmacist_id: 'user_2',
        patient_id: 'patient_3',
        schedule: {
          time_window_start: new Date('2026-03-04T09:00:00Z'),
          time_window_end: new Date('2026-03-04T09:30:00Z'),
        },
      },
    ]);
    careReportFindManyMock.mockResolvedValue([
      { created_by: 'user_1', visit_record_id: 'visit_1' },
      { created_by: 'user_1', visit_record_id: 'visit_2' },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        user_id: 'user_1',
        date: new Date('2026-03-03T00:00:00Z'),
        available_from: new Date('2026-03-03T00:00:00Z'),
        available_to: new Date('2026-03-03T08:00:00Z'),
      },
      {
        user_id: 'user_2',
        date: new Date('2026-03-04T00:00:00Z'),
        available_from: new Date('2026-03-04T00:00:00Z'),
        available_to: new Date('2026-03-04T06:00:00Z'),
      },
    ]);
  });

  it('returns staff KPI rows and summary balances', async () => {
    const response = await GET(
      createRequest('http://localhost/api/admin/staff-metrics?month=2026-03'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        month: '2026-03',
        summary: {
          total_staff: 2,
          avg_monthly_visits: 1.5,
          avg_report_submission_rate: 50,
        },
        items: [
          expect.objectContaining({
            id: 'user_1',
            monthly_visit_count: 2,
            assigned_patient_count: 2,
            report_submission_rate: 100,
            shift_days: 1,
          }),
          expect.objectContaining({
            id: 'user_2',
            monthly_visit_count: 1,
            assigned_patient_count: 1,
            report_submission_rate: 0,
            shift_days: 1,
          }),
        ],
      },
    });
  });

  it('trims a valid month query before building the date range', async () => {
    const response = await GET(
      createRequest('http://localhost/api/admin/staff-metrics?month=%202026-03%20'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visit_date: {
            gte: new Date(2026, 2, 1),
            lt: new Date(2026, 3, 1),
          },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        month: '2026-03',
      },
    });
  });

  it.each(['', '2026/03', '2026-00', '2026-13', '0001-03'])(
    'rejects invalid month query "%s" before loading staff data',
    async (month) => {
      const response = await GET(
        createRequest(`http://localhost/api/admin/staff-metrics?month=${month}`),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      expect(careReportFindManyMock).not.toHaveBeenCalled();
      expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('defaults to the current month when the month query is omitted', async () => {
    const response = await GET(createRequest('http://localhost/api/admin/staff-metrics'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalledOnce();
  });
});
