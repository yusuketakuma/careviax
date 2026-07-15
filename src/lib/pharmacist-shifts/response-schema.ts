import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const isoDateTime = z.string().datetime({ offset: true });
const nullableTime = isoDateTime.nullable();
const personSchema = z.object({ id: nonEmptyText(200), name: nonEmptyText(500) }).strip();
const siteSchema = personSchema;

export const pharmacistShiftSchema = z
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

function addCollectionIssues(
  data: PharmacistShift[],
  expectedMonth: string,
  addIssue: (index: number, path: string, message: string) => void,
) {
  const ids = new Set<string>();
  const userDates = new Set<string>();
  let previousShift: PharmacistShift | null = null;
  for (const [index, shift] of data.entries()) {
    if (!shift.date.startsWith(expectedMonth)) {
      addIssue(index, 'date', 'Shift belongs to another month');
    }
    if (ids.has(shift.id)) addIssue(index, 'id', 'Duplicate shift identity');
    ids.add(shift.id);
    const userDate = `${shift.user_id}:${shift.date.slice(0, 10)}`;
    if (userDates.has(userDate)) addIssue(index, 'date', 'Duplicate user shift date');
    userDates.add(userDate);
    const orderIsInvalid =
      previousShift !== null &&
      (shift.date < previousShift.date ||
        (shift.date === previousShift.date &&
          ((previousShift.available_from === null && shift.available_from !== null) ||
            (previousShift.available_from !== null &&
              shift.available_from !== null &&
              shift.available_from < previousShift.available_from) ||
            (shift.available_from === previousShift.available_from &&
              shift.id < previousShift.id))));
    if (orderIsInvalid) addIssue(index, 'date', 'Shifts are not ordered by date and start time');
    previousShift = shift;
  }
}

export function buildPharmacistShiftCollectionSchema(expectedMonth: string) {
  return z.array(pharmacistShiftSchema).superRefine((data, context) => {
    addCollectionIssues(data, expectedMonth, (index, path, message) => {
      context.addIssue({ code: 'custom', path: [index, path], message });
    });
  });
}

export function buildPharmacistShiftsResponseSchema(expectedMonth: string, expectedLimit = 400) {
  return z
    .object({
      data: z.array(pharmacistShiftSchema).max(expectedLimit),
      meta: z
        .object({
          limit: z.literal(expectedLimit),
          has_more: z.boolean(),
          next_cursor: z.string().trim().min(1).max(2048).nullable(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      addCollectionIssues(data, expectedMonth, (index, path, message) => {
        context.addIssue({ code: 'custom', path: ['data', index, path], message });
      });
      if (meta.has_more !== (meta.next_cursor !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'next_cursor'],
          message: 'Shift cursor must match has_more',
        });
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
