import type { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { normalizeJsonInput } from '@/lib/db/json';
import { z } from 'zod';

const convertActionItemSchema = z.object({
  action_item_index: z.number().int().min(0),
});

type ActionItem = {
  title?: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

function normalizeInputJsonArray(value: unknown): Prisma.InputJsonArray {
  const normalized = normalizeJsonInput(value);
  return Array.isArray(normalized) ? normalized : [];
}

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id } = await routeContext.params;
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = convertActionItemSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const note = await prisma.conferenceNote.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        title: true,
        case_id: true,
        action_items: true,
      },
    });

    if (!note) return notFound('カンファレンス記録が見つかりません');

    const actionItems = Array.isArray(note.action_items)
      ? ([...note.action_items] as ActionItem[])
      : [];
    const actionItem = actionItems[parsed.data.action_item_index];

    if (!actionItem?.title) {
      return validationError('指定されたアクションアイテムが見つかりません');
    }
    const actionTitle = actionItem.title;
    const dedupeKey = `conference-action-item:${note.id}:${parsed.data.action_item_index}`;

    const task = await withOrgContext(ctx.orgId, async (tx) => {
      const createdTask = await tx.task.upsert({
        where: {
          org_id_dedupe_key: {
            org_id: ctx.orgId,
            dedupe_key: dedupeKey,
          },
        },
        create: {
          org_id: ctx.orgId,
          task_type: 'conference_action_item',
          title: actionTitle,
          description: `${note.title} のアクションアイテム`,
          priority: 'normal',
          dedupe_key: dedupeKey,
          related_entity_type: 'conference_note',
          related_entity_id: note.id,
          metadata: {
            note_id: note.id,
            note_title: note.title,
            case_id: note.case_id,
            action_item_index: parsed.data.action_item_index,
            assignee_label: actionItem.assignee ?? null,
          },
        },
        update: {},
      });

      actionItems[parsed.data.action_item_index] = {
        ...actionItem,
        converted_task_id: createdTask.id,
        converted_at: new Date().toISOString(),
      };

      await tx.conferenceNote.update({
        where: { id: note.id },
        data: {
          action_items: normalizeInputJsonArray(actionItems),
        },
      });

      return createdTask;
    });

    return success({ data: task }, 201);
  },
  {
    permission: 'canReport',
    message: 'カンファレンス記録の更新権限がありません',
  }
);
