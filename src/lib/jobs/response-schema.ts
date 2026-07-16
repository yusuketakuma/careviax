import { z } from 'zod';

const JOB_TYPES = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const JOB_STATUS = z.enum(['pending', 'running', 'completed', 'partial', 'failed', 'skipped']);
const JOB_COUNT = z.number().int().nonnegative();
const JOB_TIMESTAMP = z.string().datetime({ offset: true });

const jobErrorSummarySchema = z
  .object({
    error_name: z.enum(['リトライ上限到達', '実行エラー', '一部処理失敗']),
    occurred_at: JOB_TIMESTAMP.nullable(),
    message: z.literal('エラーが記録されています'),
  })
  .strip();

const integrationJobRunSchema = z
  .object({
    id: z.string().trim().min(1),
    job_type: JOB_TYPES,
    status: JOB_STATUS,
    output: z.record(z.string(), JOB_COUNT).nullable(),
    error_summary: jobErrorSummarySchema.nullable(),
    retry_count: JOB_COUNT,
    max_retries: JOB_COUNT,
    started_at: JOB_TIMESTAMP.nullable(),
    completed_at: JOB_TIMESTAMP.nullable(),
    created_at: JOB_TIMESTAMP,
  })
  .strip()
  .superRefine((run, context) => {
    if (run.retry_count > run.max_retries) {
      context.addIssue({
        code: 'custom',
        path: ['retry_count'],
        message: 'retry_count cannot exceed max_retries',
      });
    }

    if (
      run.started_at &&
      run.completed_at &&
      new Date(run.completed_at).getTime() < new Date(run.started_at).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completed_at'],
        message: 'completed_at cannot precede started_at',
      });
    }
  });

const jobDefinitionSchema = z
  .object({
    job_type: JOB_TYPES,
    schedule_hint: z.string().trim().min(1),
    endpoint: z.string().regex(/^\/api\/jobs\/[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    latest_run: integrationJobRunSchema.nullable(),
    latest_export_run: integrationJobRunSchema.nullable(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.endpoint !== `/api/jobs/${entry.job_type}`) {
      context.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'Job endpoint does not match job type',
      });
    }

    if (entry.latest_run && entry.latest_run.job_type !== entry.job_type) {
      context.addIssue({
        code: 'custom',
        path: ['latest_run', 'job_type'],
        message: 'Latest job run does not match the definition',
      });
    }

    if (
      entry.latest_export_run &&
      (entry.job_type !== 'medication-history-bulk-export-drain' ||
        entry.latest_export_run.job_type !== 'medication-history-bulk-export')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latest_export_run', 'job_type'],
        message: 'Latest export run is only valid for the export drain definition',
      });
    }
  });

export const jobsResponseSchema = z
  .object({
    data: z.array(jobDefinitionSchema).max(100),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const jobTypes = new Set<string>();
    const endpoints = new Set<string>();

    for (const [index, entry] of data.entries()) {
      if (jobTypes.has(entry.job_type)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'job_type'],
          message: 'Duplicate job definition',
        });
      }
      if (endpoints.has(entry.endpoint)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'endpoint'],
          message: 'Duplicate job endpoint',
        });
      }
      jobTypes.add(entry.job_type);
      endpoints.add(entry.endpoint);
    }
  });

export type JobErrorSummary = z.infer<typeof jobErrorSummarySchema>;
export type IntegrationJobRun = z.infer<typeof integrationJobRunSchema>;
export type JobDefinitionEntry = z.infer<typeof jobDefinitionSchema>;
