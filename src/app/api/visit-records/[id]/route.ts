import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict, forbidden } from '@/lib/api/response';
import { updateVisitRecordSchema } from '@/lib/validations/visit-record';
import { prisma } from '@/lib/db/client';

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      schedule: {
        select: {
          visit_type: true,
          scheduled_date: true,
          recurrence_rule: true,
        },
      },
    },
  });

  if (!record) return notFound('訪問記録が見つかりません');

  return success(record);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateVisitRecordSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { version, next_visit_suggestion_date, visit_date, ...rest } = parsed.data;

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    // Optimistic lock: check version
    const existing = await tx.visitRecord.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, version: true },
    });
    if (!existing) return null;
    if (existing.version !== version) return 'conflict' as const;

    return tx.visitRecord.update({
      where: { id },
      data: {
        ...rest,
        ...(visit_date ? { visit_date: new Date(visit_date) } : {}),
        ...(next_visit_suggestion_date
          ? { next_visit_suggestion_date: new Date(next_visit_suggestion_date) }
          : {}),
        version: { increment: 1 },
      } as Prisma.VisitRecordUncheckedUpdateInput,
    });
  });

  if (!updated) return notFound('訪問記録が見つかりません');
  if (updated === 'conflict') {
    return conflict('他のユーザーによって更新されました。最新データを取得してから再試行してください');
  }

  return success(updated);
}
