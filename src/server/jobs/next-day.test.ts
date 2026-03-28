import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitRecordFindManyMock,
  businessHolidayFindManyMock,
  careReportFindManyMock,
  notificationCreateMock,
  runJobMock,
} = vi.hoisted(() => ({
  visitRecordFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db', () => ({
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags reports whose next business day is today', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'vr_friday',
        org_id: 'org_1',
        patient_id: 'patient_1',
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
    expect(notificationCreateMock).toHaveBeenCalledTimes(2);
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
  });
});
