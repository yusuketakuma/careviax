import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { buildCursorPage, parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { allocateDisplayId } from '@/lib/db/display-id';
import { withOrgContext } from '@/lib/db/rls';
import { createPcaPumpSchema, pcaPumpOpenRentalStatuses } from '@/lib/validations/pca-pump-rental';
import { serializePcaPump, toPcaPumpDateKey } from '@/server/services/pca-pump-serialization';

const pumpStatuses = ['available', 'rented', 'maintenance', 'retired'] as const;
type PumpStatus = (typeof pumpStatuses)[number];
const DEFAULT_PCA_PUMP_SEARCH_LIMIT = 500;
const MAX_PCA_PUMP_SEARCH_LIMIT = 500;

function parsePumpStatusParam(value: string | undefined) {
  if (!value || value === 'all') return { ok: true as const, status: undefined };
  if (pumpStatuses.includes(value as PumpStatus)) {
    return { ok: true as const, status: value as PumpStatus };
  }
  return { ok: false as const };
}

async function authenticatedGET(req: NextRequest, ctx: AuthContext) {
  const duplicateFields: Record<string, string[]> = {};
  for (const name of ['q', 'limit', 'status'] as const) {
    if (req.nextUrl.searchParams.getAll(name).length > 1) {
      duplicateFields[name] = [`${name} は1つだけ指定してください`];
    }
  }
  if (Object.keys(duplicateFields).length > 0) {
    return validationError('検索条件が不正です', duplicateFields);
  }
  const queryParam = req.nextUrl.searchParams.get('q')?.trim();
  const query = queryParam && queryParam.length > 0 ? queryParam : undefined;
  const limit = parseBoundedInteger(
    req.nextUrl.searchParams.get('limit'),
    DEFAULT_PCA_PUMP_SEARCH_LIMIT,
    1,
    MAX_PCA_PUMP_SEARCH_LIMIT,
  );
  const statusParam = req.nextUrl.searchParams.get('status')?.trim();
  const parsedStatus = parsePumpStatusParam(statusParam);
  if (!parsedStatus.ok) return validationError('PCAポンプ状態の指定が不正です');

  const pumps = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.pcaPump.findMany({
        where: {
          org_id: ctx.orgId,
          ...(parsedStatus.status ? { status: parsedStatus.status } : {}),
          ...(query
            ? {
                OR: [
                  { asset_code: { contains: query, mode: 'insensitive' } },
                  { serial_number: { contains: query, mode: 'insensitive' } },
                  { model_name: { contains: query, mode: 'insensitive' } },
                  { manufacturer: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: {
          _count: {
            select: { rentals: true },
          },
          rentals: {
            where: { status: { in: [...pcaPumpOpenRentalStatuses] } },
            orderBy: [{ rented_at: 'desc' }, { created_at: 'desc' }],
            take: 1,
            include: {
              institution: {
                select: {
                  id: true,
                  name: true,
                  institution_code: true,
                },
              },
            },
          },
          maintenance_events: {
            orderBy: [{ performed_at: 'desc' }, { created_at: 'desc' }],
            take: 3,
          },
        },
        orderBy: [{ status: 'asc' }, { asset_code: 'asc' }],
        ...(query ? { take: limit + 1 } : {}),
      }),
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  );

  if (!query) {
    return success({ data: pumps.map(serializePcaPump) });
  }

  const page = buildCursorPage(pumps, limit, (pump) => pump.id);

  return success({
    data: page.data.map(serializePcaPump),
    meta: { limit, has_more: page.hasMore },
  });
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canReport',
  message: 'PCAポンプ台帳の閲覧権限がありません',
});

async function authenticatedPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createPcaPumpSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const created = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const displayId = await allocateDisplayId(tx, 'PcaPump', ctx.orgId);
      const pump = await tx.pcaPump.create({
        data: {
          org_id: ctx.orgId,
          display_id: displayId,
          asset_code: parsed.data.asset_code,
          serial_number: parsed.data.serial_number || null,
          model_name: parsed.data.model_name,
          manufacturer: parsed.data.manufacturer || null,
          status: parsed.data.status ?? 'available',
          maintenance_due_at: parsed.data.maintenance_due_at
            ? new Date(parsed.data.maintenance_due_at)
            : null,
          notes: parsed.data.notes || null,
        },
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'pca_pump_created',
        targetType: 'PcaPump',
        targetId: pump.id,
        changes: {
          asset_code: pump.asset_code,
          serial_number: pump.serial_number,
          model_name: pump.model_name,
          status: pump.status,
          maintenance_due_at: toPcaPumpDateKey(pump.maintenance_due_at),
        },
      });
      return pump;
    },
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  );

  return success({ data: serializePcaPump(created) }, 201);
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canAdmin',
  message: 'PCAポンプ台帳の更新権限がありません',
});
