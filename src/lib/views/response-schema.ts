import { z } from 'zod';
import { SAVED_VIEW_CONDITION_FIELDS } from './saved-filter-views';

function nonEmptyText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
}

const savedViewConditionSchema = z
  .object({
    field: z.enum(SAVED_VIEW_CONDITION_FIELDS),
    value: nonEmptyText(100),
  })
  .strict();

const savedViewPreferencesSchema = z
  .object({
    conditions: z.array(savedViewConditionSchema).min(1).max(20),
    saved_at: z.string().datetime({ offset: true }).optional(),
  })
  .strip();

const preferencesDataSchema = z
  .object({
    saved_view: savedViewPreferencesSchema.nullable().optional(),
  })
  .strip();

export const savedViewPreferencesResponseSchema = z
  .object({ data: preferencesDataSchema })
  .strict();

const savedViewRecordSchema = z
  .object({
    id: nonEmptyText(200),
    name: nonEmptyText(100),
    scope: z.literal('schedules'),
    filters: z.record(z.string(), z.unknown()),
    sort: z.record(z.string(), z.unknown()).nullable(),
    isShared: z.boolean(),
    sortOrder: z.number().finite().int().min(0).max(9999),
    isOwner: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strip();

export const savedViewsSchedulesResponseSchema = z
  .object({
    data: z.array(savedViewRecordSchema).max(200),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    for (const [index, view] of data.entries()) {
      if (ids.has(view.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Saved-view identities must be unique',
        });
      }
      ids.add(view.id);
    }
  });

export type SavedViewPreferencesResponse = z.infer<typeof savedViewPreferencesResponseSchema>;
export type SavedViewsSchedulesResponse = z.infer<typeof savedViewsSchedulesResponseSchema>;
