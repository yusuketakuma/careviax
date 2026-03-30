import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  conferenceNoteFindManyMock,
  settingUpsertMock,
  runJobMock,
} = vi.hoisted(() => ({
  conferenceNoteFindManyMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db', () => ({
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
      })
    );
  });
});
