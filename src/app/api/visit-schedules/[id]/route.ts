import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { updateVisitScheduleSchema } from '@/lib/validations/visit-schedule';
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

  const schedule = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      visit_record: true,
      preparation: true,
    },
  });

  if (!schedule) return notFound('訪問予定が見つかりません');

  return success(schedule);
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

  const parsed = updateVisitScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('訪問予定が見つかりません');

  const { scheduled_date, time_window_start, time_window_end, ...rest } = parsed.data;

  const schedule = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.visitSchedule.update({
      where: { id },
      data: {
        ...(scheduled_date ? { scheduled_date: new Date(scheduled_date) } : {}),
        ...(time_window_start !== undefined
          ? { time_window_start: time_window_start ? new Date(`1970-01-01T${time_window_start}`) : null }
          : {}),
        ...(time_window_end !== undefined
          ? { time_window_end: time_window_end ? new Date(`1970-01-01T${time_window_end}`) : null }
          : {}),
        ...rest,
        version: { increment: 1 },
      },
    });
  });

  return success(schedule);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('訪問予定が見つかりません');

  const schedule = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.visitSchedule.update({
      where: { id },
      data: { schedule_status: 'cancelled' },
    });
  });

  return success(schedule);
}
