import { z } from 'zod';
import type {
  AudienceReportContent,
  CareManagerReportContent,
  PhysicianReportContent,
} from '@/types/care-report-content';

export const CARE_REPORT_PRINT_AUDIT_INTENTS = ['preview_rendered', 'print_requested'] as const;

export const careReportPrintAuditRequestSchema = z.object({
  intent: z.enum(CARE_REPORT_PRINT_AUDIT_INTENTS).optional(),
});

export type CareReportPrintAuditIntent = (typeof CARE_REPORT_PRINT_AUDIT_INTENTS)[number];

export type CareReportPrintAuditReport = {
  id: string;
  report_type: string;
  content: unknown;
};

export type CareReportPrintAuditPrintableReport = {
  id: string;
  report_type: 'physician_report' | 'care_manager_report' | 'nurse_share' | 'facility_handoff';
  pharmacy_name?: string;
  content: PhysicianReportContent | CareManagerReportContent | AudienceReportContent;
};

export type CareReportPrintAuditResponse<
  TReport extends CareReportPrintAuditReport = CareReportPrintAuditReport,
> = {
  data: {
    audited: boolean;
    report: TReport;
  };
};
