import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { createPcaPumpSchema } from '@/lib/validations/pca-pump-rental';

const pumpStatuses = ['available', 'rented', 'maintenance', 'retired'] as const;
type PumpStatus = (typeof pumpStatuses)[number];

function parsePumpStatusParam(value: string | undefined) {
  if (!value || value === 'all') return { ok: true as const, status: undefined };
  if (pumpStatuses.includes(value as PumpStatus)) {
    return { ok: true as const, status: value as PumpStatus };
  }
  return { ok: false as const };
}

function serializePump<
  T extends { maintenance_due_at: Date | null; created_at: Date; updated_at: Date },
>(item: T) {
  return {
    ...item,
    maintenance_due_at: item.maintenance_due_at?.toISOString().slice(0, 10) ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const query = req.nextUrl.searchParams.get('q')?.trim();
    const statusParam = req.nextUrl.searchParams.get('status')?.trim();
    const parsedStatus = parsePumpStatusParam(statusParam);
    if (!parsedStatus.ok) return validationError('PCAポンプ状態の指定が不正です');

    const pumps = await withOrgContext(
      req.orgId,
      (tx) =>
        tx.pcaPump.findMany({
          where: {
            org_id: req.orgId,
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
          },
          orderBy: [{ status: 'asc' }, { asset_code: 'asc' }],
        }),
      { requestContext: req },
    );

    return success({ data: pumps.map(serializePump) });
  },
  {
    permission: 'canReport',
    message: 'PCAポンプ台帳の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPcaPumpSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(
      req.orgId,
      async (tx) => {
        const pump = await tx.pcaPump.create({
          data: {
            org_id: req.orgId,
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
        await tx.auditLog.create({
          data: {
            org_id: req.orgId,
            actor_id: req.userId,
            action: 'pca_pump_created',
            target_type: 'PcaPump',
            target_id: pump.id,
            changes: {
              asset_code: pump.asset_code,
              serial_number: pump.serial_number,
              model_name: pump.model_name,
              status: pump.status,
              maintenance_due_at: pump.maintenance_due_at?.toISOString().slice(0, 10) ?? null,
            },
            ip_address: req.headers.get('x-forwarded-for') ?? null,
            user_agent: req.headers.get('user-agent') ?? null,
          },
        });
        return pump;
      },
      { requestContext: req },
    );

    return success({ data: serializePump(created) }, 201);
  },
  {
    permission: 'canAdmin',
    message: 'PCAポンプ台帳の更新権限がありません',
  },
);
