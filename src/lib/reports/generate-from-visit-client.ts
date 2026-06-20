import { z } from 'zod';
import { readApiJson } from '@/lib/api/client-json';

export type GenerateCareReportFromVisitInput = {
  orgId: string;
  visitRecordId: string;
  expectedVisitRecordUpdatedAt: string;
  reportType?: string;
  expectedReportUpdatedAt?: string;
};

export type GeneratedCareReportSummary = {
  id: string;
};

const generatedCareReportFromVisitResponseSchema = z
  .object({
    data: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export async function generateCareReportFromVisit<TReport extends GeneratedCareReportSummary>(
  input: GenerateCareReportFromVisitInput,
  fallbackMessage = '報告書の生成に失敗しました',
): Promise<TReport[]> {
  const body: Record<string, string> = {
    visit_record_id: input.visitRecordId,
    expected_visit_record_updated_at: input.expectedVisitRecordUpdatedAt,
  };
  if (input.reportType) body.report_type = input.reportType;
  if (input.expectedReportUpdatedAt)
    body.expected_report_updated_at = input.expectedReportUpdatedAt;

  const res = await fetch('/api/care-reports/generate-from-visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': input.orgId },
    body: JSON.stringify(body),
  });
  const json = await readApiJson<{
    data?: Array<GeneratedCareReportSummary & Record<string, unknown>>;
  }>(res, {
    fallbackMessage,
    schema: generatedCareReportFromVisitResponseSchema,
  });
  return (json.data ?? []) as TReport[];
}
