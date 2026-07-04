import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { buildCursorPage } from '@/lib/api/pagination';

const linkedPatientsQuerySchema = z.object({
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
    const parsed = parseSearchParams(linkedPatientsQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const assignmentWhere = buildCareCaseAssignmentWhere({ userId: ctx.userId, role: ctx.role });
    const archiveStatus = parsed.data.archive_status ?? 'active';
    const limit = parsed.data.limit ?? 100;
    const patientWhere = buildPatientArchiveWhere(archiveStatus);
    const caseWhere: Prisma.CareCaseWhereInput = {
      ...(assignmentWhere ?? {}),
      ...(hasWhereInput(patientWhere as Record<string, unknown>) ? { patient: patientWhere } : {}),
    };
    const linkWhere: Prisma.CareTeamLinkWhereInput = {
      org_id: ctx.orgId,
      external_professional_id: id,
      ...(hasWhereInput(caseWhere as Record<string, unknown>) ? { case_: caseWhere } : {}),
    };

    const professional = await prisma.externalProfessional.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!professional) return notFound('他職種が見つかりません');

    const [totalCount, fetchedLinks] = await Promise.all([
      prisma.careTeamLink.count({ where: linkWhere }),
      prisma.careTeamLink.findMany({
        where: linkWhere,
        orderBy: [
          { is_primary: 'desc' },
          { case_: { patient: { name_kana: 'asc' } } },
          { created_at: 'asc' },
        ],
        take: limit + 1,
        select: {
          id: true,
          role: true,
          is_primary: true,
          case_id: true,
          case_: {
            select: {
              id: true,
              status: true,
              patient: {
                select: {
                  id: true,
                  name: true,
                  name_kana: true,
                  archived_at: true,
                },
              },
            },
          },
        },
      }),
    ]);
    const page = buildCursorPage(fetchedLinks, limit, (link) => link.id);
    const links = page.data;
    const visibleCount = links.length;
    const hiddenCount = Math.max(totalCount - visibleCount, 0);

    return success({
      data: links.map((link) => {
        const archivedAt = link.case_.patient.archived_at?.toISOString() ?? null;
        return {
          id: link.id,
          role: link.role,
          is_primary: link.is_primary,
          case_id: link.case_id,
          case_status: link.case_.status,
          patient_id: link.case_.patient.id,
          patient_name: link.case_.patient.name,
          patient_name_kana: link.case_.patient.name_kana,
          archived_at: archivedAt,
          archive: {
            status: archivedAt ? 'archived' : 'active',
            archived: Boolean(archivedAt),
            archived_at: archivedAt,
          },
        };
      }),
      metadata: {
        limit,
        total_count: totalCount,
        visible_count: visibleCount,
        hidden_count: hiddenCount,
        has_more: page.hasMore || hiddenCount > 0,
        count_basis: 'care_team_links',
        filters_applied: {
          external_professional_id: professional.id,
          archive_status: archiveStatus,
          assignment_scoped: Boolean(assignmentWhere),
        },
      },
    });
  },
  {
    permission: 'canReport',
    message: '担当患者一覧の閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(
      await authenticatedGET(req, routeContext as AuthRouteContext<{ id: string }>),
    );
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
