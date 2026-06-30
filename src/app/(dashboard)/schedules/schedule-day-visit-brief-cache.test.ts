import { describe, expect, it, vi } from 'vitest';
import type { OfflineVisitBriefCache } from '@/lib/stores/offline-db';
import {
  parseCachedVisitBriefCardPayload,
  type CachedVisitBriefCard,
} from '@/lib/visits/visit-brief-cache';
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
    latestLabs: [],
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

  it('isolates a decrypt failure to the failed row and keeps usable cached briefs', async () => {
    const card = buildCachedCard({
      scheduleId: 'schedule_valid',
      timeWindowStart: '2026-04-09T09:30:00.000Z',
    });
    const repository = buildRepository([
      {
        id: 5,
        scheduleId: 'schedule_broken',
        patientId: 'patient_broken',
        scheduledDate: selectedDate,
        payload: 'encrypted-broken',
        updatedAt: new Date('2026-04-09T08:05:00.000Z'),
      },
      {
        id: 6,
        scheduleId: card.scheduleId,
        patientId: card.patientId,
        scheduledDate: selectedDate,
        payload: JSON.stringify(card),
        updatedAt: new Date('2026-04-09T08:15:00.000Z'),
      },
    ]);

    const result = await readScheduleDayCachedVisitBriefs({
      selectedDate,
      repository,
      decryptPayload: async (payload) => {
        if (payload === 'encrypted-broken') {
          throw new Error('decrypt failed');
        }
        return payload;
      },
      isFresh: () => true,
    });

    expect(repository.deletedIds).toEqual([5]);
    expect(result).toMatchObject({
      cards: [card],
      loadedDate: selectedDate,
      updatedAt: '2026-04-09T08:15:00.000Z',
    });
  });

  it('drops cache rows when decrypted payload identity does not match the indexed row', async () => {
    const validCard = buildCachedCard({ scheduleId: 'schedule_valid' });
    const repository = buildRepository([
      {
        id: 7,
        scheduleId: 'schedule_patient_mismatch',
        patientId: 'patient_expected',
        scheduledDate: selectedDate,
        payload: JSON.stringify(
          buildCachedCard({
            scheduleId: 'schedule_patient_mismatch',
            patientId: 'patient_other',
          }),
        ),
        updatedAt: new Date('2026-04-09T08:00:00.000Z'),
      },
      {
        id: 8,
        scheduleId: 'schedule_date_mismatch',
        patientId: 'patient_date_mismatch',
        scheduledDate: selectedDate,
        payload: JSON.stringify(
          buildCachedCard({
            scheduleId: 'schedule_date_mismatch',
            patientId: 'patient_date_mismatch',
            scheduledDate: '2026-04-10',
          }),
        ),
        updatedAt: new Date('2026-04-09T08:05:00.000Z'),
      },
      {
        id: 9,
        scheduleId: validCard.scheduleId,
        patientId: validCard.patientId,
        scheduledDate: selectedDate,
        payload: JSON.stringify(validCard),
        updatedAt: new Date('2026-04-09T08:10:00.000Z'),
      },
    ]);

    const result = await readScheduleDayCachedVisitBriefs({
      selectedDate,
      repository,
      decryptPayload: async (payload) => payload,
      isFresh: () => true,
    });

    expect(repository.deletedIds).toEqual([7, 8]);
    expect(result.cards).toEqual([validCard]);
    expect(result.updatedAt).toBe('2026-04-09T08:10:00.000Z');
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
          latest_labs: [
            {
              analyte_code: 'egfr',
              analyte_label: 'eGFR',
              value_label: '38 mL/min/1.73m2',
              measured_at_label: '2026-04-01',
              abnormal: true,
              abnormal_flag: 'L',
              stale: false,
            },
          ],
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
      latestLabs: ['eGFR 38 mL/min/1.73m2 / 測定日 2026-04-01 / 異常 L'],
    });
  });

  it('accepts legacy cached brief payloads without latest lab excerpts', () => {
    const legacy: Partial<CachedVisitBriefCard> = buildCachedCard();
    delete legacy.latestLabs;

    expect(parseCachedVisitBriefCardPayload(JSON.stringify(legacy))).toEqual(
      expect.objectContaining({ latestLabs: [] }),
    );
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
