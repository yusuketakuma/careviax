import { unstable_rethrow } from 'next/navigation';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { conflict, internalError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext } from '@/lib/auth/context';
import {
  buildOperatingCalendarFromDbRows,
  hhmmToTimeDate,
  materializeOperatingHoursRows,
  serializeHolidayRow,
} from '@/lib/calendar/operating-day-adapter';
import { resolveOperatingState, shiftDateKey } from '@/lib/calendar/operating-day';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  pharmacyOperatingHoursGetQuerySchema,
  pharmacyOperatingHoursPutSchema,
} from '@/lib/validations/pharmacy-operating-hours';

const MAX_RESOLVED_DAYS = 366;
const SINGLE_VALUE_QUERY_NAMES = ['site_id', 'date_from', 'date_to'] as const;

function findDuplicateQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Partial<Record<(typeof SINGLE_VALUE_QUERY_NAMES)[number], string[]>> = {};

  for (const name of SINGLE_VALUE_QUERY_NAMES) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

function collectDateKeys(dateFrom: string, dateTo: string) {
  const keys: string[] = [];
  let cursor = dateFrom;
  for (let scanned = 0; scanned < MAX_RESOLVED_DAYS; scanned += 1) {
    keys.push(cursor);
    if (cursor === dateTo) return keys;
    cursor = shiftDateKey(cursor, 1);
  }
  return null;
}

function latestWeeklyUpdatedAt(rows: Array<{ updated_at?: Date | null }>) {
  let latest: Date | null = null;
  for (const row of rows) {
    const updatedAt = row.updated_at;
    if (!updatedAt || Number.isNaN(updatedAt.getTime())) continue;
    if (!latest || updatedAt.getTime() > latest.getTime()) {
      latest = updatedAt;
    }
  }
  return latest?.toISOString() ?? null;
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const duplicateQueryParams = findDuplicateQueryParams(searchParams);
    if (duplicateQueryParams) {
      return validationError('検索条件が不正です', duplicateQueryParams);
    }

    const parsed = pharmacyOperatingHoursGetQuerySchema.safeParse({
      site_id: searchParams.get('site_id') ?? '',
      ...(searchParams.has('date_from') ? { date_from: searchParams.get('date_from') } : {}),
      ...(searchParams.has('date_to') ? { date_to: searchParams.get('date_to') } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsed.data.site_id });
    if (!refResult.ok) return refResult.response;

    // 有界: PharmacyOperatingHours は @@unique([site_id, weekday]) を持ち、weekday は 0-6 の7値のみ。
    // site 単位で常に最大7行にしかならず、無制限に成長しない。
    const weeklyRows = await prisma.pharmacyOperatingHours.findMany({
      where: { org_id: ctx.orgId, site_id: parsed.data.site_id },
      orderBy: [{ weekday: 'asc' }],
    });

    const shouldResolve = Boolean(parsed.data.date_from && parsed.data.date_to);
    const dateKeys = shouldResolve
      ? collectDateKeys(parsed.data.date_from!, parsed.data.date_to!)
      : [];
    if (shouldResolve && dateKeys == null) {
      return validationError(`解決済みカレンダーは${MAX_RESOLVED_DAYS}日以内で指定してください`);
    }

    // 有界: date_from〜date_to は collectDateKeys 経由で MAX_RESOLVED_DAYS(366日)以内に検証済み。
    // 1日あたりの一致行は site 個別 + org 共通(site_id=null)分のみで、日数上限と合わせて実質有界（無制限化しない）。
    const holidayRows = shouldResolve
      ? await prisma.businessHoliday.findMany({
          where: {
            org_id: ctx.orgId,
            date: {
              gte: new Date(parsed.data.date_from!),
              lte: new Date(parsed.data.date_to!),
            },
            OR: [{ site_id: parsed.data.site_id }, { site_id: null }],
          },
          orderBy: [{ date: 'asc' }, { site_id: 'asc' }],
        })
      : [];

    const weekly = materializeOperatingHoursRows(parsed.data.site_id, weeklyRows);
    const weeklyUpdatedAt = latestWeeklyUpdatedAt(weeklyRows);
    const holidays = holidayRows.map(serializeHolidayRow);
    const calendar = shouldResolve
      ? buildOperatingCalendarFromDbRows(parsed.data.site_id, weeklyRows, holidayRows)
      : null;
    const resolvedDays =
      calendar && dateKeys
        ? dateKeys.map((date) => {
            const state = resolveOperatingState(calendar, date);
            if (!state.open) {
              return {
                date,
                open: false,
                source: state.reason === 'holiday' ? 'holiday' : 'weekly',
                reason: state.reason,
                from: null,
                to: null,
              };
            }
            return {
              date,
              open: true,
              source: state.source,
              from: state.from,
              to: state.to,
            };
          })
        : undefined;

    return success({
      data: {
        site_id: parsed.data.site_id,
        weekly,
        weekly_updated_at: weeklyUpdatedAt,
        holidays,
        ...(resolvedDays ? { resolved_days: resolvedDays } : {}),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '営業時間設定の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPUT = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = pharmacyOperatingHoursPutSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsed.data.site_id });
    if (!refResult.ok) return refResult.response;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      // 有界: 上記GETと同様、@@unique([site_id, weekday]) により site あたり最大7行。
      const before = await tx.pharmacyOperatingHours.findMany({
        where: { org_id: ctx.orgId, site_id: parsed.data.site_id },
        orderBy: [{ weekday: 'asc' }],
      });

      const currentWeeklyUpdatedAt = latestWeeklyUpdatedAt(before);
      if (currentWeeklyUpdatedAt !== parsed.data.expected_weekly_updated_at) {
        return {
          kind: 'conflict' as const,
          currentWeeklyUpdatedAt,
        };
      }

      await Promise.all(
        parsed.data.rows.map((row) =>
          tx.pharmacyOperatingHours.upsert({
            where: {
              site_id_weekday: {
                site_id: parsed.data.site_id,
                weekday: row.weekday,
              },
            },
            create: {
              org_id: ctx.orgId,
              site_id: parsed.data.site_id,
              weekday: row.weekday,
              is_open: row.is_open,
              open_time: row.is_open ? hhmmToTimeDate(row.open_time) : null,
              close_time: row.is_open ? hhmmToTimeDate(row.close_time) : null,
              note: row.note,
            },
            update: {
              is_open: row.is_open,
              open_time: row.is_open ? hhmmToTimeDate(row.open_time) : null,
              close_time: row.is_open ? hhmmToTimeDate(row.close_time) : null,
              note: row.note,
            },
          }),
        ),
      );

      // 有界: 同上、site あたり最大7行。
      const after = await tx.pharmacyOperatingHours.findMany({
        where: { org_id: ctx.orgId, site_id: parsed.data.site_id },
        orderBy: [{ weekday: 'asc' }],
      });

      const beforeRows = materializeOperatingHoursRows(parsed.data.site_id, before);
      const afterRows = materializeOperatingHoursRows(parsed.data.site_id, after);
      const afterWeeklyUpdatedAt = latestWeeklyUpdatedAt(after);

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacy_operating_hours_updated',
        targetType: 'PharmacyOperatingHours',
        targetId: parsed.data.site_id,
        changes: {
          site_id: parsed.data.site_id,
          before: beforeRows,
          after: afterRows,
        },
      });

      return { kind: 'ok' as const, weekly: afterRows, weeklyUpdatedAt: afterWeeklyUpdatedAt };
    });

    if (result.kind === 'conflict') {
      return conflict(
        '営業時間設定が他の操作で更新されています。画面を再読み込みしてから保存してください',
        {
          conflict_type: 'stale_operating_hours',
          expected_weekly_updated_at: parsed.data.expected_weekly_updated_at,
          current_weekly_updated_at: result.currentWeeklyUpdatedAt,
        },
      );
    }

    return success({
      data: {
        site_id: parsed.data.site_id,
        weekly: result.weekly,
        weekly_updated_at: result.weeklyUpdatedAt,
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '営業時間設定の更新権限がありません',
  },
);

export const PUT: typeof authenticatedPUT = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPUT(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
