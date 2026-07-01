import { readApiJson } from '@/lib/api/client-json';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';

import {
  generatedCareReportFromVisitResponseSchema,
  type GeneratedCareReportFromVisitResponse,
  type GeneratedCareReportSummary,
} from './generate-from-visit-contract';

export type GenerateCareReportFromVisitInput = {
  orgId: string;
  visitRecordId: string;
  expectedVisitRecordUpdatedAt: string;
  reportType?: string;
  expectedReportUpdatedAt?: string;
};

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
    headers: buildOrgJsonHeaders(input.orgId),
    body: JSON.stringify(body),
  });
  const json = await readApiJson<GeneratedCareReportFromVisitResponse>(res, {
    fallbackMessage,
    schema: generatedCareReportFromVisitResponseSchema,
  });
  return (json.data ?? []) as TReport[];
}
