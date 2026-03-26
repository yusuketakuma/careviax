import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { upsertShiftTemplateSchema } from '@/lib/validations/pharmacist-shift-template';

function toTimeValue(value?: string) {
  return value ? new Date(`1970-01-01T${value}`) : null;
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '定型シフトの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') ?? undefined;

  const templates = await prisma.pharmacistShiftTemplate.findMany({
    where: {
      org_id: ctx.orgId,
      ...(userId ? { user_id: userId } : {}),
    },
    orderBy: [{ user_id: 'asc' }, { weekday: 'asc' }],
    include: {
      site: {
        select: { id: true, name: true },
      },
      user: {
        select: { id: true, name: true },
      },
    },
  });

  return success({ data: templates });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '定型シフトの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = upsertShiftTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const refResult = await validateOrgReferences(ctx.orgId, {
    site_id: parsed.data.site_id,
    pharmacist_id: parsed.data.user_id,
  });
  if (!refResult.ok) return refResult.response;

  const template = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.pharmacistShiftTemplate.upsert({
      where: {
        user_id_weekday: {
          user_id: parsed.data.user_id,
          weekday: parsed.data.weekday,
        },
      },
      create: {
        org_id: ctx.orgId,
        user_id: parsed.data.user_id,
        site_id: parsed.data.site_id,
        weekday: parsed.data.weekday,
        available: parsed.data.available,
        available_from: toTimeValue(parsed.data.available_from),
        available_to: toTimeValue(parsed.data.available_to),
        note: parsed.data.note ?? null,
      },
      update: {
        site_id: parsed.data.site_id,
        available: parsed.data.available,
        available_from: toTimeValue(parsed.data.available_from),
        available_to: toTimeValue(parsed.data.available_to),
        note: parsed.data.note ?? null,
      },
    });
  });

  return success({ data: template }, 201);
}
