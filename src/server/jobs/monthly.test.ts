import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { conferenceNoteFindManyMock, settingUpsertMock, runJobMock } = vi.hoisted(() => ({
  conferenceNoteFindManyMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
    },
    setting: {
      upsert: settingUpsertMock,
    },
  },
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { aggregateConferenceQualityIndicators } from './monthly';

describe('aggregateConferenceQualityIndicators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T00:00:00.000Z'));
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_1',
        org_id: 'org_1',
        structured_content: {
          sections: [
            ['unexpected'],
            {
              key: 123,
              label: '不正',
              body: '集計しない',
            },
            {
              key: 'quality_indicators',
              label: '品質指標',
              body: 123,
            },
            {
              key: 'quality_indicators',
              label: '品質指標',
              body: '看取り後カンファ実施\n家族説明記録完備',
            },
          ],
        },
      },
      {
        id: 'note_2',
        org_id: 'org_1',
        structured_content: {
          sections: [
            {
              key: 'quality_indicators',
              label: '品質指標',
              body: '看取り後カンファ実施',
            },
          ],
        },
      },
    ]);
    settingUpsertMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates death conference quality indicator lines into a monthly organization setting', async () => {
    const result = await aggregateConferenceQualityIndicators();

    expect(result).toMatchObject({
      processedCount: 1,
      month: '2026-03',
    });
    expect(settingUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scope_scope_id_key: {
            scope: 'organization',
            scope_id: 'org_1',
            key: 'conference_quality_indicators:2026-03',
          },
        },
        create: expect.objectContaining({
          value: expect.objectContaining({
            month: '2026-03',
            total_notes: 2,
            total_indicators: 3,
            indicator_counts: {
              看取り後カンファ実施: 2,
              家族説明記録完備: 1,
            },
          }),
        }),
      }),
    );
  });

  it('windows the previous JST month even when the UTC month differs, on a UTC runtime (CXR2-TZ02)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // UTC 2026-06-30T20:00Z = JST 2026-07-01 05:00。JST の「先月」は 2026-06。
      // サーバーローカル(UTC)だと現在月が 6 月扱いになり、先月を 2026-05 と誤算していた。
      vi.setSystemTime(new Date('2026-06-30T20:00:00.000Z'));

      const result = await aggregateConferenceQualityIndicators();
      expect(result).toMatchObject({ month: '2026-06' });

      // conference_date(実時刻)は JST 2026-06 の実時刻レンジ(半開区間)
      const where = conferenceNoteFindManyMock.mock.calls.at(-1)?.[0]?.where;
      expect(where.conference_date.gte.toISOString()).toBe('2026-05-31T15:00:00.000Z');
      expect(where.conference_date.lt.toISOString()).toBe('2026-06-30T15:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
