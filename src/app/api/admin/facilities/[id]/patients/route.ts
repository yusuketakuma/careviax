import { unstable_rethrow } from 'next/navigation';
import { internalError, notFound, success } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const facility = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!facility) return notFound('施設が見つかりません');

    const residences = await prisma.residence.findMany({
      where: {
        org_id: ctx.orgId,
        facility_id: id,
        is_primary: true,
      },
      select: {
        id: true,
        unit_name: true,
        facility_unit_id: true,
        patient: {
          select: {
            id: true,
            name: true,
            name_kana: true,
            phone: true,
            cases: {
              orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
              take: 1,
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    const data = residences
      .map((residence) => ({
        residence_id: residence.id,
        patient_id: residence.patient.id,
        patient_name: residence.patient.name,
        patient_name_kana: residence.patient.name_kana,
        phone: residence.patient.phone,
        unit_name: residence.unit_name,
        facility_unit_id: residence.facility_unit_id,
        case_id: residence.patient.cases[0]?.id ?? null,
        case_status: residence.patient.cases[0]?.status ?? null,
      }))
      .sort((a, b) => a.patient_name_kana.localeCompare(b.patient_name_kana, 'ja'));

    return success({ data });
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
