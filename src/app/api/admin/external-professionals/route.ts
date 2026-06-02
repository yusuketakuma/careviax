import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { assertFacilityReference } from '@/lib/patient/facility-reference';
import {
  createExternalProfessionalSchema,
  contactMethodSchema,
  professionTypeSchema,
} from '@/lib/validations/external-professional';

function toResponse(item: {
  id: string;
  profession_type: string;
  name: string;
  facility_id: string | null;
  facility?: {
    name: string;
  } | null;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: Date | null;
  last_success_channel: string | null;
  address: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  _count?: {
    care_team_links: number;
  };
}) {
  return {
    ...item,
    facility_name: item.facility?.name ?? null,
    patient_count: item._count?.care_team_links ?? 0,
    last_contacted_at: item.last_contacted_at?.toISOString() ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const query = req.nextUrl.searchParams.get('q')?.trim();
    const facilityId = req.nextUrl.searchParams.get('facility_id')?.trim();
    const professionType = professionTypeSchema.safeParse(
      req.nextUrl.searchParams.get('profession_type')?.trim(),
    ).data;
    const preferredContactMethod = contactMethodSchema.safeParse(
      req.nextUrl.searchParams.get('preferred_contact_method')?.trim(),
    ).data;

    const items = await prisma.externalProfessional.findMany({
      where: {
        org_id: req.orgId,
        ...(professionType ? { profession_type: professionType } : {}),
        ...(facilityId ? { facility_id: facilityId } : {}),
        ...(preferredContactMethod ? { preferred_contact_method: preferredContactMethod } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { organization_name: { contains: query, mode: 'insensitive' } },
                { facility: { name: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        facility: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            care_team_links: true,
          },
        },
      },
      orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
    });

    return success({ data: items.map(toResponse) });
  },
  {
    permission: 'canReport',
    message: '他職種マスターの閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createExternalProfessionalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(req.orgId, async (tx) => {
      await assertFacilityReference(tx, req.orgId, parsed.data.facility_id || null);

      return tx.externalProfessional.create({
        data: {
          org_id: req.orgId,
          profession_type: parsed.data.profession_type,
          name: parsed.data.name,
          facility_id: parsed.data.facility_id || null,
          organization_name: parsed.data.organization_name || null,
          department: parsed.data.department || null,
          phone: parsed.data.phone || null,
          email: parsed.data.email || null,
          fax: parsed.data.fax || null,
          preferred_contact_method: parsed.data.preferred_contact_method || null,
          preferred_contact_time: parsed.data.preferred_contact_time || null,
          address: parsed.data.address || null,
          notes: parsed.data.notes || null,
        },
        include: {
          facility: {
            select: {
              name: true,
            },
          },
        },
      });
    });

    return success({ data: toResponse(created) }, 201);
  },
  {
    permission: 'canAdmin',
    message: '他職種マスターの更新権限がありません',
  },
);
