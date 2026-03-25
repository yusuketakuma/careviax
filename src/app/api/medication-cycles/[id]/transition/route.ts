import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
}

type CycleStatus =
  | 'intake_received'
  | 'structuring'
  | 'inquiry_pending'
  | 'inquiry_resolved'
  | 'ready_to_dispense'
  | 'dispensing'
  | 'dispensed'
  | 'audit_pending'
  | 'audited'
  | 'setting'
  | 'set_audited'
  | 'visit_ready'
  | 'visit_completed'
  | 'reported'
  | 'on_hold'
  | 'cancelled';

// Allowed status transitions: from -> set of valid next statuses
const ALLOWED_TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  intake_received: ['structuring', 'inquiry_pending', 'on_hold', 'cancelled'],
  structuring: ['ready_to_dispense', 'inquiry_pending', 'on_hold', 'cancelled'],
  inquiry_pending: ['inquiry_resolved', 'on_hold', 'cancelled'],
  inquiry_resolved: ['ready_to_dispense', 'on_hold', 'cancelled'],
  ready_to_dispense: ['dispensing', 'on_hold', 'cancelled'],
  dispensing: ['dispensed', 'audit_pending', 'on_hold', 'cancelled'],
  dispensed: ['audit_pending', 'on_hold', 'cancelled'],
  audit_pending: ['audited', 'dispensing', 'on_hold', 'cancelled'],
  audited: ['setting', 'on_hold', 'cancelled'],
  setting: ['set_audited', 'on_hold', 'cancelled'],
  set_audited: ['visit_ready', 'setting', 'on_hold', 'cancelled'],
  visit_ready: ['visit_completed', 'on_hold', 'cancelled'],
  visit_completed: ['reported', 'on_hold'],
  reported: ['on_hold'],
  on_hold: ['intake_received', 'structuring', 'ready_to_dispense', 'cancelled'],
  cancelled: [],
};

const transitionSchema = z.object({
  to: z.string().min(1, '遷移先ステータスは必須です'),
  version: z.number().int().min(1, 'バージョンは1以上です'),
  note: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

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

  const fromStatus = cycle.overall_status as CycleStatus;
  const toStatus = to as CycleStatus;

  const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return validationError(
      `ステータス "${fromStatus}" から "${toStatus}" への遷移は許可されていません`,
      { allowed }
    );
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const result = await tx.medicationCycle.update({
      where: { id, version },
      data: {
        overall_status: toStatus,
        version: { increment: 1 },
      },
    });

    // Create notification for status transition
    // Notification model may not exist yet — wrap in try/catch to avoid blocking
    try {
      await (tx as unknown as { notification?: { create: (args: unknown) => Promise<unknown> } }).notification?.create({
        data: {
          org_id: ctx.orgId,
          related_entity_type: 'cycle',
          related_entity_id: id,
          type: 'status_changed',
          message: note ?? `処方サイクルのステータスが ${fromStatus} から ${toStatus} に変更されました`,
          created_at: new Date(),
        },
      });
    } catch {
      // Notification creation is best-effort
    }

    return result;
  });

  return success(updated);
}
