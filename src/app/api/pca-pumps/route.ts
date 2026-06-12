import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { createPcaPumpSchema } from '@/lib/validations/pca-pump-rental';
import { serializePcaPump, toPcaPumpDateKey } from '@/server/services/pca-pump-serialization';

const pumpStatuses = ['available', 'rented', 'maintenance', 'retired'] as const;
type PumpStatus = (typeof pumpStatuses)[number];

function parsePumpStatusParam(value: string | undefined) {
  if (!value || value === 'all') return { ok: true as const, status: undefined };
  if (pumpStatuses.includes(value as PumpStatus)) {
    return { ok: true as const, status: value as PumpStatus };
  }
  return { ok: false as const };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const query = req.nextUrl.searchParams.get('q')?.trim();
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
              where: { status: { in: ['scheduled', 'active', 'overdue'] } },
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
        }),
      { requestContext: ctx },
    );

    return success({ data: pumps.map(serializePcaPump) });
  },
  {
    permission: 'canReport',
    message: 'PCAポンプ台帳の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPcaPumpSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const pump = await tx.pcaPump.create({
          data: {
            org_id: ctx.orgId,
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
      { requestContext: ctx },
    );

    return success({ data: serializePcaPump(created) }, 201);
  },
  {
    permission: 'canAdmin',
    message: 'PCAポンプ台帳の更新権限がありません',
  },
);
