import { formatOfflineCacheUpdatedAt, isOfflineCacheFresh } from '@/lib/offline/cache-policy';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import type { OfflineVisitBriefCache } from '@/lib/stores/offline-db';
import {
  parseCachedVisitBriefCardPayload,
  type CachedVisitBriefCard,
} from '@/lib/visits/visit-brief-cache';
import type { VisitSchedule } from './day-view.shared';

export type ScheduleDayVisitBriefCacheRepository = {
  loadByScheduledDate: (scheduledDate: string) => Promise<OfflineVisitBriefCache[]>;
  deleteById: (id: number) => Promise<unknown>;
  replaceForScheduleDate: (input: {
    selectedDate: string;
    card: CachedVisitBriefCard;
    encryptedPayload: string;
    updatedAt: Date;
  }) => Promise<unknown>;
};

type VisitBriefCacheCollection = {
  toArray: () => Promise<OfflineVisitBriefCache[]>;
  and: (predicate: (row: OfflineVisitBriefCache) => boolean) => { delete: () => Promise<unknown> };
};

type VisitBriefCacheTable = {
  where: (index: string) => {
    equals: (value: string) => VisitBriefCacheCollection;
  };
  add: (row: OfflineVisitBriefCache) => Promise<unknown>;
  delete: (id: number) => Promise<unknown>;
};

type VisitBriefBatchPayload = {
  data: Record<
    string,
    {
      archive?: CachedVisitBriefCard['patientArchive'] | null;
      ai_summary: {
        headline: string;
        must_check_today: string[];
        source_refs: string[];
        generated_at: string;
        provider: 'rule' | 'openai';
        is_fallback: boolean;
      };
      latest_labs?: Array<{
        analyte_code: string;
        analyte_label: string;
        value_label: string;
        measured_at_label: string;
        abnormal: boolean;
        abnormal_flag: string | null;
        stale: boolean;
      }>;
    }
  >;
};

type ScheduleDayVisitBriefBatchFetcher = (input: {
  orgId: string;
  scheduleIds: string[];
}) => Promise<VisitBriefBatchPayload | null>;

export type ReadScheduleDayCachedVisitBriefsInput = {
  selectedDate: string;
  repository: ScheduleDayVisitBriefCacheRepository;
  decryptPayload?: (payload: string) => Promise<string | null | undefined>;
  isFresh?: (updatedAt: Date) => boolean;
};

export type ReadScheduleDayCachedVisitBriefsResult = {
  cards: CachedVisitBriefCard[];
  updatedAt: string | null;
  loadedDate: string;
};

export type FetchMissingScheduleDayVisitBriefCardsInput = {
  orgId: string;
  selectedDate: string;
  schedules: VisitSchedule[];
  cachedVisitBriefByScheduleId: ReadonlyMap<string, CachedVisitBriefCard>;
  fetchBatch?: ScheduleDayVisitBriefBatchFetcher;
};

export type SaveScheduleDayVisitBriefCardsInput = {
  selectedDate: string;
  cards: CachedVisitBriefCard[];
  repository: ScheduleDayVisitBriefCacheRepository;
  encryptPayload?: (payload: string, context: string) => Promise<string>;
  now?: () => Date;
};

export function createScheduleDayVisitBriefCacheRepository(
  table: VisitBriefCacheTable,
): ScheduleDayVisitBriefCacheRepository {
  return {
    loadByScheduledDate: (scheduledDate) =>
      table.where('scheduledDate').equals(scheduledDate).toArray(),
    deleteById: (id) => table.delete(id),
    replaceForScheduleDate: async ({ selectedDate, card, encryptedPayload, updatedAt }) => {
      await table
        .where('scheduleId')
        .equals(card.scheduleId)
        .and((row) => row.scheduledDate === selectedDate)
        .delete();
      await table.add({
        scheduleId: card.scheduleId,
        patientId: card.patientId,
        scheduledDate: selectedDate,
        payload: encryptedPayload,
        updatedAt,
      });
    },
  };
}

export function sortScheduleDayVisitBriefCards(cards: CachedVisitBriefCard[]) {
  return [...cards].sort((left, right) =>
    (left.timeWindowStart ?? '').localeCompare(right.timeWindowStart ?? ''),
  );
}

function formatCachedLatestLab(
  lab: NonNullable<VisitBriefBatchPayload['data'][string]['latest_labs']>[number],
) {
  const flags = [
    lab.abnormal ? `異常${lab.abnormal_flag ? ` ${lab.abnormal_flag}` : ''}` : null,
    lab.stale ? '測定日確認' : null,
  ].filter((item): item is string => Boolean(item));
  return [
    `${lab.analyte_label || lab.analyte_code} ${lab.value_label}`,
    lab.measured_at_label ? `測定日 ${lab.measured_at_label}` : null,
    ...flags,
  ]
    .filter((item): item is string => Boolean(item))
    .join(' / ');
}

function isCachedVisitBriefRowMatch({
  row,
  payload,
  selectedDate,
}: {
  row: OfflineVisitBriefCache;
  payload: CachedVisitBriefCard;
  selectedDate: string;
}) {
  return (
    row.scheduleId === payload.scheduleId &&
    row.patientId === payload.patientId &&
    row.scheduledDate === selectedDate &&
    payload.scheduledDate === selectedDate
  );
}

export async function readScheduleDayCachedVisitBriefs({
  selectedDate,
  repository,
  decryptPayload = decryptOfflinePayload,
  isFresh = isOfflineCacheFresh,
}: ReadScheduleDayCachedVisitBriefsInput): Promise<ReadScheduleDayCachedVisitBriefsResult> {
  const rows = await repository.loadByScheduledDate(selectedDate);
  const freshRows = rows.filter((row) => isFresh(row.updatedAt));
  const staleRows = rows.filter((row) => !isFresh(row.updatedAt));

  await Promise.all(staleRows.map((row) => (row.id ? repository.deleteById(row.id) : undefined)));

  const decoded = await Promise.all(
    freshRows.map(async (row) => {
      try {
        const payload = await decryptPayload(row.payload);
        const parsed = parseCachedVisitBriefCardPayload(payload);
        return {
          row,
          payload:
            parsed && isCachedVisitBriefRowMatch({ row, payload: parsed, selectedDate })
              ? parsed
              : null,
        };
      } catch {
        return {
          row,
          payload: null,
        };
      }
    }),
  );

  await Promise.all(
    decoded.map((item) =>
      item.payload === null && item.row.id ? repository.deleteById(item.row.id) : undefined,
    ),
  );

  const usableRows = decoded.filter(
    (item): item is { row: OfflineVisitBriefCache; payload: CachedVisitBriefCard } =>
      item.payload !== null,
  );
  const latestUpdatedAt = usableRows.reduce<Date | null>(
    (latest, item) => (!latest || item.row.updatedAt > latest ? item.row.updatedAt : latest),
    null,
  );

  return {
    cards: sortScheduleDayVisitBriefCards(usableRows.map((item) => item.payload)),
    updatedAt: formatOfflineCacheUpdatedAt(latestUpdatedAt),
    loadedDate: selectedDate,
  };
}

async function fetchScheduleDayVisitBriefBatch({
  orgId,
  scheduleIds,
}: {
  orgId: string;
  scheduleIds: string[];
}): Promise<VisitBriefBatchPayload | null> {
  const res = await fetch('/api/visit-preparations/brief-batch', {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({
      schedule_ids: scheduleIds,
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as VisitBriefBatchPayload;
}

export async function fetchMissingScheduleDayVisitBriefCards({
  orgId,
  selectedDate,
  schedules,
  cachedVisitBriefByScheduleId,
  fetchBatch = fetchScheduleDayVisitBriefBatch,
}: FetchMissingScheduleDayVisitBriefCardsInput): Promise<CachedVisitBriefCard[]> {
  const schedulesNeedingBriefs = schedules.filter(
    (schedule) => !cachedVisitBriefByScheduleId.has(schedule.id),
  );
  if (schedulesNeedingBriefs.length === 0) return [];

  const payload = await fetchBatch({
    orgId,
    scheduleIds: schedulesNeedingBriefs.map((schedule) => schedule.id),
  });
  if (!payload) return [];

  const items = schedulesNeedingBriefs.map((schedule): CachedVisitBriefCard | null => {
    const brief = payload.data[schedule.id];
    if (!brief) return null;

    return {
      scheduleId: schedule.id,
      patientId: schedule.case_.patient.id,
      patientName: schedule.case_.patient.name,
      ...(brief.archive ? { patientArchive: brief.archive } : {}),
      scheduledDate: selectedDate,
      timeWindowStart: schedule.time_window_start,
      timeWindowEnd: schedule.time_window_end,
      priority: schedule.priority,
      facilityLabel:
        schedule.facility_hint?.label ?? schedule.case_.patient.residences[0]?.address ?? null,
      siteName: schedule.site?.name ?? null,
      headline: brief.ai_summary.headline,
      mustCheckToday: brief.ai_summary.must_check_today,
      latestLabs: (brief.latest_labs ?? []).slice(0, 3).map(formatCachedLatestLab),
      sourceRefs: brief.ai_summary.source_refs,
      generatedAt: brief.ai_summary.generated_at,
      provider: brief.ai_summary.provider,
      isFallback: brief.ai_summary.is_fallback,
    };
  });

  return sortScheduleDayVisitBriefCards(
    items.filter((item): item is CachedVisitBriefCard => Boolean(item)),
  );
}

export async function saveScheduleDayVisitBriefCards({
  selectedDate,
  cards,
  repository,
  encryptPayload = encryptOfflinePayloadRequired,
  now = () => new Date(),
}: SaveScheduleDayVisitBriefCardsInput): Promise<string | null> {
  if (cards.length === 0) return null;

  const updatedAt = now();
  await Promise.all(
    cards.map(async (card) => {
      await repository.replaceForScheduleDate({
        selectedDate,
        card,
        encryptedPayload: await encryptPayload(JSON.stringify(card), 'visit brief cache payload'),
        updatedAt,
      });
    }),
  );
  return updatedAt.toISOString();
}

export function mergeScheduleDayCachedVisitBriefCards({
  previous,
  selectedDate,
  incoming,
}: {
  previous: CachedVisitBriefCard[];
  selectedDate: string;
  incoming: CachedVisitBriefCard[];
}) {
  const nextByScheduleId = new Map(
    previous
      .filter((item) => item.scheduledDate === selectedDate)
      .map((item) => [item.scheduleId, item]),
  );
  for (const item of incoming) {
    nextByScheduleId.set(item.scheduleId, item);
  }
  return sortScheduleDayVisitBriefCards(Array.from(nextByScheduleId.values()));
}
