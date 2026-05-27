import { notFound, success } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export const GET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const assignmentWhere = buildCareCaseAssignmentWhere({ userId: ctx.userId, role: ctx.role });

    const professional = await prisma.externalProfessional.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!professional) return notFound('他職種が見つかりません');

    const links = await prisma.careTeamLink.findMany({
      where: {
        org_id: ctx.orgId,
        external_professional_id: id,
        ...(assignmentWhere ? { case_: assignmentWhere } : {}),
      },
      orderBy: [
        { is_primary: 'desc' },
        { case_: { patient: { name_kana: 'asc' } } },
        { created_at: 'asc' },
      ],
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
              },
            },
          },
        },
      },
    });

    return success({
      data: links.map((link) => ({
        id: link.id,
        role: link.role,
        is_primary: link.is_primary,
        case_id: link.case_id,
        case_status: link.case_.status,
        patient_id: link.case_.patient.id,
        patient_name: link.case_.patient.name,
        patient_name_kana: link.case_.patient.name_kana,
      })),
    });
  },
  {
    permission: 'canReport',
    message: '担当患者一覧の閲覧権限がありません',
  },
);
