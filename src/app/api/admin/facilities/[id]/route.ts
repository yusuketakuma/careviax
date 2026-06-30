import { unstable_rethrow } from 'next/navigation';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { serializeFacilityResponse, toFacilityTimeValue } from '@/lib/facilities/facility-api';
import { updateFacilitySchema } from '@/lib/validations/facility';

function staleFacilityConflict(expectedUpdatedAt: string, currentUpdatedAt: Date | null) {
  return conflict('施設マスターが更新されています。再読み込みしてください', {
    conflict_type: 'stale_facility',
    expected_updated_at: expectedUpdatedAt,
    current_updated_at: currentUpdatedAt?.toISOString() ?? null,
  });
}

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const facility = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      include: {
        contacts: {
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        },
        _count: {
          select: {
            residences: true,
          },
        },
      },
    });
    if (!facility) return notFound('施設が見つかりません');

    const patient_count = await prisma.residence.count({
      where: {
        org_id: ctx.orgId,
        facility_id: id,
        is_primary: true,
      },
    });

    return success({
      data: serializeFacilityResponse({ ...facility, patient_count }, { includeTimestamps: true }),
    });
  },
  {
    permission: 'canVisit',
    message: '施設マスターの閲覧権限がありません',
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

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateFacilitySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);

    const existing = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, updated_at: true },
    });
    if (!existing) return notFound('施設が見つかりません');
    if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
      return staleFacilityConflict(parsed.data.expected_updated_at, existing.updated_at);
    }

    const contacts = parsed.data.contacts;
    const hasScalarUpdates =
      parsed.data.name !== undefined ||
      parsed.data.facility_type !== undefined ||
      parsed.data.address !== undefined ||
      parsed.data.phone !== undefined ||
      parsed.data.fax !== undefined ||
      parsed.data.acceptance_time_from !== undefined ||
      parsed.data.acceptance_time_to !== undefined ||
      parsed.data.regular_visit_weekdays !== undefined ||
      parsed.data.notes !== undefined;
    if (contacts === undefined && !hasScalarUpdates) {
      return validationError('更新内容がありません');
    }

    const nextUpdatedAt = new Date();
    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const data = {
        updated_at: nextUpdatedAt,
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.facility_type !== undefined
          ? { facility_type: parsed.data.facility_type }
          : {}),
        ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
        ...(parsed.data.fax !== undefined ? { fax: parsed.data.fax || null } : {}),
        ...(parsed.data.acceptance_time_from !== undefined
          ? { acceptance_time_from: toFacilityTimeValue(parsed.data.acceptance_time_from) }
          : {}),
        ...(parsed.data.acceptance_time_to !== undefined
          ? { acceptance_time_to: toFacilityTimeValue(parsed.data.acceptance_time_to) }
          : {}),
        ...(parsed.data.regular_visit_weekdays !== undefined
          ? {
              regular_visit_weekdays: toPrismaJsonInput(parsed.data.regular_visit_weekdays),
            }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      };

      const claimed = await tx.facility.updateMany({
        where: { id, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        data,
      });
      if (claimed.count !== 1) {
        return {
          kind: 'response' as const,
          response: staleFacilityConflict(parsed.data.expected_updated_at, existing.updated_at),
        };
      }

      if (contacts !== undefined) {
        await tx.facilityContact.deleteMany({
          where: { org_id: ctx.orgId, facility_id: id },
        });

        if (contacts.length > 0) {
          await tx.facilityContact.createMany({
            data: contacts.map((contact) => ({
              org_id: ctx.orgId,
              facility_id: id,
              name: contact.name,
              role: contact.role || null,
              phone: contact.phone || null,
              email: contact.email || null,
              fax: contact.fax || null,
              is_primary: contact.is_primary,
              notes: contact.notes || null,
            })),
          });
        }
      }

      const facility = await tx.facility.findFirst({
        where: { id, org_id: ctx.orgId },
        include: {
          contacts: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
          },
        },
      });
      if (!facility) {
        return { kind: 'response' as const, response: notFound('施設が見つかりません') };
      }
      return { kind: 'updated' as const, facility };
    });
    if (updated.kind === 'response') return updated.response;

    return success({
      data: serializeFacilityResponse(updated.facility, { includeTimestamps: true }),
    });
  },
  {
    permission: 'canAdmin',
    message: '施設マスターの更新権限がありません',
  },
);

export const DELETE = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const existing = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!existing) return notFound('施設が見つかりません');

    try {
      await withOrgContext(ctx.orgId, async (tx) => {
        const linkedResidence = await tx.residence.findFirst({
          where: {
            org_id: ctx.orgId,
            facility_id: id,
          },
          select: {
            id: true,
          },
        });
        if (linkedResidence) {
          throw new Error('FACILITY_IN_USE');
        }

        await tx.facility.delete({ where: { id } });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'FACILITY_IN_USE') {
        return conflict('利用中の患者がいる施設は削除できません');
      }
      throw error;
    }

    return success({ ok: true });
  },
  {
    permission: 'canAdmin',
    message: '施設マスターの更新権限がありません',
  },
);
