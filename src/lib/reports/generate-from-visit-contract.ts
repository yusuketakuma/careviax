import { z } from 'zod';

export const generatedCareReportFromVisitReportSchema = z
  .object({
    id: z.string(),
    report_type: z.string(),
    status: z.string(),
    updated_at: z.string().datetime(),
  })
  .passthrough();

export const generatedCareReportFromVisitResponseSchema = z
  .object({
    data: z.array(generatedCareReportFromVisitReportSchema).optional(),
  })
  .passthrough();

export type GeneratedCareReportSummary = z.infer<typeof generatedCareReportFromVisitReportSchema>;

export type GeneratedCareReportFromVisitResponse = z.infer<
  typeof generatedCareReportFromVisitResponseSchema
>;
