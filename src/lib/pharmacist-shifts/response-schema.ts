import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const isoDateTime = z.string().datetime({ offset: true });
const nullableTime = isoDateTime.nullable();
const personSchema = z.object({ id: nonEmptyText(200), name: nonEmptyText(500) }).strip();
const siteSchema = personSchema;

const pharmacistShiftSchema = z
  .object({
    id: nonEmptyText(200),
    site_id: nonEmptyText(200),
    user_id: nonEmptyText(200),
    date: isoDateTime,
    available: z.boolean(),
    available_from: nullableTime,
    available_to: nullableTime,
    note: z.string().max(2_000).nullable(),
    user: personSchema.extend({ name_kana: z.string().max(500).nullable() }).strip(),
    site: siteSchema.nullable(),
  })
  .strip()
  .superRefine((shift, context) => {
    if (shift.user.id !== shift.user_id) {
      context.addIssue({
        code: 'custom',
        path: ['user', 'id'],
        message: 'Shift user identity mismatch',
      });
    }
    if (shift.site && shift.site.id !== shift.site_id) {
      context.addIssue({
        code: 'custom',
        path: ['site', 'id'],
        message: 'Shift site identity mismatch',
      });
    }
    if (
      shift.available_from !== null &&
      shift.available_to !== null &&
      shift.available_from >= shift.available_to
    ) {
      context.addIssue({
        code: 'custom',
        path: ['available_to'],
        message: 'Shift end must follow start',
      });
    }
  });

export function buildPharmacistShiftsResponseSchema(expectedMonth: string, expectedLimit = 400) {
  return z
    .object({
      data: z.array(pharmacistShiftSchema).max(expectedLimit),
      meta: z.object({ limit: z.literal(expectedLimit), has_more: z.boolean() }).strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const ids = new Set<string>();
      const userDates = new Set<string>();
      let previousOrderKey: string | null = null;
      for (const [index, shift] of data.entries()) {
        if (!shift.date.startsWith(expectedMonth)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'date'],
            message: 'Shift belongs to another month',
          });
        }
        if (ids.has(shift.id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate shift identity',
          });
        }
        ids.add(shift.id);
        const userDate = `${shift.user_id}:${shift.date.slice(0, 10)}`;
        if (userDates.has(userDate)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'date'],
            message: 'Duplicate user shift date',
          });
        }
        userDates.add(userDate);
        const orderKey = `${shift.date}:${shift.available_from ?? ''}`;
        if (previousOrderKey !== null && orderKey < previousOrderKey) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'date'],
            message: 'Shifts are not ordered by date and start time',
          });
        }
        previousOrderKey = orderKey;
      }
    });
}

const shiftTemplateSchema = z
  .object({
    id: nonEmptyText(200),
    user_id: nonEmptyText(200),
    site_id: nonEmptyText(200),
    weekday: z.number().int().min(0).max(6),
    available: z.boolean(),
    available_from: nullableTime,
    available_to: nullableTime,
    note: z.string().max(2_000).nullable(),
    user: personSchema,
    site: siteSchema.nullable(),
  })
  .strip()
  .superRefine((template, context) => {
    if (template.user.id !== template.user_id) {
      context.addIssue({
        code: 'custom',
        path: ['user', 'id'],
        message: 'Template user identity mismatch',
      });
    }
    if (template.site && template.site.id !== template.site_id) {
      context.addIssue({
        code: 'custom',
        path: ['site', 'id'],
        message: 'Template site identity mismatch',
      });
    }
    if (
      template.available_from !== null &&
      template.available_to !== null &&
      template.available_from >= template.available_to
    ) {
      context.addIssue({
        code: 'custom',
        path: ['available_to'],
        message: 'Template end must follow start',
      });
    }
  });

export const pharmacistShiftTemplatesResponseSchema = z
  .object({ data: z.array(shiftTemplateSchema).max(100) })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    const userWeekdays = new Set<string>();
    for (const [index, template] of data.entries()) {
      if (ids.has(template.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate template identity',
        });
      }
      ids.add(template.id);
      const key = `${template.user_id}:${template.weekday}`;
      if (userWeekdays.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'weekday'],
          message: 'Duplicate user weekday template',
        });
      }
      userWeekdays.add(key);
    }
  });

export const pharmacistShiftApplyResponseSchema = z
  .object({ data: z.object({ applied_count: z.number().int().nonnegative() }).strict() })
  .strict();

export type PharmacistShift = z.infer<typeof pharmacistShiftSchema>;
export type PharmacistShiftTemplate = z.infer<typeof shiftTemplateSchema>;
