import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import {
  transitionCycleStatus,
  getPreHoldStatus,
  ALLOWED_TRANSITIONS,
} from '@/lib/db/cycle-transition';
import { z } from 'zod';

const transitionSchema = z.object({
  to: z.string().min(1, '遷移先ステータスは必須です'),
  version: z.number().int().min(1, 'バージョンは1以上です'),
  note: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '処方サイクル更新の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { to, version, note } = parsed.data;

  const cycle = await prisma.medicationCycle.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, overall_status: true, version: true, patient_id: true, case_id: true },
  });
  if (!cycle) return notFound('サイクルが見つかりません');

  // Optimistic lock check
  if (cycle.version !== version) {
    return conflict('他のユーザーによって更新されています。最新のデータを取得してください。');
  }

  const fromStatus = cycle.overall_status;
  const toStatus = to;

  // B6: For on_hold recovery, derive valid return targets from pre-hold status
  let allowed: string[] = ALLOWED_TRANSITIONS[fromStatus as keyof typeof ALLOWED_TRANSITIONS] ?? [];
  if (fromStatus === 'on_hold') {
    const preHoldStatus = await getPreHoldStatus(
      prisma as unknown as Parameters<typeof getPreHoldStatus>[0],
      id,
    );
    if (preHoldStatus) {
      allowed = [preHoldStatus, 'cancelled'];
    }
  }

  if (!allowed.includes(toStatus)) {
    return validationError(
      `ステータス "${fromStatus}" から "${toStatus}" への遷移は許可されていません`,
      { allowed }
    );
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const result = await transitionCycleStatus(tx, id, ctx.orgId, toStatus, ctx.userId, { note: note ?? undefined });

    // Create notification for status transition (best-effort)
    try {
      await tx.notification.create({
        data: {
          org_id: ctx.orgId,
          user_id: ctx.userId,
          event_type: 'status_changed',
          type: 'system',
          title: 'ステータス変更',
          message: note ?? `処方サイクルのステータスが ${fromStatus} から ${toStatus} に変更されました`,
          link: `/workflow`,
          metadata: { cycle_id: id, from: fromStatus, to: toStatus },
        },
      });
    } catch {
      // Notification creation is best-effort
    }

    return result;
  });

  // Broadcast realtime event (best-effort)
  try {
    const adapter = getRealtimeAdapter();
    adapter.broadcastStatusUpdate(`org:${ctx.orgId}`, {
      type: 'cycle_transition',
      payload: { cycleId: id, from: fromStatus, to: toStatus },
    });
  } catch {
    // Realtime broadcast is best-effort
  }

  return success(updated);
}
