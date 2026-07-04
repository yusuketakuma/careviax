import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { buildCursorPage } from '@/lib/api/pagination';

const patientSelectorQuerySchema = z.object({
  archive_status: z.enum(['active', 'archived', 'all']).optional(),
  limit: optionalBoundedIntegerSearchParam('limit', 1, 200),
});

function buildPatientArchiveWhere(
  archiveStatus: 'active' | 'archived' | 'all',
): Prisma.PatientWhereInput {
  if (archiveStatus === 'active') return { archived_at: null };
  if (archiveStatus === 'archived') return { archived_at: { not: null } };
  return {};
}

function hasWhereInput(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

const authenticatedGET = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(patientSelectorQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const assignmentWhere = buildCareCaseAssignmentWhere({ userId: ctx.userId, role: ctx.role });
    const archiveStatus = parsed.data.archive_status ?? 'active';
    const limit = parsed.data.limit ?? 100;
    const patientWhere: Prisma.PatientWhereInput = {
      ...buildPatientArchiveWhere(archiveStatus),
      ...(assignmentWhere ? { cases: { some: assignmentWhere } } : {}),
    };
    const residenceWhere: Prisma.ResidenceWhereInput = {
      org_id: ctx.orgId,
      facility_id: id,
      is_primary: true,
      ...(hasWhereInput(patientWhere as Record<string, unknown>) ? { patient: patientWhere } : {}),
    };

    const facility = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!facility) return notFound('施設が見つかりません');

    const [totalCount, fetchedResidences] = await Promise.all([
      prisma.residence.count({ where: residenceWhere }),
      prisma.residence.findMany({
        where: residenceWhere,
        orderBy: [{ unit_name: 'asc' }, { created_at: 'asc' }],
        take: limit + 1,
        select: {
          id: true,
          address: true,
          unit_name: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
              phone: true,
              archived_at: true,
              cases: {
                ...(assignmentWhere ? { where: assignmentWhere } : {}),
                orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
                select: {
                  id: true,
                  status: true,
                },
                take: 1,
              },
            },
          },
        },
      }),
    ]);
    const page = buildCursorPage(fetchedResidences, limit, (residence) => residence.id);
    const residences = page.data;
    const visibleCount = residences.length;
    const hiddenCount = Math.max(totalCount - visibleCount, 0);

    return success({
      data: {
        facility_id: facility.id,
        facility_name: facility.name,
        patients: residences.map((residence) => {
          const archivedAt = residence.patient.archived_at?.toISOString() ?? null;
          return {
            residence_id: residence.id,
            patient_id: residence.patient.id,
            patient_name: residence.patient.name,
            patient_name_kana: residence.patient.name_kana,
            phone: residence.patient.phone,
            address: residence.address,
            unit_name: residence.unit_name,
            case_id: residence.patient.cases?.[0]?.id ?? null,
            case_status: residence.patient.cases?.[0]?.status ?? null,
            archived_at: archivedAt,
            archive: {
              status: archivedAt ? 'archived' : 'active',
              archived: Boolean(archivedAt),
              archived_at: archivedAt,
            },
          };
        }),
      },
      metadata: {
        limit,
        total_count: totalCount,
        visible_count: visibleCount,
        hidden_count: hiddenCount,
        has_more: page.hasMore || hiddenCount > 0,
        count_basis: 'primary_residences',
        filters_applied: {
          facility_id: facility.id,
          archive_status: archiveStatus,
          assignment_scoped: Boolean(assignmentWhere),
        },
      },
    });
  },
  {
    permission: 'canVisit',
    message: '施設所属患者の閲覧権限がありません',
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
