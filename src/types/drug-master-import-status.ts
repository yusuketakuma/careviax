import { z } from 'zod';

export type DrugMasterImportFreshnessLevel = 'fresh' | 'aging' | 'stale' | 'never';

export const DRUG_MASTER_IMPORT_SOURCES = [
  'ssk',
  'mhlw_price',
  'mhlw_generic',
  'hot',
  'pmda',
  'manual_clinical',
] as const;

export const drugMasterImportSourceSchema = z.enum(DRUG_MASTER_IMPORT_SOURCES);
export const drugMasterImportRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);

const recentRunsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    failure_streak: z.number().int().nonnegative(),
    latest_status: drugMasterImportRunStatusSchema.nullable(),
    latest_imported_at: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((runs, context) => {
    if (runs.failed > runs.total || runs.failure_streak > runs.failed) {
      context.addIssue({
        code: 'custom',
        path: ['failed'],
        message: 'Import failure counts exceed the recent run total',
      });
    }
    if ((runs.latest_status === null) !== (runs.latest_imported_at === null)) {
      context.addIssue({
        code: 'custom',
        path: ['latest_status'],
        message: 'Latest import status and timestamp must both be present or absent',
      });
    }
  });

const importSourceStatusSchema = z
  .object({
    source: drugMasterImportSourceSchema,
    label: z.string().trim().min(1),
    is_free: z.boolean(),
    threshold_days: z.number().int().positive(),
    last_success: z
      .object({
        imported_at: z.string().datetime(),
        record_count: z.number().int().nonnegative(),
        days_ago: z.number().int().nonnegative().nullable(),
        source_file_hash: z.string().trim().min(1).nullable(),
        source_published_at: z.string().datetime().nullable(),
        import_mode: z.string().trim().min(1).nullable(),
        change_summary: z.unknown().nullable(),
      })
      .strict()
      .nullable(),
    last_failure: z
      .object({
        imported_at: z.string().datetime(),
        error: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
    recent_runs_30d: recentRunsSchema,
    freshness: z.enum(['fresh', 'aging', 'stale', 'never']),
  })
  .strict();

export const drugMasterImportStatusSchema = z
  .object({
    sources: z.array(importSourceStatusSchema).length(DRUG_MASTER_IMPORT_SOURCES.length),
    totals: z
      .object({
        drug_master_count: z.number().int().nonnegative(),
        drug_package_count: z.number().int().nonnegative(),
        drug_package_coverage: z.number().int().min(0).max(100),
        hot_code_coverage: z.number().int().min(0).max(100),
        package_insert_count: z.number().int().nonnegative(),
        interaction_count: z.number().int().nonnegative(),
        active_alert_rule_count: z.number().int().nonnegative(),
        generic_mapping_count: z.number().int().nonnegative(),
      })
      .strict(),
    checked_at: z.string().datetime(),
  })
  .strict()
  .superRefine((status, context) => {
    const sources = new Set(status.sources.map((source) => source.source));
    if (sources.size !== DRUG_MASTER_IMPORT_SOURCES.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Every drug master import source must appear exactly once',
      });
    }
  });

export const drugMasterImportStatusResponseSchema = z
  .object({ data: drugMasterImportStatusSchema })
  .strict();

export type DrugMasterImportStatusResponse = z.infer<typeof drugMasterImportStatusSchema>;
