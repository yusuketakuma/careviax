import { z } from 'zod';
import {
  incidentRelatedProcessSchema,
  incidentSeveritySchema,
  incidentStatusSchema,
} from '@/lib/validations/incident-report';

const boundedNullableMemo = z.string().max(2_000).nullable();
const offsetDateTimeSchema = z.string().datetime({ offset: true });

export const incidentReportResponseItemSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    what_happened: boundedNullableMemo,
    cause: boundedNullableMemo,
    immediate_action: boundedNullableMemo,
    prevention_plan: boundedNullableMemo,
    related_process: incidentRelatedProcessSchema.nullable(),
    severity: incidentSeveritySchema,
    status: incidentStatusSchema,
    occurred_at: offsetDateTimeSchema.nullable(),
    created_at: offsetDateTimeSchema,
    updated_at: offsetDateTimeSchema,
  })
  .strip()
  .refine((item) => item.updated_at >= item.created_at, {
    path: ['updated_at'],
    message: 'Incident update timestamp precedes creation',
  });

export const incidentReportsResponseSchema = z
  .object({ data: z.array(incidentReportResponseItemSchema).max(100) })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    let previousCreatedAt: string | null = null;
    for (const [index, report] of data.entries()) {
      if (ids.has(report.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate incident report identity',
        });
      }
      ids.add(report.id);
      if (previousCreatedAt !== null && report.created_at > previousCreatedAt) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'created_at'],
          message: 'Incident reports are not ordered newest first',
        });
      }
      previousCreatedAt = report.created_at;
    }
  });

export function buildIncidentReportResponseSchema(expectedId?: string) {
  return z
    .object({ data: incidentReportResponseItemSchema })
    .strict()
    .refine(({ data }) => expectedId === undefined || data.id === expectedId, {
      path: ['data', 'id'],
      message: 'Incident report identity does not match the request',
    });
}

export type IncidentReportResponseItem = z.infer<typeof incidentReportResponseItemSchema>;
