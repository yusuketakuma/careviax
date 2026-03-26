import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const updateDispenseTaskSchema = z.object({
  assigned_to: z.string().optional(),
  priority: z.enum(['emergency', 'urgent', 'normal']).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
});

// Status transition order: pending → in_progress → completed (no reversal)
const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (authReq: AuthenticatedRequest) => {
    const { id } = await params;

    const task = await prisma.dispenseTask.findFirst({
      where: { id, org_id: authReq.orgId },
      include: {
        results: true,
        audits: true,
        cycle: {
          select: {
            id: true,
            patient_id: true,
            overall_status: true,
            case_: {
              select: {
                id: true,
                patient: {
                  select: {
                    id: true,
                    name: true,
                    name_kana: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!task) return notFound('タスクが見つかりません');

    return success(task);
  })(req);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (authReq: AuthenticatedRequest) => {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateDispenseTaskSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { assigned_to, priority, due_date, status } = parsed.data;

    const existing = await prisma.dispenseTask.findFirst({
      where: { id, org_id: authReq.orgId },
      select: { id: true, status: true, assigned_to: true },
    });
    if (!existing) return notFound('タスクが見つかりません');

    // Validate status transition: no reversal allowed
    if (status !== undefined) {
      const currentOrder = STATUS_ORDER[existing.status] ?? 0;
      const nextOrder = STATUS_ORDER[status] ?? 0;
      if (nextOrder < currentOrder) {
        return validationError(
          `ステータス "${existing.status}" から "${status}" への遷移は許可されていません`,
          { current: existing.status, requested: status }
        );
      }
    }

    // Auto-assign current user when transitioning to in_progress without assignee
    let resolvedAssignedTo = assigned_to;
    if (status === 'in_progress' && resolvedAssignedTo === undefined) {
      if (!existing.assigned_to) {
        resolvedAssignedTo = authReq.userId;
      }
    }

    const updated = await withOrgContext(authReq.orgId, async (tx) => {
      return tx.dispenseTask.update({
        where: { id },
        data: {
          ...(resolvedAssignedTo !== undefined ? { assigned_to: resolvedAssignedTo } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(due_date !== undefined ? { due_date: due_date ? new Date(due_date) : null } : {}),
          ...(status !== undefined ? { status } : {}),
        },
        include: {
          results: true,
          audits: true,
          cycle: {
            select: {
              id: true,
              patient_id: true,
              overall_status: true,
              case_: {
                select: {
                  id: true,
                  patient: {
                    select: {
                      id: true,
                      name: true,
                      name_kana: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    return success(updated);
  })(req);
}
