import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const offsetDateTime = z.string().datetime({ offset: true });

const commentSchema = z
  .object({
    id: text(200),
    author_id: text(200),
    author_name: text(500),
    content: text(4_000),
    mentions: z.array(text(100)).max(20),
    created_at: offsetDateTime,
  })
  .passthrough()
  .transform(({ id, author_id, author_name, content, mentions, created_at }) => ({
    id,
    author_id,
    author_name,
    content,
    mentions,
    created_at,
  }));

export const commentListResponseSchema = z
  .object({ data: z.array(commentSchema).max(100) })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    let previousCreatedAt: string | null = null;
    for (const [index, comment] of data.entries()) {
      if (ids.has(comment.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate comment identity',
        });
      }
      ids.add(comment.id);
      if (new Set(comment.mentions).size !== comment.mentions.length) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'mentions'],
          message: 'Duplicate comment mention identity',
        });
      }
      if (previousCreatedAt && comment.created_at < previousCreatedAt) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'created_at'],
          message: 'Comments are not oldest first',
        });
      }
      previousCreatedAt = comment.created_at;
    }
  });

export function buildCreateCommentResponseSchema(args: {
  entityType: string;
  entityId: string;
  content: string;
  mentions: string[];
}) {
  return z
    .object({
      data: z
        .object({
          id: text(200),
          entity_type: z.literal(args.entityType),
          entity_id: z.literal(args.entityId),
          content: z.literal(args.content.trim()),
          mentions: z.array(text(100)).max(20),
          created_at: offsetDateTime,
        })
        .passthrough()
        .transform(({ id, entity_type, entity_id, content, mentions, created_at }) => ({
          id,
          entity_type,
          entity_id,
          content,
          mentions,
          created_at,
        })),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const expectedMentions = [...new Set(args.mentions)];
      if (
        data.mentions.length !== expectedMentions.length ||
        data.mentions.some((mention, index) => mention !== expectedMentions[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'mentions'],
          message: 'Created comment mentions differ from the request',
        });
      }
    });
}

export const deleteCommentResponseSchema = z
  .object({
    data: z.object({ deleted: z.literal(true) }).strict(),
  })
  .strict();
