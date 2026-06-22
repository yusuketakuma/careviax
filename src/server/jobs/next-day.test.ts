import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitRecordFindManyMock,
  businessHolidayFindManyMock,
  careReportFindManyMock,
  notificationCreateMock,
  notificationCreateManyMock,
  runJobMock,
} = vi.hoisted(() => ({
  visitRecordFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    notification: {
      create: notificationCreateMock,
      createMany: notificationCreateManyMock,
    },
  },
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { checkUnsentReports } from './next-day';

describe('checkUnsentReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:00:00.000Z'));
    businessHolidayFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    notificationCreateMock.mockResolvedValue({});
    notificationCreateManyMock.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags reports whose next business day is today', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientReportsHref = `/patients/${encodeURIComponent(rawPatientId)}/reports`;

    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'vr_friday',
        org_id: 'org_1',
        patient_id: rawPatientId,
        pharmacist_id: 'pharmacist_1',
        schedule_id: 'schedule_1',
        visit_date: new Date('2026-03-27T03:00:00.000Z'),
      },
      {
        id: 'vr_saturday',
        org_id: 'org_1',
        patient_id: 'patient_2',
        pharmacist_id: 'pharmacist_2',
        schedule_id: 'schedule_2',
        visit_date: new Date('2026-03-28T03:00:00.000Z'),
      },
    ]);

    const result = await checkUnsentReports();

    expect(result).toMatchObject({
      processedCount: 2,
      overdueVisitRecordIds: ['vr_friday', 'vr_saturday'],
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    const [{ data: notifications }] = notificationCreateManyMock.mock.calls[0] as [
      {
        data: Array<{
          dedupe_key: string;
          link: string;
        }>;
      },
    ];
    expect(notifications.find((item) => item.dedupe_key === 'unsent-report:vr_friday')?.link).toBe(
      encodedPatientReportsHref,
    );
    expect(
      notifications.find((item) => item.dedupe_key === 'unsent-report:vr_saturday')?.link,
    ).toBe('/patients/patient_2/reports');
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'pharmacist_1',
          link: encodedPatientReportsHref,
          dedupe_key: 'unsent-report:vr_friday',
        }),
        expect.objectContaining({
          user_id: 'pharmacist_2',
          link: '/patients/patient_2/reports',
          dedupe_key: 'unsent-report:vr_saturday',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('defers reminders when the upcoming weekday is an org holiday', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'vr_friday',
        org_id: 'org_1',
        patient_id: 'patient_1',
        pharmacist_id: 'pharmacist_1',
        schedule_id: 'schedule_1',
        visit_date: new Date('2026-03-27T03:00:00.000Z'),
      },
    ]);
    businessHolidayFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        date: new Date('2026-03-30T00:00:00.000Z'),
      },
    ]);

    const result = await checkUnsentReports();

    expect(result).toMatchObject({
      processedCount: 0,
      overdueVisitRecordIds: [],
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).not.toHaveBeenCalled();
  });

  it('matches holidays stored at local midnight without shifting the date key', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'vr_friday',
        org_id: 'org_1',
        patient_id: 'patient_1',
        pharmacist_id: 'pharmacist_1',
        schedule_id: 'schedule_1',
        visit_date: new Date('2026-03-27T03:00:00.000Z'),
      },
    ]);
    businessHolidayFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        date: new Date(2026, 2, 30),
      },
    ]);

    const result = await checkUnsentReports();

    expect(result).toMatchObject({
      processedCount: 0,
      overdueVisitRecordIds: [],
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).not.toHaveBeenCalled();
  });
});
