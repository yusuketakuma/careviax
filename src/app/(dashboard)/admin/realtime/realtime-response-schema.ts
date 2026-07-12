import { z } from 'zod';
import { notificationsResponseSchema } from '@/lib/notifications/response-schema';

const countSchema = z.number().finite().int().nonnegative();
const identitySchema = z.string().trim().min(1).max(255);
const textSchema = z.string().trim().min(1).max(2_000);
const internalHrefSchema = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'Expected an internal action path',
  });

const workbenchItemSchema = z
  .object({
    id: identitySchema,
    queue_label: z.string().trim().min(1).max(200),
    title: textSchema,
    summary: z.string().max(4_000),
    priority: z.enum(['urgent', 'high', 'normal', 'low']),
    due_at: z.string().datetime({ offset: true }).nullable(),
    action_href: internalHrefSchema,
    action_label: z.string().trim().min(1).max(200),
    patient_name: z.string().trim().min(1).max(500).nullable(),
    badges: z.array(z.string().trim().min(1).max(200)).max(20),
  })
  .strip();

export const adminRealtimeWorkflowResponseSchema = z
  .object({
    data: z
      .object({
        route_control: z
          .object({
            locked_schedules: countSchema,
            pending_override_requests: countSchema,
            emergency_impact_items: countSchema,
          })
          .strip(),
        workflow_exceptions: z.object({ open: countSchema }).strip(),
        unified_workbench: z.array(workbenchItemSchema).max(100),
      })
      .strip()
      .superRefine(({ unified_workbench: items }, context) => {
        const identities = new Set<string>();
        for (const [index, item] of items.entries()) {
          if (identities.has(item.id)) {
            context.addIssue({
              code: 'custom',
              path: ['unified_workbench', index, 'id'],
              message: 'Duplicate realtime workbench identity',
            });
          }
          identities.add(item.id);

          if (new Set(item.badges).size !== item.badges.length) {
            context.addIssue({
              code: 'custom',
              path: ['unified_workbench', index, 'badges'],
              message: 'Duplicate realtime workbench badge',
            });
          }
        }
      }),
  })
  .strict();

export const adminRealtimeNotificationsResponseSchema = notificationsResponseSchema.transform(
  (payload, context) => {
    if (payload.meta.limit !== 12) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Unexpected realtime notification page limit',
      });
      return z.NEVER;
    }

    const data = payload.data.flatMap((notification, index) => {
      if (!notification.title) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'title'],
          message: 'Realtime notification title is required',
        });
        return [];
      }
      return [
        {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          link: notification.link ?? null,
          is_read: notification.is_read,
          created_at: notification.created_at,
        },
      ];
    });

    return { data };
  },
);

export type AdminRealtimeWorkflowResponse = z.infer<typeof adminRealtimeWorkflowResponseSchema>;
export type AdminRealtimeNotificationsResponse = z.infer<
  typeof adminRealtimeNotificationsResponseSchema
>;
