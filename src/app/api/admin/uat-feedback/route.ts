import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const uatStatusSchema = z.enum(['open', 'triaged', 'in_progress', 'resolved', 'deferred']);

const createUatFeedbackSchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  feedback: z.string().trim().min(1, 'フィードバック内容は必須です'),
  checklist_progress: z.string().trim().optional(),
  checked_items: z.array(z.string()).optional(),
  source: z.string().trim().optional(),
});

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const feedback = await prisma.uatFeedback.findMany({
      where: {
        org_id: req.orgId,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 100,
    });

    return success({
      data: feedback.map((item) => ({
        ...item,
        checked_items: Array.isArray(item.checked_items) ? item.checked_items : [],
        due_date: item.due_date?.toISOString() ?? null,
        resolved_at: item.resolved_at?.toISOString() ?? null,
        created_at: item.created_at.toISOString(),
        updated_at: item.updated_at.toISOString(),
      })),
    });
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバックの閲覧権限がありません',
  }
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createUatFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await prisma.uatFeedback.create({
      data: {
        org_id: req.orgId,
        submitted_by: req.userId,
        priority: parsed.data.priority,
        status: uatStatusSchema.enum.open,
        owner_user_id: null,
        feedback: parsed.data.feedback,
        checklist_progress: parsed.data.checklist_progress ?? null,
        checked_items: parsed.data.checked_items ?? Prisma.JsonNull,
        source: parsed.data.source?.trim() || 'pilot_pharmacy',
        linked_work_item: null,
        due_date: null,
        resolved_at: null,
      },
    });

    return success(
      {
        data: {
          ...created,
          checked_items: Array.isArray(created.checked_items) ? created.checked_items : [],
          due_date: created.due_date?.toISOString() ?? null,
          resolved_at: created.resolved_at?.toISOString() ?? null,
          created_at: created.created_at.toISOString(),
          updated_at: created.updated_at.toISOString(),
        },
      },
      201
    );
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバックの登録権限がありません',
  }
);
