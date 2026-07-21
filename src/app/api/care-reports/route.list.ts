import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import { Prisma, ReportStatus } from '@prisma/client';

const CARE_REPORT_DELIVERY_RECORDS_PER_REPORT_LIMIT = 10;

const careReportBaseSelect = {
  id: true,
  org_id: true,
  patient_id: true,
  case_id: true,
  visit_record_id: true,
  report_type: true,
  status: true,
  template_id: true,
  created_by: true,
  created_at: true,
  updated_at: true,
  delivery_records: {
    select: {
      status: true,
      sent_at: true,
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: CARE_REPORT_DELIVERY_RECORDS_PER_REPORT_LIMIT,
  },
} satisfies Prisma.CareReportSelect;

const careReportContentSelect = {
  ...careReportBaseSelect,
  content: true,
} satisfies Prisma.CareReportSelect;

export type CareReportListRow = Prisma.CareReportGetPayload<{
  select: typeof careReportBaseSelect;
}> & {
  content?: Prisma.JsonValue;
};

export function buildCareReportListSelect(args: {
  orgId: string;
  includeContent: boolean;
}): Prisma.CareReportSelect {
  return {
    ...(args.includeContent ? careReportContentSelect : careReportBaseSelect),
    delivery_records: {
      ...careReportBaseSelect.delivery_records,
      where: { org_id: args.orgId },
    },
  };
}

export const careReportListOrderBy = [
  { created_at: 'desc' },
  { id: 'desc' },
] satisfies Prisma.CareReportOrderByWithRelationInput[];

export function readSearchableReportText(contentValue: Prisma.JsonValue) {
  const content = readJsonObject(contentValue);
  const safeTextValues = [
    readJsonObjectString(content, 'title'),
    readJsonObjectString(content, 'summary'),
    readJsonObjectString(content, 'body'),
    readJsonObjectString(content, 'assessment'),
    readJsonObjectString(content, 'plan'),
  ];
  return safeTextValues.filter(Boolean).join('\n').toLowerCase();
}

export function readSelectedReportContent(report: CareReportListRow, shouldReadContent: boolean) {
  if (!shouldReadContent || !('content' in report)) return null;
  return report.content ?? null;
}

export function buildCareReportContentSummary(contentValue: Prisma.JsonValue) {
  const content = readJsonObject(contentValue);
  if (!content) {
    return {
      title: null,
      summary: null,
      assessment: null,
      plan: null,
    };
  }

  return {
    title: readJsonObjectString(content, 'title'),
    summary: readJsonObjectString(content, 'summary'),
    assessment: readJsonObjectString(content, 'assessment'),
    plan: readJsonObjectString(content, 'plan'),
  };
}

export function appendCareReportWhereAnd(
  where: Prisma.CareReportWhereInput,
  clause: Prisma.CareReportWhereInput,
): Prisma.CareReportWhereInput {
  const existingAnd = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  return { ...where, AND: [...existingAnd, clause] };
}

export function buildCareReportCursorWhere(cursorReport: {
  id: string;
  created_at: Date;
}): Prisma.CareReportWhereInput {
  return {
    OR: [
      { created_at: { lt: cursorReport.created_at } },
      {
        created_at: { equals: cursorReport.created_at },
        id: { lt: cursorReport.id },
      },
    ],
  };
}

export function buildDeliverySummary(
  reports: Array<{
    delivery_records: Array<{
      status: ReportStatus | string;
    }>;
    failed_delivery_count?: number;
  }>,
  basis: 'page' | 'bounded_keyword_scan_result' = 'page',
) {
  return reports.reduce(
    (summary, report) => {
      const latestDeliveryStatus = report.delivery_records[0]?.status ?? null;
      if (latestDeliveryStatus) {
        summary.by_status[latestDeliveryStatus] =
          (summary.by_status[latestDeliveryStatus] ?? 0) + 1;
        if (latestDeliveryStatus === 'response_waiting') {
          summary.pending_delivery_count += 1;
        }
      }
      summary.failed_delivery_count +=
        report.failed_delivery_count ??
        report.delivery_records.filter((record) => record.status === 'failed').length;
      return summary;
    },
    {
      basis,
      delivery_records_basis: 'loaded_latest_per_report' as const,
      delivery_records_per_report_limit: CARE_REPORT_DELIVERY_RECORDS_PER_REPORT_LIMIT,
      failed_delivery_count_basis: 'loaded_delivery_records' as const,
      by_status_basis: 'latest_delivery_record_per_report' as const,
      pending_delivery_count: 0,
      failed_delivery_count: 0,
      by_status: {} as Record<string, number>,
    },
  );
}
