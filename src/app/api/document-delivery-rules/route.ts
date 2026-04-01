import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';

const deliveryChannelSchema = z.enum(['email', 'fax', 'mcs']);

const createDocumentDeliveryRuleSchema = z.object({
  document_type: z.string().trim().min(1, 'document_type は必須です'),
  target_role: z.string().trim().min(1, 'target_role は必須です'),
  channel: deliveryChannelSchema,
  fallback_channels: z.array(deliveryChannelSchema).default([]),
  is_active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const documentType = searchParams.get('document_type');

  const rules = await withOrgContext(ctx.orgId, (tx) =>
    tx.documentDeliveryRule.findMany({
      where: {
        org_id: ctx.orgId,
        ...(documentType ? { document_type: documentType } : {}),
      },
      orderBy: [{ document_type: 'asc' }, { target_role: 'asc' }, { updated_at: 'desc' }],
    })
  );

  return success({ data: rules });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createDocumentDeliveryRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.documentDeliveryRule.create({
      data: {
        org_id: ctx.orgId,
        document_type: parsed.data.document_type,
        target_role: parsed.data.target_role,
        channel: parsed.data.channel,
        fallback_channels: parsed.data.fallback_channels as Prisma.InputJsonValue,
        is_active: parsed.data.is_active,
      },
    })
  );

  return success({ data: rule }, 201);
}
