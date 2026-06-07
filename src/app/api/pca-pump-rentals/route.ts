import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { createPcaPumpRentalSchema } from '@/lib/validations/pca-pump-rental';

const rentalStatuses = ['scheduled', 'active', 'overdue', 'returned', 'cancelled'] as const;
const openRentalStatuses = ['scheduled', 'active', 'overdue'] as const;
type RentalStatus = (typeof rentalStatuses)[number];

function parseRentalStatusParam(value: string | undefined) {
  if (!value || value === 'all') return { ok: true as const, status: undefined };
  if (value === 'open') return { ok: true as const, statuses: [...openRentalStatuses] };
  if (rentalStatuses.includes(value as RentalStatus)) {
    return { ok: true as const, status: value as RentalStatus };
  }
  return { ok: false as const };
}

function isOpenRentalStatus(value: RentalStatus): value is (typeof openRentalStatuses)[number] {
  return openRentalStatuses.includes(value as (typeof openRentalStatuses)[number]);
}

function serializeRental<
  T extends {
    rented_at: Date;
    due_at: Date | null;
    returned_at: Date | null;
    created_at: Date;
    updated_at: Date;
  },
>(item: T) {
  return {
    ...item,
    rented_at: item.rented_at.toISOString().slice(0, 10),
    due_at: item.due_at?.toISOString().slice(0, 10) ?? null,
    returned_at: item.returned_at?.toISOString().slice(0, 10) ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const statusParam = req.nextUrl.searchParams.get('status')?.trim();
    const parsedStatus = parseRentalStatusParam(statusParam);
    if (!parsedStatus.ok) return validationError('PCAポンプレンタル状態の指定が不正です');

    const institutionId = req.nextUrl.searchParams.get('institution_id')?.trim();

    const rentals = await prisma.pcaPumpRental.findMany({
      where: {
        org_id: req.orgId,
        ...('statuses' in parsedStatus
          ? { status: { in: parsedStatus.statuses } }
          : parsedStatus.status
            ? { status: parsedStatus.status }
            : {}),
        ...(institutionId ? { institution_id: institutionId } : {}),
      },
      include: {
        pump: {
          select: {
            id: true,
            asset_code: true,
            serial_number: true,
            model_name: true,
            status: true,
          },
        },
        institution: {
          select: {
            id: true,
            name: true,
            institution_code: true,
            phone: true,
            fax: true,
          },
        },
      },
      orderBy: [{ rented_at: 'desc' }, { created_at: 'desc' }],
      take: 100,
    });

    return success({ data: rentals.map(serializeRental) });
  },
  {
    permission: 'canReport',
    message: 'PCAポンプレンタルの閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPcaPumpRentalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const [pump, institution] = await Promise.all([
      prisma.pcaPump.findFirst({
        where: { id: parsed.data.pump_id, org_id: req.orgId },
        select: { id: true, status: true },
      }),
      prisma.prescriberInstitution.findFirst({
        where: { id: parsed.data.institution_id, org_id: req.orgId },
        select: { id: true },
      }),
    ]);
    if (!pump) return notFound('PCAポンプが見つかりません');
    if (!institution) return notFound('貸出先医療機関が見つかりません');
    if (pump.status !== 'available') {
      return validationError('利用可能なPCAポンプだけ貸出登録できます');
    }

    const status = parsed.data.status ?? 'active';
    const requiresPumpClaim = isOpenRentalStatus(status);
    const created = await withOrgContext(
      req.orgId,
      async (tx) => {
        if (requiresPumpClaim) {
          const claim = await tx.pcaPump.updateMany({
            where: {
              id: parsed.data.pump_id,
              org_id: req.orgId,
              status: 'available',
            },
            data: { status: 'rented' },
          });
          if (claim.count !== 1) {
            return { kind: 'error' as const, error: 'pump_not_available' as const };
          }
        }

        const rental = await tx.pcaPumpRental.create({
          data: {
            org_id: req.orgId,
            pump_id: parsed.data.pump_id,
            institution_id: parsed.data.institution_id,
            status,
            rented_at: new Date(parsed.data.rented_at),
            due_at: parsed.data.due_at ? new Date(parsed.data.due_at) : null,
            returned_at: parsed.data.returned_at ? new Date(parsed.data.returned_at) : null,
            contact_name: parsed.data.contact_name || null,
            contact_phone: parsed.data.contact_phone || null,
            rental_fee_yen: parsed.data.rental_fee_yen ?? null,
            notes: parsed.data.notes || null,
          },
          include: {
            pump: true,
            institution: true,
          },
        });
        await tx.auditLog.create({
          data: {
            org_id: req.orgId,
            actor_id: req.userId,
            action: 'pca_pump_rental_created',
            target_type: 'PcaPumpRental',
            target_id: rental.id,
            changes: {
              pump_id: rental.pump_id,
              institution_id: rental.institution_id,
              status: rental.status,
              rented_at: rental.rented_at.toISOString().slice(0, 10),
              due_at: rental.due_at?.toISOString().slice(0, 10) ?? null,
              rental_fee_yen: rental.rental_fee_yen,
            },
            ip_address: req.headers.get('x-forwarded-for') ?? null,
            user_agent: req.headers.get('user-agent') ?? null,
          },
        });

        return { kind: 'rental' as const, rental };
      },
      { requestContext: req },
    );
    if (created.kind === 'error') {
      return validationError('利用可能なPCAポンプだけ貸出登録できます');
    }

    return success({ data: serializeRental(created.rental) }, 201);
  },
  {
    permission: 'canAdmin',
    message: 'PCAポンプレンタルの更新権限がありません',
  },
);
