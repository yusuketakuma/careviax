import { describe, expect, it, vi } from 'vitest';
import type { OfflineVisitBriefCache } from '@/lib/stores/offline-db';
import type { CachedVisitBriefCard } from '@/lib/visits/visit-brief-cache';
import type { VisitSchedule } from './day-view.shared';
import {
  fetchMissingScheduleDayVisitBriefCards,
  mergeScheduleDayCachedVisitBriefCards,
  readScheduleDayCachedVisitBriefs,
  saveScheduleDayVisitBriefCards,
  type ScheduleDayVisitBriefCacheRepository,
} from './schedule-day-visit-brief-cache';

const selectedDate = '2026-04-09';

function buildCachedCard(overrides: Partial<CachedVisitBriefCard> = {}): CachedVisitBriefCard {
  return {
    scheduleId: 'schedule_1',
    patientId: 'patient_1',
    patientName: 'Patient One',
    scheduledDate: selectedDate,
    timeWindowStart: '2026-04-09T09:00:00.000Z',
    timeWindowEnd: '2026-04-09T10:00:00.000Z',
    priority: 'normal',
    facilityLabel: null,
    siteName: null,
    headline: 'Check medication',
    mustCheckToday: [],
    sourceRefs: [],
    generatedAt: '2026-04-09T08:00:00.000Z',
    provider: 'rule',
    isFallback: false,
    ...overrides,
  };
}

function buildSchedule(overrides: Partial<VisitSchedule> = {}): VisitSchedule {
  const id = overrides.id ?? 'schedule_1';
  return {
    id,
    case_: {
      patient: {
        id: `patient_${id}`,
        name: `Patient ${id}`,
        residences: [{ address: `Address ${id}`, lat: 35.1, lng: 139.1 }],
      },
    },
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    priority: 'normal',
    facility_hint: null,
    site: null,
    ...overrides,
  } as VisitSchedule;
}

function buildRepository(
  rows: OfflineVisitBriefCache[] = [],
): ScheduleDayVisitBriefCacheRepository & {
  deletedIds: number[];
  replacements: Array<{
    selectedDate: string;
    card: CachedVisitBriefCard;
    encryptedPayload: string;
    updatedAt: Date;
  }>;
} {
  const deletedIds: number[] = [];
  const replacements: Array<{
    selectedDate: string;
    card: CachedVisitBriefCard;
    encryptedPayload: string;
    updatedAt: Date;
  }> = [];

  return {
    deletedIds,
    replacements,
    loadByScheduledDate: vi.fn(async () => rows),
    deleteById: vi.fn(async (id: number) => {
      deletedIds.push(id);
    }),
    replaceForScheduleDate: vi.fn(async (input) => {
      replacements.push(input);
    }),
  };
}

describe('schedule day visit brief cache helpers', () => {
  it('loads fresh cache rows and deletes stale or malformed rows', async () => {
    const earlyCard = buildCachedCard({
      scheduleId: 'schedule_early',
      timeWindowStart: '2026-04-09T08:30:00.000Z',
    });
    const lateCard = buildCachedCard({
      scheduleId: 'schedule_late',
      timeWindowStart: '2026-04-09T10:00:00.000Z',
    });
    const repository = buildRepository([
      {
        id: 1,
        scheduleId: 'schedule_stale',
        patientId: 'patient_stale',
        scheduledDate: selectedDate,
        payload: JSON.stringify(buildCachedCard({ scheduleId: 'schedule_stale' })),
        updatedAt: new Date('2026-04-07T08:00:00.000Z'),
      },
      {
        id: 2,
        scheduleId: 'schedule_malformed',
        patientId: 'patient_malformed',
        scheduledDate: selectedDate,
        payload: JSON.stringify({ ...buildCachedCard(), timeWindowStart: 'not-a-date' }),
        updatedAt: new Date('2026-04-09T08:00:00.000Z'),
      },
      {
        id: 3,
        scheduleId: lateCard.scheduleId,
        patientId: lateCard.patientId,
        scheduledDate: selectedDate,
        payload: JSON.stringify(lateCard),
        updatedAt: new Date('2026-04-09T08:05:00.000Z'),
      },
      {
        id: 4,
        scheduleId: earlyCard.scheduleId,
        patientId: earlyCard.patientId,
        scheduledDate: selectedDate,
        payload: JSON.stringify(earlyCard),
        updatedAt: new Date('2026-04-09T08:10:00.000Z'),
      },
    ]);

    const result = await readScheduleDayCachedVisitBriefs({
      selectedDate,
      repository,
      decryptPayload: async (payload) => payload,
      isFresh: (updatedAt) => updatedAt >= new Date('2026-04-09T00:00:00.000Z'),
    });

    expect(repository.deletedIds).toEqual([1, 2]);
    expect(result.loadedDate).toBe(selectedDate);
    expect(result.updatedAt).toBe('2026-04-09T08:10:00.000Z');
    expect(result.cards.map((card) => card.scheduleId)).toEqual([
      'schedule_early',
      'schedule_late',
    ]);
  });

  it('fetches only missing visit brief cards and maps schedule context', async () => {
    const cached = buildCachedCard({ scheduleId: 'schedule_cached' });
    const fetchBatch = vi.fn(async () => ({
      data: {
        schedule_missing_late: {
          ai_summary: {
            headline: 'Late visit',
            must_check_today: ['Bring medication'],
            source_refs: ['ref_late'],
            generated_at: '2026-04-09T08:30:00.000Z',
            provider: 'openai' as const,
            is_fallback: false,
          },
        },
        schedule_missing_early: {
          ai_summary: {
            headline: 'Early visit',
            must_check_today: [],
            source_refs: [],
            generated_at: '2026-04-09T08:00:00.000Z',
            provider: 'rule' as const,
            is_fallback: true,
          },
        },
      },
    }));

    const cards = await fetchMissingScheduleDayVisitBriefCards({
      orgId: 'org_1',
      selectedDate,
      schedules: [
        buildSchedule({ id: 'schedule_cached' }),
        buildSchedule({
          id: 'schedule_missing_late',
          time_window_start: '2026-04-09T11:00:00.000Z',
          facility_hint: { label: 'Facility A' } as VisitSchedule['facility_hint'],
          site: { name: 'Site A' } as VisitSchedule['site'],
        }),
        buildSchedule({
          id: 'schedule_missing_early',
          time_window_start: '2026-04-09T09:00:00.000Z',
          case_: {
            patient: {
              id: 'patient_early',
              name: 'Early Patient',
              residences: [{ address: 'Fallback Address', lat: null, lng: null }],
            },
          } as VisitSchedule['case_'],
        }),
      ],
      cachedVisitBriefByScheduleId: new Map([[cached.scheduleId, cached]]),
      fetchBatch,
    });

    expect(fetchBatch).toHaveBeenCalledWith({
      orgId: 'org_1',
      scheduleIds: ['schedule_missing_late', 'schedule_missing_early'],
    });
    expect(cards.map((card) => card.scheduleId)).toEqual([
      'schedule_missing_early',
      'schedule_missing_late',
    ]);
    expect(cards[0]).toMatchObject({
      patientId: 'patient_early',
      patientName: 'Early Patient',
      facilityLabel: 'Fallback Address',
      headline: 'Early visit',
      provider: 'rule',
      isFallback: true,
    });
    expect(cards[1]).toMatchObject({
      facilityLabel: 'Facility A',
      siteName: 'Site A',
      headline: 'Late visit',
      provider: 'openai',
    });
  });

  it('encrypts and replaces fetched visit brief cache cards with a shared updated timestamp', async () => {
    const repository = buildRepository();
    const card = buildCachedCard({ scheduleId: 'schedule_1' });
    const encryptPayload = vi.fn(async (payload: string, context: string) => {
      return `encrypted:${context}:${payload}`;
    });

    const updatedAt = await saveScheduleDayVisitBriefCards({
      selectedDate,
      cards: [card],
      repository,
      encryptPayload,
      now: () => new Date('2026-04-09T09:15:00.000Z'),
    });

    expect(updatedAt).toBe('2026-04-09T09:15:00.000Z');
    expect(encryptPayload).toHaveBeenCalledWith(JSON.stringify(card), 'visit brief cache payload');
    expect(repository.replacements).toHaveLength(1);
    expect(repository.replacements[0]).toMatchObject({
      selectedDate,
      card,
      encryptedPayload: `encrypted:visit brief cache payload:${JSON.stringify(card)}`,
      updatedAt: new Date('2026-04-09T09:15:00.000Z'),
    });
  });

  it('merges incoming cards for the selected date and drops cards from other dates', () => {
    const merged = mergeScheduleDayCachedVisitBriefCards({
      selectedDate,
      previous: [
        buildCachedCard({
          scheduleId: 'schedule_replace',
          timeWindowStart: '2026-04-09T12:00:00.000Z',
          headline: 'Old',
        }),
        buildCachedCard({
          scheduleId: 'schedule_other_date',
          scheduledDate: '2026-04-10',
        }),
      ],
      incoming: [
        buildCachedCard({
          scheduleId: 'schedule_new',
          timeWindowStart: '2026-04-09T10:00:00.000Z',
        }),
        buildCachedCard({
          scheduleId: 'schedule_replace',
          timeWindowStart: '2026-04-09T09:00:00.000Z',
          headline: 'Replacement',
        }),
      ],
    });

    expect(merged.map((card) => card.scheduleId)).toEqual(['schedule_replace', 'schedule_new']);
    expect(merged[0].headline).toBe('Replacement');
  });
});
