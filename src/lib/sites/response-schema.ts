import { z } from 'zod';

const NON_EMPTY_TEXT = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected non-empty text',
});
const SITE_COUNT = z.number().finite().int().nonnegative();

const mySiteSchema = z
  .object({
    id: NON_EMPTY_TEXT,
    name: NON_EMPTY_TEXT,
    todays_visit_count: SITE_COUNT,
    has_home_visit: z.boolean(),
    is_current: z.boolean(),
  })
  .strict();

const mySitesMetaSchema = z
  .object({
    limit: SITE_COUNT.min(1).max(500),
    has_more: z.boolean(),
  })
  .strict();

export const mySitesResponseSchema = z
  .object({
    data: z.array(mySiteSchema).max(500),
    meta: mySitesMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const siteIds = new Set<string>();
    let currentSiteCount = 0;

    for (const [index, site] of data.entries()) {
      if (siteIds.has(site.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate site identity',
        });
      }
      siteIds.add(site.id);
      if (site.is_current) currentSiteCount += 1;
    }

    if (currentSiteCount > 1) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'At most one site can be current',
      });
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Site data length cannot exceed the response limit',
      });
    }

    if (meta.has_more && data.length !== meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'has_more'],
        message: 'A paginated site response must fill its limit',
      });
    }
  });

export type MySite = z.infer<typeof mySiteSchema>;
