export type VisitReportGenerationSummary = {
  report_type: string;
  status: string;
  updated_at: string;
};

export function findDraftReportForType(
  reports: VisitReportGenerationSummary[],
  reportType: string,
): VisitReportGenerationSummary | null {
  return (
    reports.find((report) => report.report_type === reportType && report.status === 'draft') ?? null
  );
}

export function canUseAutomaticReportGeneration(reports: VisitReportGenerationSummary[]) {
  return !reports.some((report) => report.status === 'draft');
}
