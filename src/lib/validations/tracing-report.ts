import { z } from 'zod';
import { trimStringOrUndefined as sharedTrimStringOrUndefined } from './string';

export const tracingReportStatusSchema = z.enum(['draft', 'sent', 'received', 'acknowledged']);
export type TracingReportStatusValue = z.infer<typeof tracingReportStatusSchema>;

export const trimStringOrUndefined = sharedTrimStringOrUndefined;

export const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

export const optionalTrimmedStringSchema = z.preprocess(
  trimStringOrUndefined,
  z.string().min(1).optional(),
);

export const optionalTracingReportStatusSchema = z.preprocess(
  trimStringOrUndefined,
  tracingReportStatusSchema.optional(),
);

export function optionalTrimmedSearchParam(value: string | null) {
  return value?.trim() || undefined;
}
