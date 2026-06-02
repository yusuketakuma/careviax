import { notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { assertFacilityReference } from '@/lib/patient/facility-reference';
import { updateExternalProfessionalSchema } from '@/lib/validations/external-professional';

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

export const GET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const item = await prisma.externalProfessional.findFirst({
      where: { id, org_id: ctx.orgId },
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
    });
    if (!item) return notFound('他職種が見つかりません');

    return success({ data: toResponse(item) });
  },
  {
    permission: 'canReport',
    message: '他職種マスターの閲覧権限がありません',
  },
);

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateExternalProfessionalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.externalProfessional.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!existing) return notFound('他職種が見つかりません');

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      if (parsed.data.facility_id !== undefined) {
        await assertFacilityReference(tx, ctx.orgId, parsed.data.facility_id || null);
      }

      return tx.externalProfessional.update({
        where: { id },
        data: {
          ...(parsed.data.profession_type !== undefined
            ? { profession_type: parsed.data.profession_type }
            : {}),
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.facility_id !== undefined
            ? { facility_id: parsed.data.facility_id || null }
            : {}),
          ...(parsed.data.organization_name !== undefined
            ? { organization_name: parsed.data.organization_name || null }
            : {}),
          ...(parsed.data.department !== undefined
            ? { department: parsed.data.department || null }
            : {}),
          ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
          ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
          ...(parsed.data.fax !== undefined ? { fax: parsed.data.fax || null } : {}),
          ...(parsed.data.preferred_contact_method !== undefined
            ? { preferred_contact_method: parsed.data.preferred_contact_method || null }
            : {}),
          ...(parsed.data.preferred_contact_time !== undefined
            ? { preferred_contact_time: parsed.data.preferred_contact_time || null }
            : {}),
          ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
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

    return success({ data: toResponse(updated) });
  },
  {
    permission: 'canAdmin',
    message: '他職種マスターの更新権限がありません',
  },
);

export const DELETE = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const existing = await prisma.externalProfessional.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!existing) return notFound('他職種が見つかりません');

    await withOrgContext(ctx.orgId, async (tx) => {
      await tx.externalProfessional.delete({ where: { id } });
    });

    return success({ ok: true });
  },
  {
    permission: 'canAdmin',
    message: '他職種マスターの更新権限がありません',
  },
);
