import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';

const templateTypeSchema = z.enum([
  'care_report',
  'tracing_report',
  'management_plan',
  'medication_calendar',
]);

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'テンプレート名は必須です'),
  template_type: templateTypeSchema,
  content: z.record(z.string(), z.unknown()),
  is_default: z.boolean().optional().default(false),
});

export const GET = withAuthContext(
  async (req, authCtx) => {
    const { searchParams } = new URL(req.url);
    const templateTypeRaw = searchParams.get('template_type');
    const parsedType = templateTypeRaw
      ? templateTypeSchema.safeParse(templateTypeRaw)
      : null;

    if (parsedType && !parsedType.success) {
      return validationError('クエリパラメータが不正です', {
        template_type: ['template_type が不正です'],
      });
    }

    const templates = await prisma.template.findMany({
      where: {
        org_id: authCtx.orgId,
        ...(parsedType?.success ? { template_type: parsedType.data } : {}),
      },
      orderBy: [{ is_default: 'desc' }, { updated_at: 'desc' }],
      select: {
        id: true,
        name: true,
        template_type: true,
        content: true,
        is_default: true,
        created_at: true,
        updated_at: true,
      },
    });

    return success({ data: templates });
  },
  { permission: 'canAdmin', message: '文書テンプレートの閲覧権限がありません' }
);

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const template = await withOrgContext(
      authCtx.orgId,
      async (tx) => {
        if (parsed.data.is_default) {
          await tx.template.updateMany({
            where: {
              org_id: authCtx.orgId,
              template_type: parsed.data.template_type,
              is_default: true,
            },
            data: {
              is_default: false,
            },
          });
        }

        return tx.template.create({
          data: {
            org_id: authCtx.orgId,
            name: parsed.data.name,
            template_type: parsed.data.template_type,
            content: parsed.data.content as import('@prisma/client').Prisma.InputJsonValue,
            is_default: parsed.data.is_default,
          },
        });
      },
      { requestContext: authCtx }
    );

    return success({ data: template }, 201);
  },
  { permission: 'canAdmin', message: '文書テンプレートの作成権限がありません' }
);
