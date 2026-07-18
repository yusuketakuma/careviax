import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { allocateDisplayId } from '@/lib/db/display-id';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { runSequentially } from '@/lib/utils/concurrency';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  createPcaPumpRentalSchema,
  pcaPumpOpenRentalStatuses,
  pcaPumpRentalStatuses,
} from '@/lib/validations/pca-pump-rental';
import { createDefaultPcaRentalAccessories } from '@/server/services/pca-rental-accessories';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { serializePcaPumpRental, toDateKey } from '@/server/services/pca-pump-rental-serialization';

const ROUTE = '/api/pca-pump-rentals';
const returnInspectionStatuses = ['pending', 'passed', 'needs_maintenance'] as const;
type RentalStatus = (typeof pcaPumpRentalStatuses)[number];
type ReturnInspectionStatus = (typeof returnInspectionStatuses)[number];

function parseRentalStatusParam(value: string | undefined) {
  if (!value || value === 'all') return { ok: true as const, status: undefined };
  if (value === 'open') return { ok: true as const, statuses: [...pcaPumpOpenRentalStatuses] };
  if (pcaPumpRentalStatuses.includes(value as RentalStatus)) {
    return { ok: true as const, status: value as RentalStatus };
  }
  return { ok: false as const };
}

function isOpenRentalStatus(
  value: RentalStatus,
): value is (typeof pcaPumpOpenRentalStatuses)[number] {
  return pcaPumpOpenRentalStatuses.includes(value as (typeof pcaPumpOpenRentalStatuses)[number]);
}

function parseReturnInspectionStatusParam(value: string | undefined) {
  if (!value) return { ok: true as const, status: undefined };
  if (returnInspectionStatuses.includes(value as ReturnInspectionStatus)) {
    return { ok: true as const, status: value as ReturnInspectionStatus };
  }
  return { ok: false as const };
}

function parseInstitutionIdFilter(searchParams: URLSearchParams) {
  const rawInstitutionId = searchParams.get('institution_id');
  if (rawInstitutionId === null) return { ok: true as const, institutionId: undefined };

  const institutionId = rawInstitutionId.trim();
  if (!institutionId) {
    return {
      ok: false as const,
      response: validationError('貸出先医療機関の指定が不正です'),
    };
  }

  return { ok: true as const, institutionId };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'PCAポンプレンタルの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const statusParam = req.nextUrl.searchParams.get('status')?.trim();
    const parsedStatus = parseRentalStatusParam(statusParam);
    if (!parsedStatus.ok) return validationError('PCAポンプレンタル状態の指定が不正です');
    const inspectionStatusParam = req.nextUrl.searchParams.get('inspection_status')?.trim();
    const parsedInspectionStatus = parseReturnInspectionStatusParam(inspectionStatusParam);
    if (!parsedInspectionStatus.ok) return validationError('返却検品状態の指定が不正です');

    const parsedInstitutionId = parseInstitutionIdFilter(req.nextUrl.searchParams);
    if (!parsedInstitutionId.ok) return parsedInstitutionId.response;

    const rentals = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const rentalRows = await tx.pcaPumpRental.findMany({
          where: {
            org_id: ctx.orgId,
            ...('statuses' in parsedStatus
              ? { status: { in: parsedStatus.statuses } }
              : parsedStatus.status
                ? { status: parsedStatus.status }
                : {}),
            ...(parsedInstitutionId.institutionId
              ? { institution_id: parsedInstitutionId.institutionId }
              : {}),
            ...(parsedInspectionStatus.status
              ? { return_inspection_status: parsedInspectionStatus.status }
              : {}),
          },
          orderBy: [{ rented_at: 'desc' }, { created_at: 'desc' }],
          take: 100,
        });
        const rentalIds = rentalRows.map((rental) => rental.id);
        const pumpIds = Array.from(new Set(rentalRows.map((rental) => rental.pump_id)));
        const institutionIds = Array.from(
          new Set(rentalRows.map((rental) => rental.institution_id)),
        );
        const accessories =
          rentalIds.length === 0
            ? []
            : await tx.pcaPumpRentalAccessory.findMany({
                where: { org_id: ctx.orgId, rental_id: { in: rentalIds } },
                orderBy: [{ created_at: 'asc' }],
              });
        const pumps =
          pumpIds.length === 0
            ? []
            : await tx.pcaPump.findMany({
                where: { org_id: ctx.orgId, id: { in: pumpIds } },
                select: {
                  id: true,
                  asset_code: true,
                  serial_number: true,
                  model_name: true,
                  status: true,
                },
              });
        const institutions =
          institutionIds.length === 0
            ? []
            : await tx.prescriberInstitution.findMany({
                where: { org_id: ctx.orgId, id: { in: institutionIds } },
                select: {
                  id: true,
                  name: true,
                  institution_code: true,
                  phone: true,
                  fax: true,
                },
              });
        const accessoriesByRentalId = new Map<string, typeof accessories>();
        for (const accessory of accessories) {
          const current = accessoriesByRentalId.get(accessory.rental_id) ?? [];
          current.push(accessory);
          accessoriesByRentalId.set(accessory.rental_id, current);
        }
        const pumpById = new Map(pumps.map((pump) => [pump.id, pump]));
        const institutionById = new Map(
          institutions.map((institution) => [institution.id, institution]),
        );

        return rentalRows.map((rental) => {
          const pump = pumpById.get(rental.pump_id);
          const institution = institutionById.get(rental.institution_id);
          if (!pump || !institution) {
            throw new Error('PCA rental relation projection is incomplete');
          }
          return {
            ...rental,
            accessories: accessoriesByRentalId.get(rental.id) ?? [],
            pump,
            institution,
          };
        });
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success({ data: rentals.map(serializePcaPumpRental) });
  });
}

export const GET = async (req: NextRequest) => {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'route_handler_unhandled_error',
          route: ROUTE,
          method: 'GET',
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
};

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプレンタルの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPcaPumpRentalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const [pump, institution] = await withOrgContext(
      ctx.orgId,
      (tx) =>
        runSequentially([
          () =>
            tx.pcaPump.findFirst({
              where: { id: parsed.data.pump_id, org_id: ctx.orgId },
              select: { id: true, status: true },
            }),
          () =>
            tx.prescriberInstitution.findFirst({
              where: { id: parsed.data.institution_id, org_id: ctx.orgId },
              select: { id: true },
            }),
        ]),
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );
    if (!pump) return notFound('PCAポンプが見つかりません');
    if (!institution) {
      return validationError('入力値が不正です', {
        institution_id: ['指定された貸出先医療機関を確認できません'],
      });
    }
    if (pump.status !== 'available') {
      return validationError('利用可能なPCAポンプだけ貸出登録できます');
    }

    const status = parsed.data.status ?? 'active';
    const requiresPumpClaim = isOpenRentalStatus(status);
    const targetPumpStatus = requiresPumpClaim
      ? 'rented'
      : status === 'returned'
        ? 'maintenance'
        : null;
    let created;
    try {
      created = await withOrgContext(
        ctx.orgId,
        async (tx) => {
          if (targetPumpStatus) {
            const claim = await tx.pcaPump.updateMany({
              where: {
                id: parsed.data.pump_id,
                org_id: ctx.orgId,
                status: 'available',
              },
              data: { status: targetPumpStatus },
            });
            if (claim.count !== 1) {
              return { kind: 'error' as const, error: 'pump_not_available' as const };
            }
          }

          const displayId = await allocateDisplayId(tx, 'PcaPumpRental', ctx.orgId);
          const rentalRow = await tx.pcaPumpRental.create({
            data: {
              org_id: ctx.orgId,
              display_id: displayId,
              pump_id: parsed.data.pump_id,
              institution_id: parsed.data.institution_id,
              status,
              rented_at: new Date(parsed.data.rented_at),
              due_at: parsed.data.due_at ? new Date(parsed.data.due_at) : null,
              returned_at: parsed.data.returned_at ? new Date(parsed.data.returned_at) : null,
              ...(status === 'returned' ? { return_inspection_status: 'pending' } : {}),
              contact_name: parsed.data.contact_name || null,
              contact_phone: parsed.data.contact_phone || null,
              rental_fee_yen: parsed.data.rental_fee_yen ?? null,
              notes: parsed.data.notes || null,
            },
          });
          await createDefaultPcaRentalAccessories(tx, {
            orgId: ctx.orgId,
            rentalId: rentalRow.id,
          });
          await createAuditLogEntry(tx, ctx, {
            action: 'pca_pump_rental_created',
            targetType: 'PcaPumpRental',
            targetId: rentalRow.id,
            changes: {
              pump_id: rentalRow.pump_id,
              institution_id: rentalRow.institution_id,
              status: rentalRow.status,
              rented_at: toDateKey(rentalRow.rented_at),
              due_at: toDateKey(rentalRow.due_at),
              returned_at: toDateKey(rentalRow.returned_at),
              return_inspection_status: rentalRow.return_inspection_status,
              rental_fee_yen: rentalRow.rental_fee_yen,
            },
          });
          const [createdPump, createdInstitution] = await runSequentially([
            () =>
              tx.pcaPump.findFirst({
                where: { id: rentalRow.pump_id, org_id: ctx.orgId },
              }),
            () =>
              tx.prescriberInstitution.findFirst({
                where: { id: rentalRow.institution_id, org_id: ctx.orgId },
              }),
          ]);
          if (!createdPump || !createdInstitution) {
            throw new Error('Created PCA rental relation projection is incomplete');
          }

          return {
            kind: 'rental' as const,
            rental: { ...rentalRow, pump: createdPump, institution: createdInstitution },
          };
        },
        { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
      );
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return validationError('このPCAポンプには未完了の貸出があるため登録できません');
      }
      throw error;
    }
    if (created.kind === 'error') {
      return validationError('利用可能なPCAポンプだけ貸出登録できます');
    }

    return success({ data: serializePcaPumpRental(created.rental) }, 201);
  });
}

export const POST = async (req: NextRequest) => {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'route_handler_unhandled_error',
          route: ROUTE,
          method: 'POST',
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
};
