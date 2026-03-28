import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';

const templateTypeSchema = z.enum([
  'care_report',
  'tracing_report',
  'management_plan',
  'medication_calendar',
]);

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'テンプレート名は必須です').optional(),
  template_type: templateTypeSchema.optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  is_default: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '文書テンプレートの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const existing = await prisma.template.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      template_type: true,
    },
  });
  if (!existing) return notFound('文書テンプレートが見つかりません');

  const nextTemplateType = parsed.data.template_type ?? existing.template_type;
  const template = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      if (parsed.data.is_default) {
        await tx.template.updateMany({
          where: {
            org_id: ctx.orgId,
            template_type: nextTemplateType,
            is_default: true,
            id: { not: id },
          },
          data: {
            is_default: false,
          },
        });
      }

      return tx.template.update({
        where: { id },
        data: {
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.template_type
            ? { template_type: parsed.data.template_type }
            : {}),
          ...(parsed.data.content
            ? {
                content:
                  parsed.data.content as import('@prisma/client').Prisma.InputJsonValue,
              }
            : {}),
          ...(parsed.data.is_default !== undefined
            ? { is_default: parsed.data.is_default }
            : {}),
        },
      });
    },
    { requestContext: ctx }
  );

  return success({ data: template });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '文書テンプレートの削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const existing = await prisma.template.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('文書テンプレートが見つかりません');

  await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.template.delete({
        where: { id },
      }),
    { requestContext: ctx }
  );

  return success({ message: '削除しました' });
}
