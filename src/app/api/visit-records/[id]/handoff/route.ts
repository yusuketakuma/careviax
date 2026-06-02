import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound, error } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { confirmHandoff } from '@/server/services/visit-handoff';
import type { StructuredSoap } from '@/types/structured-soap';

const confirmHandoffSchema = z.object({
  confirmed: z.literal(true),
  edits: z
    .object({
      next_check_items: z.array(z.string()).optional(),
      ongoing_monitoring: z.array(z.string()).optional(),
      decision_rationale: z.string().optional(),
    })
    .optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = confirmHandoffSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  // Verify visit record exists and belongs to org
  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, structured_soap: true },
  });
  if (!record) return notFound('訪問記録が見つかりません');

  const { edits } = parsed.data;

  try {
    const handoff = await confirmHandoff(prisma, {
      orgId: ctx.orgId,
      visitRecordId: id,
      confirmedBy: ctx.userId,
      edits,
      requestContext: ctx,
    });
    return success(handoff);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('No handoff found')) {
      return notFound('引継ぎデータが見つかりません。AI抽出が完了していない可能性があります');
    }
    return error('internal_error', '引継ぎの確定処理に失敗しました', 500);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');
  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, structured_soap: true },
  });
  if (!record) return notFound('訪問記録が見つかりません');

  const structuredSoap =
    record.structured_soap &&
    typeof record.structured_soap === 'object' &&
    !Array.isArray(record.structured_soap)
      ? (record.structured_soap as StructuredSoap)
      : null;
  const handoff = structuredSoap?.handoff ?? null;
  if (!handoff) {
    return notFound('引継ぎデータが見つかりません');
  }

  return success({
    data: handoff,
  });
}
