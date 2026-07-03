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

export function readReportSourceProvenance(content: unknown): Record<string, unknown> | null {
  const reportContent = readReportContentObject(content);
  return readReportContentObject(reportContent?.source_provenance);
}

// 訪問記録経路 (visit_record / manual) の source_provenance から楽観ロック照合用の
// version / updated_at を取り出す。send route の鮮度判定が利用する。
export function readVisitRecordSourceRevision(content: unknown): {
  visitRecordVersion: number | null;
  visitRecordUpdatedAt: string | null;
} {
  const sourceProvenance = readReportSourceProvenance(content);
  const visitRecordVersion = sourceProvenance?.visit_record_version;
  const visitRecordUpdatedAt = sourceProvenance?.visit_record_updated_at;
  return {
    visitRecordVersion: typeof visitRecordVersion === 'number' ? visitRecordVersion : null,
    visitRecordUpdatedAt:
      typeof visitRecordUpdatedAt === 'string' && visitRecordUpdatedAt.trim().length > 0
        ? visitRecordUpdatedAt
        : null,
  };
}

// 協力訪問記録経路 (partner_visit_record) の source_provenance から
// revision_no / updated_at と、報告書が指定 partner 訪問記録に一致するかを取り出す。
export function readPartnerVisitSourceRevision(
  content: unknown,
  partnerVisitRecordId: string,
): {
  partnerVisitRecordId: string | null;
  partnerVisitRecordRevisionNo: number | null;
  partnerVisitRecordUpdatedAt: string | null;
  matchesReportSource: boolean;
} {
  const sourceProvenance = readReportSourceProvenance(content);
  const sourcePartnerVisitRecordId = sourceProvenance?.partner_visit_record_id;
  const partnerVisitRecordRevisionNo = sourceProvenance?.partner_visit_record_revision_no;
  const partnerVisitRecordUpdatedAt = sourceProvenance?.partner_visit_record_updated_at;
  return {
    partnerVisitRecordId:
      typeof sourcePartnerVisitRecordId === 'string' && sourcePartnerVisitRecordId.trim().length > 0
        ? sourcePartnerVisitRecordId
        : null,
    partnerVisitRecordRevisionNo:
      typeof partnerVisitRecordRevisionNo === 'number' &&
      Number.isInteger(partnerVisitRecordRevisionNo)
        ? partnerVisitRecordRevisionNo
        : null,
    partnerVisitRecordUpdatedAt:
      typeof partnerVisitRecordUpdatedAt === 'string' &&
      partnerVisitRecordUpdatedAt.trim().length > 0
        ? partnerVisitRecordUpdatedAt
        : null,
    matchesReportSource:
      typeof sourcePartnerVisitRecordId === 'string' &&
      sourcePartnerVisitRecordId === partnerVisitRecordId,
  };
}

export function readReportWarnings(content: unknown): string[] {
  const reportContent = readReportContentObject(content);
  const warnings = reportContent?.warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings.filter((warning): warning is string => typeof warning === 'string');
}
