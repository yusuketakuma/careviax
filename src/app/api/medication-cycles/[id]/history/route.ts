import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { success, notFound } from '@/lib/api/response';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: '処方サイクル履歴の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const cycle = await prisma.medicationCycle.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhere ? { case_: caseAssignmentWhere } : {}),
    },
    select: { id: true },
  });
  if (!cycle) return notFound('サイクルが見つかりません');

  const logs = await prisma.cycleTransitionLog.findMany({
    where: { cycle_id: id, org_id: ctx.orgId },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      from_status: true,
      to_status: true,
      actor_id: true,
      note: true,
      created_at: true,
    },
  });

  const actorIds = [...new Set(logs.map((log) => log.actor_id))];
  const users =
    actorIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const data = logs.map((log) => ({
    id: log.id,
    from_status: log.from_status,
    to_status: log.to_status,
    actor_name: userMap.get(log.actor_id) ?? '不明',
    note: log.note,
    created_at: log.created_at,
  }));

  return success(data);
}
