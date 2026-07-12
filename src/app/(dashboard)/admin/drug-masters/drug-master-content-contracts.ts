import { z } from 'zod';
import {
  drugMasterImportRunStatusSchema,
  drugMasterImportSourceSchema,
} from '@/types/drug-master-import-status';

export const drugMasterImportLogSchema = z
  .object({
    id: z.string().trim().min(1),
    source: drugMasterImportSourceSchema,
    imported_at: z.string().datetime(),
    record_count: z.number().int().nonnegative(),
    status: drugMasterImportRunStatusSchema,
    error_log: z.string().nullable(),
    source_url: z.string().trim().min(1).nullable(),
    source_file_hash: z.string().trim().min(1).nullable(),
    source_published_at: z.string().datetime().nullable(),
    import_mode: z.string().trim().min(1).nullable(),
    change_summary: z.unknown().nullable(),
  })
  .strip();

export const drugMasterImportLogsResponseSchema = z
  .object({ data: z.array(drugMasterImportLogSchema) })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const [index, log] of payload.data.entries()) {
      if (ids.has(log.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate drug master import log id',
        });
      }
      ids.add(log.id);
    }
  });

export type DrugMasterImportLog = z.infer<typeof drugMasterImportLogSchema>;
