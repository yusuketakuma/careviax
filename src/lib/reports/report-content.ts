export function readReportContentObject(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return null;
  }

  return content as Record<string, unknown>;
}

export function readReportBillingContext(content: unknown): Record<string, unknown> | null {
  const reportContent = readReportContentObject(content);
  const billingContext = reportContent?.billing_context;
  return readReportContentObject(billingContext);
}

export function readReportWarnings(content: unknown): string[] {
  const reportContent = readReportContentObject(content);
  const warnings = reportContent?.warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings.filter((warning): warning is string => typeof warning === 'string');
}
