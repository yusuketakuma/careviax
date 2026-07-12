import { z } from 'zod';

const businessHolidaySchema = z
  .object({
    id: z.string().trim().min(1),
    org_id: z.string().trim().min(1),
    site_id: z.string().trim().min(1).nullable(),
    date: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1),
    holiday_type: z.enum(['public_holiday', 'site_closure', 'org_event']),
    is_closed: z.boolean(),
    site: z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strip()
      .nullable(),
  })
  .strip();

export type BusinessHolidayListItem = z.infer<typeof businessHolidaySchema>;

type BusinessHolidayListSchemaOptions = {
  orgId: string;
  dateFrom: string;
  dateTo: string;
  siteId?: string;
  limit: number;
};

export function buildBusinessHolidayListResponseSchema({
  orgId,
  dateFrom,
  dateTo,
  siteId,
  limit,
}: BusinessHolidayListSchemaOptions) {
  return z
    .object({ data: z.array(businessHolidaySchema).max(limit) })
    .strict()
    .superRefine(({ data }, context) => {
      const ids = new Set<string>();
      let previousDate = '';

      for (const [index, holiday] of data.entries()) {
        const date = holiday.date.slice(0, 10);
        if (ids.has(holiday.id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate business holiday id',
          });
        }
        ids.add(holiday.id);

        if (
          holiday.org_id !== orgId ||
          date < dateFrom ||
          date > dateTo ||
          (siteId !== undefined && holiday.site_id !== siteId)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['data', index],
            message: 'Business holiday is outside the requested scope',
          });
        }

        if (
          (holiday.site_id === null && holiday.site !== null) ||
          (holiday.site_id !== null && holiday.site?.id !== holiday.site_id)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'site'],
            message: 'Business holiday site relation is inconsistent',
          });
        }

        if (previousDate && date < previousDate) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'date'],
            message: 'Business holidays are not ordered by date',
          });
        }
        previousDate = date;
      }

      // The provider has no count metadata. Reaching the requested cap cannot prove
      // completeness, so fail closed instead of rendering a possibly truncated calendar.
      if (data.length === limit) {
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Business holiday list may be truncated',
        });
      }
    });
}
