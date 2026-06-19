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
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { message?: string } | null)?.message ?? fallbackMessage);
  }

  const json = (await res.json()) as { data?: TReport[] };
  return json.data ?? [];
}
