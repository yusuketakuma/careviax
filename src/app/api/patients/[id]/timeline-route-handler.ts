import { unstable_rethrow } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import {
  internalError,
  notFound,
  successWithMeasuredJsonPayload,
  validationError,
} from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { parseExactIntegerSearchParam, readSingleSearchParam } from '@/lib/api/search-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext } from '@/lib/auth/context';
import { createScopedTxRunner } from '@/lib/db/rls';
import { japanDayInstantRangeFromDateKey } from '@/lib/utils/date-boundary';
import { isValidDateKey } from '@/lib/validations/date-key';
import { getPatientTimelineData } from '@/server/services/patient-detail';
import type { PatientMovementCategory } from '@/types/patient-movement-timeline';

type PatientTimelineRouteContext = {
  params: Promise<{ id: string }>;
};

type PatientTimelineData = NonNullable<Awaited<ReturnType<typeof getPatientTimelineData>>>;
type MovementTimelineEvent = PatientTimelineData['movement_events'][number];

type MovementTimelineFilters = {
  category: PatientMovementCategory | null;
  date_from: string | null;
  date_to: string | null;
};

type MovementTimelineCursor = {
  occurredAt: string;
  id: string;
};

type MovementTimelineQuery = {
  limit: number;
  filters: MovementTimelineFilters;
  cursor: MovementTimelineCursor | null;
  filterHash: string;
};

const MOVEMENT_TIMELINE_MAX_LIMIT = 40;
const MOVEMENT_TIMELINE_WINDOW_LIMIT = MOVEMENT_TIMELINE_MAX_LIMIT;
const MOVEMENT_CURSOR_VERSION = 1;
const MOVEMENT_CURSOR_MAX_LENGTH = 512;
const MOVEMENT_CATEGORIES = [
  'visit',
  'prescription',
  'medication_stock',
  'interprofessional',
  'communication',
  'document',
  'billing',
  'task',
  'safety',
  'system',
] as const satisfies readonly PatientMovementCategory[];
const MOVEMENT_CATEGORY_SET = new Set<string>(MOVEMENT_CATEGORIES);

function movementFilterHash(filters: MovementTimelineFilters) {
  return createHash('sha256').update(JSON.stringify(filters)).digest('base64url').slice(0, 16);
}

function encodeMovementCursor(event: MovementTimelineEvent, filterHash: string) {
  const payload = {
    v: MOVEMENT_CURSOR_VERSION,
    o: movementOccurredAtIso(event),
    i: event.id,
    w: MOVEMENT_TIMELINE_WINDOW_LIMIT,
    f: filterHash,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeMovementCursor(raw: string, filterHash: string) {
  if (!raw || raw.length > MOVEMENT_CURSOR_MAX_LENGTH) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== MOVEMENT_CURSOR_VERSION) return null;
    if (record.w !== MOVEMENT_TIMELINE_WINDOW_LIMIT) return null;
    if (record.f !== filterHash) return null;
    if (typeof record.o !== 'string' || typeof record.i !== 'string') return null;
    if (!record.i.trim() || record.i.length > 256) return null;
    const occurredAt = new Date(record.o);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== record.o) {
      return null;
    }
    return { occurredAt: record.o, id: record.i } satisfies MovementTimelineCursor;
  } catch {
    return null;
  }
}

function parseMovementCategory(searchParams: URLSearchParams) {
  const result = readSingleSearchParam(searchParams, 'category');
  if (!result.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { category: [result.message] }),
    };
  }
  if (result.value === null) return { ok: true as const, value: null };
  if (!MOVEMENT_CATEGORY_SET.has(result.value)) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        category: ['category は指定できる分類を1つだけ指定してください'],
      }),
    };
  }
  return { ok: true as const, value: result.value as PatientMovementCategory };
}

function parseMovementDateKey(searchParams: URLSearchParams, field: 'date_from' | 'date_to') {
  const result = readSingleSearchParam(searchParams, field);
  if (!result.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [field]: [result.message] }),
    };
  }
  if (result.value === null) return { ok: true as const, value: null };
  if (!isValidDateKey(result.value)) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [field]: [`${field} はYYYY-MM-DD形式で指定してください`],
      }),
    };
  }
  return { ok: true as const, value: result.value };
}

function parseMovementCursor(searchParams: URLSearchParams, filterHash: string) {
  const result = readSingleSearchParam(searchParams, 'cursor');
  if (!result.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { cursor: [result.message] }),
    };
  }
  if (result.value === null) return { ok: true as const, value: null };
  const cursor = decodeMovementCursor(result.value, filterHash);
  if (!cursor) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        cursor: ['cursor が不正、期限切れ、または検索条件と一致しません'],
      }),
    };
  }
  return { ok: true as const, value: cursor };
}

function parseMovementTimelineQuery(searchParams: URLSearchParams) {
  const limit = parseExactIntegerSearchParam(
    searchParams,
    'limit',
    1,
    MOVEMENT_TIMELINE_MAX_LIMIT,
    40,
  );
  if (!limit.ok) return { ok: false as const, response: validationError(limit.message) };

  const category = parseMovementCategory(searchParams);
  if (!category.ok) return category;

  const dateFrom = parseMovementDateKey(searchParams, 'date_from');
  if (!dateFrom.ok) return dateFrom;

  const dateTo = parseMovementDateKey(searchParams, 'date_to');
  if (!dateTo.ok) return dateTo;

  if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        date_to: ['date_to は date_from 以降の日付を指定してください'],
      }),
    };
  }

  const filters = {
    category: category.value,
    date_from: dateFrom.value,
    date_to: dateTo.value,
  } satisfies MovementTimelineFilters;
  const filterHash = movementFilterHash(filters);
  const cursor = parseMovementCursor(searchParams, filterHash);
  if (!cursor.ok) return cursor;

  return {
    ok: true as const,
    value: {
      limit: limit.value ?? 40,
      filters,
      cursor: cursor.value,
      filterHash,
    } satisfies MovementTimelineQuery,
  };
}

function movementOccurredAtIso(event: MovementTimelineEvent) {
  return event.occurred_at instanceof Date
    ? event.occurred_at.toISOString()
    : new Date(event.occurred_at).toISOString();
}

function movementEventTime(event: MovementTimelineEvent) {
  return new Date(movementOccurredAtIso(event)).getTime();
}

function compareMovementEventsDesc(left: MovementTimelineEvent, right: MovementTimelineEvent) {
  return movementEventTime(right) - movementEventTime(left) || right.id.localeCompare(left.id);
}

function matchesMovementFilters(event: MovementTimelineEvent, filters: MovementTimelineFilters) {
  if (filters.category && event.category !== filters.category) return false;
  const occurredAt = movementEventTime(event);
  if (filters.date_from) {
    const range = japanDayInstantRangeFromDateKey(filters.date_from);
    if (occurredAt < range.gte.getTime()) return false;
  }
  if (filters.date_to) {
    const range = japanDayInstantRangeFromDateKey(filters.date_to);
    if (occurredAt >= range.lt.getTime()) return false;
  }
  return true;
}

function isAfterMovementCursor(
  event: MovementTimelineEvent,
  cursor: MovementTimelineCursor | null,
) {
  if (!cursor) return true;
  const occurredAt = movementOccurredAtIso(event);
  if (occurredAt < cursor.occurredAt) return true;
  return occurredAt === cursor.occurredAt && event.id.localeCompare(cursor.id) < 0;
}

function toMovementTimelineResponse(timeline: PatientTimelineData, query: MovementTimelineQuery) {
  const filtered = [...timeline.movement_events]
    .sort(compareMovementEventsDesc)
    .filter((event) => matchesMovementFilters(event, query.filters))
    .filter((event) => isAfterMovementCursor(event, query.cursor));
  const page = filtered.slice(0, query.limit);
  const hasMore = filtered.length > query.limit;
  const lastEvent = page.at(-1);

  return {
    movement_events: page,
    meta: {
      next_cursor: hasMore && lastEvent ? encodeMovementCursor(lastEvent, query.filterHash) : null,
      has_more: hasMore,
      returned_count: page.length,
      count_basis: 'bounded_latest_window' as const,
      filters: query.filters,
      window_limit: MOVEMENT_TIMELINE_WINDOW_LIMIT,
    },
    ...(timeline.partial_failures ? { partial_failures: timeline.partial_failures } : {}),
  };
}

export function createPatientMovementTimelineGET() {
  const authenticatedGET = withAuthContext(
    async (req, ctx, { params }: PatientTimelineRouteContext) => {
      const { id: rawId } = await params;
      const id = normalizeRequiredRouteParam(rawId);
      if (!id) return validationError('患者IDが不正です');
      const { searchParams } = new URL(req.url);
      const movementQuery = parseMovementTimelineQuery(searchParams);
      if (!movementQuery.ok) return movementQuery.response;

      // Inject the single RLS-scoped executor seam; the global prisma client is no
      // longer reachable here, so each timeline read flows through a scoped short tx.
      const runScoped = createScopedTxRunner(ctx.orgId);
      const timeline = await getPatientTimelineData(runScoped, {
        orgId: ctx.orgId,
        patientId: id,
        role: ctx.role,
        userId: ctx.userId,
        timelineLimit: MOVEMENT_TIMELINE_WINDOW_LIMIT,
      });
      if (!timeline) return notFound('患者が見つかりません');

      // PHI 閲覧監査（3省2GL アクセス記録）。ベストエフォート、await しない。
      recordPhiReadAuditForRequest(ctx, { patientId: id, view: 'patient_movement_timeline' });

      return successWithMeasuredJsonPayload(
        toMovementTimelineResponse(timeline, movementQuery.value),
      );
    },
    {
      permission: 'canVisit',
      message: '患者情報の閲覧権限がありません',
    },
  );

  return async function GET(req: NextRequest, routeContext: PatientTimelineRouteContext) {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      return withSensitiveNoStore(internalError());
    }
  };
}
