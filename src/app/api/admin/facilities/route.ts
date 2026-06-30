import { unstable_rethrow } from 'next/navigation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { createFacilitySchema } from '@/lib/validations/facility';
import { serializeFacilityResponse, toFacilityTimeValue } from '@/lib/facilities/facility-api';

function normalizeSearchQuery(value: string | null) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.slice(0, 100);
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const isSearchMode = searchParams.has('q') || searchParams.has('limit');

    if (isSearchMode) {
      const query = normalizeSearchQuery(searchParams.get('q'));
      const limit = parseBoundedInteger(searchParams.get('limit'), 8, 1, 50);
      const where = {
        org_id: ctx.orgId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { address: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [totalCount, facilities] = await Promise.all([
        prisma.facility.count({ where }),
        prisma.facility.findMany({
          where,
          select: {
            id: true,
            name: true,
            facility_type: true,
            address: true,
          },
          take: limit + 1,
          orderBy: [{ name: 'asc' }],
        }),
      ]);
      const hasMore = facilities.length > limit;
      const data = hasMore ? facilities.slice(0, limit) : facilities;
      const visibleCount = data.length;
      const hiddenCount = Math.max(totalCount - visibleCount, 0);
      const facilityIds = data.map((facility) => facility.id);
      const residenceCounts =
        facilityIds.length === 0
          ? []
          : await prisma.residence.groupBy({
              by: ['facility_id'],
              where: {
                org_id: ctx.orgId,
                is_primary: true,
                facility_id: {
                  in: facilityIds,
                },
              },
              _count: {
                _all: true,
              },
            });
      const patientCountByFacilityId = new Map(
        residenceCounts
          .filter((item) => item.facility_id)
          .map((item) => [item.facility_id as string, item._count._all]),
      );

      return success({
        data: data.map((facility) => ({
          id: facility.id,
          name: facility.name,
          facility_type: facility.facility_type,
          address: facility.address,
          patient_count: patientCountByFacilityId.get(facility.id) ?? 0,
        })),
        hasMore: hasMore || hiddenCount > 0,
        total_count: totalCount,
        visible_count: visibleCount,
        hidden_count: hiddenCount,
        truncated: hiddenCount > 0,
        count_basis: 'facilities',
        filters_applied: {
          q: query,
        },
        limit,
      });
    }

    const [facilities, residenceCounts] = await Promise.all([
      prisma.facility.findMany({
        where: { org_id: ctx.orgId },
        include: {
          contacts: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
          },
        },
        orderBy: [{ name: 'asc' }],
      }),
      prisma.residence.groupBy({
        by: ['facility_id'],
        where: {
          org_id: ctx.orgId,
          is_primary: true,
          facility_id: {
            not: null,
          },
        },
        _count: {
          _all: true,
        },
      }),
    ]);
    const patientCountByFacilityId = new Map(
      residenceCounts
        .filter((item) => item.facility_id)
        .map((item) => [item.facility_id as string, item._count._all]),
    );

    return success({
      data: facilities.map((facility) =>
        serializeFacilityResponse(
          {
            ...facility,
            patient_count: patientCountByFacilityId.get(facility.id) ?? 0,
          },
          { includeTimestamps: true },
        ),
      ),
      total_count: facilities.length,
      visible_count: facilities.length,
      hidden_count: 0,
      truncated: false,
      count_basis: 'facilities',
      filters_applied: {
        q: null,
      },
    });
  },
  {
    permission: 'canVisit',
    message: '施設情報の閲覧権限がありません',
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

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFacilitySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, async (tx) =>
      tx.facility.create({
        data: {
          org_id: ctx.orgId,
          name: parsed.data.name,
          facility_type: parsed.data.facility_type,
          address: parsed.data.address || null,
          phone: parsed.data.phone || null,
          fax: parsed.data.fax || null,
          acceptance_time_from: toFacilityTimeValue(parsed.data.acceptance_time_from),
          acceptance_time_to: toFacilityTimeValue(parsed.data.acceptance_time_to),
          regular_visit_weekdays: toPrismaJsonInput(parsed.data.regular_visit_weekdays),
          notes: parsed.data.notes || null,
          contacts: parsed.data.contacts.length
            ? {
                create: parsed.data.contacts.map((contact) => ({
                  org_id: ctx.orgId,
                  name: contact.name,
                  role: contact.role || null,
                  phone: contact.phone || null,
                  email: contact.email || null,
                  fax: contact.fax || null,
                  is_primary: contact.is_primary,
                  notes: contact.notes || null,
                })),
              }
            : undefined,
        },
        include: {
          contacts: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
          },
        },
      }),
    );

    return success({ data: serializeFacilityResponse(created, { includeTimestamps: true }) }, 201);
  },
  {
    permission: 'canAdmin',
    message: '施設マスターの更新権限がありません',
  },
);
