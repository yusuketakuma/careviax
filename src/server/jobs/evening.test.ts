import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitScheduleFindManyMock,
  visitRecordFindManyMock,
  notificationCreateMock,
  notificationCreateManyMock,
  runJobMock,
} = vi.hoisted(() => ({
  visitScheduleFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
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

import { checkUnrecordedVisits } from './evening';

describe('checkUnrecordedVisits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T18:00:00+09:00'));
    visitRecordFindManyMock.mockResolvedValue([]);
    notificationCreateMock.mockResolvedValue({});
    notificationCreateManyMock.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches unrecorded visit reminders with duplicate-safe keys', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
      },
      {
        id: 'schedule_2',
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_2',
      },
    ]);

    const result = await checkUnrecordedVisits();

    expect(result).toEqual({ processedCount: 2 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'pharmacist_1',
          link: '/visit-schedules/schedule_1',
          dedupe_key: 'unrecorded-visit:schedule_1:pharmacist_1',
        }),
        expect.objectContaining({
          user_id: 'pharmacist_2',
          link: '/visit-schedules/schedule_2',
          dedupe_key: 'unrecorded-visit:schedule_2:pharmacist_2',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('skips already recorded schedules and avoids empty notification writes', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
      },
    ]);
    visitRecordFindManyMock.mockResolvedValue([{ schedule_id: 'schedule_1' }]);

    const result = await checkUnrecordedVisits();

    expect(result).toEqual({ processedCount: 0 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).not.toHaveBeenCalled();
  });

  it('returns zero without checking visit records when no completed schedules exist', async () => {
    visitScheduleFindManyMock.mockResolvedValue([]);

    const result = await checkUnrecordedVisits();

    expect(result).toEqual({ processedCount: 0 });
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).not.toHaveBeenCalled();
  });
});
