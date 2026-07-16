import { z } from 'zod';

export const notificationIdSchema = z.string().trim().min(1).max(200);

const notificationLimitSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100));

export const notificationsQuerySchema = z.object({
  cursor: notificationIdSchema.optional(),
  limit: notificationLimitSchema.optional().default('50'),
  summary: z.literal('1').optional(),
  user_id: notificationIdSchema.optional(),
  is_read: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const notificationIdsMutationSchema = z
  .object({
    all: z.literal(false).optional(),
    ids: z.array(notificationIdSchema).min(1).max(100),
  })
  .strict()
  .superRefine(({ ids }, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'ids に重複があります',
      });
    }
  });

export const notificationReadMutationSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  notificationIdsMutationSchema,
]);

export const notificationPublicSelect = {
  id: true,
  type: true,
  event_type: true,
  title: true,
  message: true,
  link: true,
  created_at: true,
  is_read: true,
} as const;
