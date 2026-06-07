import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { updatePcaPumpRentalSchema } from '@/lib/validations/pca-pump-rental';

function serializeRental(item: {
  rented_at: Date;
  due_at: Date | null;
  returned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    ...item,
    rented_at: item.rented_at.toISOString().slice(0, 10),
    due_at: item.due_at?.toISOString().slice(0, 10) ?? null,
    returned_at: item.returned_at?.toISOString().slice(0, 10) ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプレンタルの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('PCAポンプレンタルIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePcaPumpRentalSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.pcaPumpRental.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, pump_id: true },
  });
  if (!existing) return notFound('PCAポンプレンタルが見つかりません');

  if (parsed.data.institution_id) {
    const institution = await prisma.prescriberInstitution.findFirst({
      where: { id: parsed.data.institution_id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!institution) return notFound('貸出先医療機関が見つかりません');
  }

  const updated = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const rental = await tx.pcaPumpRental.update({
        where: { id },
        data: {
          ...(parsed.data.institution_id !== undefined
            ? { institution_id: parsed.data.institution_id }
            : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...(parsed.data.rented_at !== undefined
            ? { rented_at: new Date(parsed.data.rented_at) }
            : {}),
          ...(parsed.data.due_at !== undefined
            ? { due_at: parsed.data.due_at ? new Date(parsed.data.due_at) : null }
            : {}),
          ...(parsed.data.returned_at !== undefined
            ? {
                returned_at: parsed.data.returned_at ? new Date(parsed.data.returned_at) : null,
              }
            : {}),
          ...(parsed.data.contact_name !== undefined
            ? { contact_name: parsed.data.contact_name || null }
            : {}),
          ...(parsed.data.contact_phone !== undefined
            ? { contact_phone: parsed.data.contact_phone || null }
            : {}),
          ...(parsed.data.rental_fee_yen !== undefined
            ? { rental_fee_yen: parsed.data.rental_fee_yen ?? null }
            : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
        },
        include: {
          pump: true,
          institution: true,
        },
      });

      if (parsed.data.status === 'returned' || parsed.data.status === 'cancelled') {
        await tx.pcaPump.update({
          where: { id: existing.pump_id },
          data: { status: 'available' },
        });
      } else if (
        parsed.data.status === 'active' ||
        parsed.data.status === 'scheduled' ||
        parsed.data.status === 'overdue'
      ) {
        await tx.pcaPump.update({
          where: { id: existing.pump_id },
          data: { status: 'rented' },
        });
      }

      return rental;
    },
    { requestContext: ctx },
  );

  return success({ data: serializeRental(updated) });
}
