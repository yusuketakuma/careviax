import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { updateCaseSchema } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
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

  const parsed = updateCaseSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.careCase.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('ケースが見つかりません');

  const { start_date, end_date, ...rest } = parsed.data;

  const careCase = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.careCase.update({
      where: { id },
      data: {
        ...(start_date ? { start_date: new Date(start_date) } : {}),
        ...(end_date ? { end_date: new Date(end_date) } : {}),
        ...rest,
      },
    });
  });

  return success(careCase);
}
