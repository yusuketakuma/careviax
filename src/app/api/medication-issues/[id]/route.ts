import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { updateMedicationIssueSchema } from '@/lib/validations/medication';
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

  const parsed = updateMedicationIssueSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.medicationIssue.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) return notFound('課題が見つかりません');

  const updateData: Record<string, unknown> = { ...parsed.data };

  // resolved / dismissed になる場合は resolved_by / resolved_at を自動セット
  if (
    parsed.data.status === 'resolved' ||
    parsed.data.status === 'dismissed'
  ) {
    updateData.resolved_by = ctx.userId;
    updateData.resolved_at = new Date();
  }

  const issue = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.medicationIssue.update({
      where: { id },
      data: updateData,
    });
  });

  return success({ data: issue });
}
