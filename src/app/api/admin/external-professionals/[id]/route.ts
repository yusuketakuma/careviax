import { notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';

const patchExternalProfessionalSchema = z.object({
  profession_type: z.enum([
    'physician',
    'nurse',
    'care_manager',
    'medical_social_worker',
    'physical_therapist',
    'occupational_therapist',
    'speech_therapist',
    'registered_dietitian',
    'dentist',
    'dental_hygienist',
    'home_helper',
    'care_staff',
    'other',
  ]).optional(),
  name: z.string().trim().min(1).optional(),
  organization_name: z.string().trim().nullable().optional(),
  department: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')).nullable(),
  fax: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

export const PATCH = withAuthContext<{ id: string }>(async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = patchExternalProfessionalSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.externalProfessional.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('他職種が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) =>
    tx.externalProfessional.update({
      where: { id },
      data: {
        ...(parsed.data.profession_type !== undefined ? { profession_type: parsed.data.profession_type } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.organization_name !== undefined
          ? { organization_name: parsed.data.organization_name || null }
          : {}),
        ...(parsed.data.department !== undefined ? { department: parsed.data.department || null } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
        ...(parsed.data.fax !== undefined ? { fax: parsed.data.fax || null } : {}),
        ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      },
    }),
  );

  return success({
    data: {
      ...updated,
      created_at: updated.created_at.toISOString(),
      updated_at: updated.updated_at.toISOString(),
    },
  });
}, {
  permission: 'canAdmin',
  message: '他職種マスターの更新権限がありません',
});

export const DELETE = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
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
}, {
  permission: 'canAdmin',
  message: '他職種マスターの更新権限がありません',
});
