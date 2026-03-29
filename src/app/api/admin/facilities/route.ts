import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
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

const facilitySchema = z.object({
  name: z.string().trim().min(1, '施設名は必須です'),
  facility_type: z.enum([
    'nursing_home',
    'group_home',
    'assisted_living',
    'clinic',
    'hospital',
    'day_service',
    'home',
    'other',
  ]),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  fax: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  contacts: z.array(facilityContactSchema).default([]),
});

function toResponse(
  facility: Prisma.FacilityGetPayload<{
    include: { contacts: true };
  }>,
) {
  return {
    id: facility.id,
    name: facility.name,
    facility_type: facility.facility_type,
    address: facility.address,
    phone: facility.phone,
    fax: facility.fax,
    notes: facility.notes,
    contacts: facility.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      email: contact.email,
      fax: contact.fax,
      is_primary: contact.is_primary,
      notes: contact.notes,
    })),
    created_at: facility.created_at.toISOString(),
    updated_at: facility.updated_at.toISOString(),
  };
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const facilities = await prisma.facility.findMany({
    where: { org_id: req.orgId },
    include: {
      contacts: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
    },
    orderBy: [{ name: 'asc' }],
  });

  return success({ data: facilities.map(toResponse) });
}, {
  permission: 'canVisit',
  message: '施設情報の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = facilitySchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const created = await withOrgContext(req.orgId, async (tx) =>
    tx.facility.create({
      data: {
        org_id: req.orgId,
        name: parsed.data.name,
        facility_type: parsed.data.facility_type,
        address: parsed.data.address || null,
        phone: parsed.data.phone || null,
        fax: parsed.data.fax || null,
        notes: parsed.data.notes || null,
        contacts: parsed.data.contacts.length
          ? {
              create: parsed.data.contacts.map((contact) => ({
                org_id: req.orgId,
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

  return success({ data: toResponse(created) }, 201);
}, {
  permission: 'canAdmin',
  message: '施設マスターの更新権限がありません',
});
