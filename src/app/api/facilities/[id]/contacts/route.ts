import { z } from 'zod';
import { notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { facilityContactSchema } from '@/lib/validations/facility';

const updateFacilityContactsSchema = z.object({
  contacts: z.array(facilityContactSchema),
});

function toResponse(contacts: Array<{
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
  notes: string | null;
}>) {
  return contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    email: contact.email,
    fax: contact.fax,
    is_primary: contact.is_primary,
    notes: contact.notes,
  }));
}

export const GET = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;

  const facility = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      contacts: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
    },
  });
  if (!facility) return notFound('施設が見つかりません');

  return success({ data: toResponse(facility.contacts) });
}, {
  permission: 'canVisit',
  message: '施設担当者の閲覧権限がありません',
});

export const PUT = withAuthContext<{ id: string }>(async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateFacilityContactsSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('施設が見つかりません');

  const contacts = await withOrgContext(ctx.orgId, async (tx) => {
    await tx.facilityContact.deleteMany({
      where: { org_id: ctx.orgId, facility_id: id },
    });

    if (parsed.data.contacts.length > 0) {
      await tx.facilityContact.createMany({
        data: parsed.data.contacts.map((contact) => ({
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

    return tx.facilityContact.findMany({
      where: { org_id: ctx.orgId, facility_id: id },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    });
  });

  return success({ data: toResponse(contacts) });
}, {
  permission: 'canAdmin',
  message: '施設担当者の更新権限がありません',
});
