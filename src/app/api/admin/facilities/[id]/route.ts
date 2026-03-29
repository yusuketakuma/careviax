import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';

const facilityContactSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, '担当者名は必須です'),
  role: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')),
  fax: z.string().trim().optional(),
  is_primary: z.boolean().default(false),
  notes: z.string().trim().optional(),
});

const patchFacilitySchema = z.object({
  name: z.string().trim().min(1).optional(),
  facility_type: z.enum([
    'nursing_home',
    'group_home',
    'assisted_living',
    'clinic',
    'hospital',
    'day_service',
    'home',
    'other',
  ]).optional(),
  address: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  fax: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  contacts: z.array(facilityContactSchema).optional(),
});

export const PATCH = withAuthContext<{ id: string }>(async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = patchFacilitySchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('施設が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    if (parsed.data.contacts) {
      await tx.facilityContact.deleteMany({
        where: { org_id: ctx.orgId, facility_id: id },
      });
    }

    return tx.facility.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.facility_type !== undefined ? { facility_type: parsed.data.facility_type } : {}),
        ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
        ...(parsed.data.fax !== undefined ? { fax: parsed.data.fax || null } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
        ...(parsed.data.contacts
          ? {
              contacts: {
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
              },
            }
          : {}),
      },
      include: {
        contacts: {
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        },
      },
    });
  });

  return success({
    data: {
      id: updated.id,
      name: updated.name,
      facility_type: updated.facility_type,
      address: updated.address,
      phone: updated.phone,
      fax: updated.fax,
      notes: updated.notes,
      contacts: updated.contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        role: contact.role,
        phone: contact.phone,
        email: contact.email,
        fax: contact.fax,
        is_primary: contact.is_primary,
        notes: contact.notes,
      })),
    },
  });
}, {
  permission: 'canAdmin',
  message: '施設マスターの更新権限がありません',
});

export const DELETE = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
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
          building_id: id,
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
}, {
  permission: 'canAdmin',
  message: '施設マスターの更新権限がありません',
});
