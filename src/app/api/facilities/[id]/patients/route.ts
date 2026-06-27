import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { internalError, notFound, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const assignmentWhere = buildCareCaseAssignmentWhere({ userId: ctx.userId, role: ctx.role });

    const facility = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!facility) return notFound('施設が見つかりません');

    const residences = await prisma.residence.findMany({
      where: {
        org_id: ctx.orgId,
        facility_id: id,
        is_primary: true,
        ...(assignmentWhere ? { patient: { cases: { some: assignmentWhere } } } : {}),
      },
      orderBy: [{ unit_name: 'asc' }, { created_at: 'asc' }],
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
    });

    return success({
      data: {
        facility_id: facility.id,
        facility_name: facility.name,
        patients: residences.map((residence) => ({
          residence_id: residence.id,
          patient_id: residence.patient.id,
          patient_name: residence.patient.name,
          patient_name_kana: residence.patient.name_kana,
          phone: residence.patient.phone,
          address: residence.address,
          unit_name: residence.unit_name,
          case_id: residence.patient.cases?.[0]?.id ?? null,
          case_status: residence.patient.cases?.[0]?.status ?? null,
        })),
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
