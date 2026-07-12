import { z } from 'zod';

const settingScopeSchema = z.enum(['system', 'organization', 'site', 'user']);

const settingOptionSchema = z
  .object({
    value: z.string().max(2_000),
    label: z.string().trim().min(1).max(500),
  })
  .strict();

const settingValueItemSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(500),
    description: z.string().max(2_000).optional(),
    value: z.string().max(10_000),
    type: z.enum(['text', 'number', 'select', 'boolean']),
    options: z.array(settingOptionSchema).max(100).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .refine((item) => item.min === undefined || item.max === undefined || item.min <= item.max, {
    path: ['max'],
    message: 'Setting maximum must be greater than or equal to its minimum',
  });

export const adminSettingsResponseSchema = z
  .object({
    data: z
      .object({
        scope: settingScopeSchema,
        scope_id: z.string().max(200).nullable(),
        items: z.array(settingValueItemSchema).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const keys = new Set<string>();
    for (const [index, item] of data.items.entries()) {
      if (keys.has(item.key)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'items', index, 'key'],
          message: 'Duplicate setting key',
        });
      }
      keys.add(item.key);
    }
  });

export const adminSettingsProfileResponseSchema = z
  .object({
    data: z
      .object({
        id: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(500),
        defaultSiteId: z.string().trim().min(1).max(200).nullable(),
      })
      .strip(),
  })
  .strict();

export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;
export type AdminSettingsProfileResponse = z.infer<typeof adminSettingsProfileResponseSchema>;
