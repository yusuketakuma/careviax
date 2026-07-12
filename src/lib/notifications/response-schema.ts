import { z } from 'zod';

const NOTIFICATION_TYPES = z.enum(['urgent', 'business', 'reminder', 'system']);
const NOTIFICATION_ID = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, {
    message: 'Expected non-empty notification id',
  });
const NOTIFICATION_EVENT_TYPE = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, { message: 'Expected non-empty event type' })
  .nullable()
  .optional();
const NOTIFICATION_TITLE = z
  .string()
  .max(500)
  .refine((value) => value.trim().length > 0, { message: 'Expected non-empty notification title' })
  .nullable()
  .optional();
const NOTIFICATION_MESSAGE = z
  .string()
  .max(4_000)
  .refine((value) => value.trim().length > 0, {
    message: 'Expected non-empty notification message',
  });
const INTERNAL_NOTIFICATION_LINK = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'Notification link must be an internal path',
  });
const NOTIFICATION_TIMESTAMP = z.string().datetime({ offset: true });

const notificationItemSchema = z
  .object({
    id: NOTIFICATION_ID,
    type: NOTIFICATION_TYPES,
    event_type: NOTIFICATION_EVENT_TYPE,
    title: NOTIFICATION_TITLE,
    message: NOTIFICATION_MESSAGE,
    link: INTERNAL_NOTIFICATION_LINK.nullable().optional(),
    created_at: NOTIFICATION_TIMESTAMP,
    is_read: z.boolean(),
  })
  .strip();

const notificationMetaSchema = z
  .object({
    limit: z.number().finite().int().min(1).max(100),
    has_more: z.boolean(),
    next_cursor: NOTIFICATION_ID.nullable(),
  })
  .strict();

export const notificationsResponseSchema = z
  .object({
    data: z.array(notificationItemSchema).max(100),
    meta: notificationMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const notificationIds = new Set<string>();
    for (const [index, notification] of data.entries()) {
      if (notificationIds.has(notification.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate notification identity',
        });
      }
      notificationIds.add(notification.id);
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Notification data exceeds the requested limit',
      });
    }

    if (meta.has_more && data.length !== meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'has_more'],
        message: 'A truncated notification page must be full',
      });
    }

    if (meta.has_more && meta.next_cursor === null) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'A truncated notification page must provide a cursor',
      });
    }

    if (!meta.has_more && meta.next_cursor !== null) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'A complete notification page must not provide a cursor',
      });
    }
  });

export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
