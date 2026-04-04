import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const patchLabSchema = z.object({
  abnormal_flag: z.string().optional(),
  note: z.string().optional(),
  value_numeric: z.number().optional(),
  value_text: z.string().optional(),
  unit: z.string().optional(),
  reference_low: z.number().optional(),
  reference_high: z.number().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; labId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '検査値の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id, labId } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = patchLabSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.patientLabObservation.findFirst({
    where: { id: labId, org_id: ctx.orgId, patient_id: id },
  });
  if (!existing) return notFound('検査値が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.patientLabObservation.update({
      where: { id: labId },
      data: {
        ...(parsed.data.abnormal_flag !== undefined ? { abnormal_flag: parsed.data.abnormal_flag } : {}),
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(parsed.data.value_numeric !== undefined ? { value_numeric: parsed.data.value_numeric } : {}),
        ...(parsed.data.value_text !== undefined ? { value_text: parsed.data.value_text } : {}),
        ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
        ...(parsed.data.reference_low !== undefined ? { reference_low: parsed.data.reference_low } : {}),
        ...(parsed.data.reference_high !== undefined ? { reference_high: parsed.data.reference_high } : {}),
      },
    });
  }, { requestContext: ctx });

  return success(updated);
}
