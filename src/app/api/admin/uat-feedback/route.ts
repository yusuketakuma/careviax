import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { decodeKeysetCursor, encodeKeysetCursor } from '@/lib/api/keyset-cursor';
import { buildCursorListEnvelope } from '@/lib/api/list-envelope';
import { buildCursorPage } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';

const uatStatusSchema = z.enum(['open', 'triaged', 'in_progress', 'resolved', 'deferred']);
const UAT_FEEDBACK_LIST_LIMIT = 100;
const UAT_FEEDBACK_CURSOR_MAX_LENGTH = 2048;
const UAT_FEEDBACK_CURSOR_KEYS = ['created_at'] as const;

const createUatFeedbackSchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  feedback: z.string().trim().min(1, 'フィードバック内容は必須です'),
  checklist_progress: z.string().trim().optional(),
  checked_items: z.array(z.string()).optional(),
  source: z.string().trim().optional(),
});

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const rawCursor = req.nextUrl.searchParams.get('cursor');
    if (rawCursor !== null && rawCursor.length > UAT_FEEDBACK_CURSOR_MAX_LENGTH) {
      return validationError('カーソルが不正です');
    }
    const cursor = decodeKeysetCursor(UAT_FEEDBACK_CURSOR_KEYS, rawCursor ?? undefined);
    if (rawCursor !== null && !cursor) {
      return validationError('カーソルが不正です');
    }

    const feedback = await prisma.uatFeedback.findMany({
      where: {
        org_id: ctx.orgId,
        ...(cursor
          ? {
              OR: [
                { created_at: { lt: cursor.created_at } },
                { created_at: cursor.created_at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: UAT_FEEDBACK_LIST_LIMIT + 1,
    });
    const page = buildCursorPage(feedback, UAT_FEEDBACK_LIST_LIMIT, (item) =>
      encodeKeysetCursor(UAT_FEEDBACK_CURSOR_KEYS, item),
    );

    return success(
      buildCursorListEnvelope(
        {
          ...page,
          data: page.data.map((item) => ({
            ...item,
            checked_items: Array.isArray(item.checked_items) ? item.checked_items : [],
            due_date: item.due_date?.toISOString() ?? null,
            resolved_at: item.resolved_at?.toISOString() ?? null,
            created_at: item.created_at.toISOString(),
            updated_at: item.updated_at.toISOString(),
          })),
        },
        UAT_FEEDBACK_LIST_LIMIT,
      ),
    );
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバックの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createUatFeedbackSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const feedback = await tx.uatFeedback.create({
        data: {
          org_id: ctx.orgId,
          submitted_by: ctx.userId,
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

      await createAuditLogEntry(tx, ctx, {
        action: 'uat_feedback_created',
        targetType: 'UatFeedback',
        targetId: feedback.id,
        changes: {
          priority: feedback.priority,
          status: feedback.status,
          source: feedback.source,
          checklist_progress: feedback.checklist_progress,
          checked_items_count: Array.isArray(feedback.checked_items)
            ? feedback.checked_items.length
            : 0,
        },
      });

      return feedback;
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
      201,
    );
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバックの登録権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
