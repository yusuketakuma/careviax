import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const offsetDateTime = z.string().datetime({ offset: true });
const dateKey = z.string().date();

const handoffItemSchema = z
  .object({
    id: text(200),
    content: text(4_000),
    priority: text(100),
    entity_type: nullableText(100),
    entity_id: nullableText(200),
    read_by: z.array(text(200)).max(500),
    created_by: text(200),
    created_by_name: text(500),
    created_at: offsetDateTime,
    recipient_user_id: nullableText(200),
    recipient_label: nullableText(500),
    recipient_name: nullableText(500),
    lifecycle_status: nullableText(100),
    scope: nullableText(100),
    rationale: nullableText(4_000),
    deadline: offsetDateTime.nullable(),
    progress_done: z.number().int().nonnegative().nullable(),
    progress_total: z.number().int().positive().nullable(),
    direction: z.enum(['outgoing', 'incoming']),
    consult_status: nullableText(100),
    resolution_action: nullableText(100),
    resolution_note: nullableText(4_000),
    resolved_by: nullableText(200),
    resolved_at: offsetDateTime.nullable(),
  })
  .passthrough()
  .transform(
    ({
      id,
      content,
      priority,
      entity_type,
      entity_id,
      read_by,
      created_by,
      created_by_name,
      created_at,
      recipient_user_id,
      recipient_label,
      recipient_name,
      lifecycle_status,
      scope,
      rationale,
      deadline,
      progress_done,
      progress_total,
      direction,
      consult_status,
      resolution_action,
      resolution_note,
      resolved_by,
      resolved_at,
    }) => ({
      id,
      content,
      priority,
      entity_type,
      entity_id,
      read_by,
      created_by,
      created_by_name,
      created_at,
      recipient_user_id,
      recipient_label,
      recipient_name,
      lifecycle_status,
      scope,
      rationale,
      deadline,
      progress_done,
      progress_total,
      direction,
      consult_status,
      resolution_action,
      resolution_note,
      resolved_by,
      resolved_at,
    }),
  );

const recipientSchema = z
  .object({
    id: text(200),
    name: text(500),
    role: text(100),
    role_label: text(200),
  })
  .strict();

export const handoffBoardResponseSchema = z
  .object({
    data: z
      .object({
        id: text(200),
        shift_date: dateKey,
        items: z.array(handoffItemSchema).max(1_000),
        recipient_options: z.array(recipientSchema).max(1_000),
        month_item_count: z.number().int().nonnegative(),
        summary: z
          .object({
            outgoing_count: z.number().int().nonnegative(),
            incoming_count: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .passthrough()
      .transform(({ id, shift_date, items, recipient_options, month_item_count, summary }) => ({
        id,
        shift_date,
        items,
        recipient_options,
        month_item_count,
        summary,
      })),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    let previousCreatedAt: string | null = null;
    for (const [index, item] of data.items.entries()) {
      if (ids.has(item.id) || (previousCreatedAt && item.created_at < previousCreatedAt))
        context.addIssue({
          code: 'custom',
          path: ['data', 'items', index],
          message: 'Handoff item identity or order drift',
        });
      ids.add(item.id);
      previousCreatedAt = item.created_at;
      if (!item.lifecycle_status && !item.consult_status && !item.recipient_user_id)
        context.addIssue({
          code: 'custom',
          path: ['data', 'items', index],
          message: 'Legacy handoff item entered the current board',
        });
      if (
        (item.progress_done === null) !== (item.progress_total === null) ||
        (item.progress_done !== null &&
          item.progress_total !== null &&
          item.progress_done > item.progress_total)
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'items', index],
          message: 'Handoff progress drift',
        });
      if (new Set(item.read_by).size !== item.read_by.length)
        context.addIssue({
          code: 'custom',
          path: ['data', 'items', index, 'read_by'],
          message: 'Duplicate handoff reader identity',
        });
    }
    const recipientIds = data.recipient_options.map((item) => item.id);
    if (new Set(recipientIds).size !== recipientIds.length)
      context.addIssue({
        code: 'custom',
        path: ['data', 'recipient_options'],
        message: 'Duplicate handoff recipient identity',
      });
    if (
      data.month_item_count < data.items.length ||
      data.summary.incoming_count > data.items.length ||
      data.summary.outgoing_count > data.items.length
    )
      context.addIssue({
        code: 'custom',
        path: ['data', 'summary'],
        message: 'Handoff board aggregate drift',
      });
  });

const confirmationTaskSchema = z
  .object({
    id: text(200),
    task_type: z.enum(['handoff_confirmation', 'handoff_supervision_review']),
    title: text(1_000),
    priority: text(100),
    due_date: offsetDateTime.nullable(),
    related_entity_id: text(200),
    created_at: offsetDateTime,
  })
  .passthrough()
  .transform(({ id, task_type, title, priority, due_date, related_entity_id, created_at }) => ({
    id,
    task_type,
    title,
    priority,
    due_date,
    related_entity_id,
    created_at,
  }));

export const handoffConfirmationTasksResponseSchema = z
  .object({
    data: z.array(confirmationTaskSchema).max(50),
    meta: z.object({ has_more: z.literal(false), next_cursor: z.null() }).strict(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = data.map((task) => task.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'Duplicate handoff task identity',
      });
  });

const recentCommentSchema = z
  .object({
    id: text(200),
    entity_type: text(100),
    entity_id: text(200),
    content: text(4_000),
    author_id: text(200),
    author_name: text(500),
    mentions_me: z.boolean(),
    authored_by_me: z.boolean(),
    created_at: offsetDateTime,
  })
  .strict();

export const recentHandoffCommentsResponseSchema = z
  .object({ data: z.array(recentCommentSchema).max(20) })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    let previousCreatedAt: string | null = null;
    for (const [index, comment] of data.entries()) {
      if (
        ids.has(comment.id) ||
        (previousCreatedAt && comment.created_at > previousCreatedAt) ||
        (!comment.mentions_me && !comment.authored_by_me)
      )
        context.addIssue({
          code: 'custom',
          path: ['data', index],
          message: 'Recent comment identity, order, or involvement drift',
        });
      ids.add(comment.id);
      previousCreatedAt = comment.created_at;
    }
  });
