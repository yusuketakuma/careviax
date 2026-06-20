import { z } from 'zod';
import type {
  AudienceReportContent,
  CareManagerReportContent,
  PhysicianReportContent,
} from '@/types/care-report-content';
import { defaultAudienceForReportType } from '@/lib/communications/share-audience';

export const CARE_REPORT_PRINT_AUDIT_INTENTS = ['preview_rendered', 'print_requested'] as const;
export const PRINTABLE_CARE_REPORT_TYPES = [
  'physician_report',
  'care_manager_report',
  'nurse_share',
  'facility_handoff',
  'family_share',
] as const;

export type PrintableCareReportType = (typeof PRINTABLE_CARE_REPORT_TYPES)[number];

export const careReportPrintAuditRequestSchema = z.object({
  intent: z.enum(CARE_REPORT_PRINT_AUDIT_INTENTS).optional(),
});

const printableCareReportTypeSchema = z.enum(PRINTABLE_CARE_REPORT_TYPES);

const audienceReportContentSchema = z
  .object({
    report_audience: z.enum(['visiting_nurse', 'facility', 'family']),
    patient: z.object({
      name: z.string().min(1),
      birth_date: z.string().min(1),
    }),
    report_date: z.string().min(1),
    visit_date: z.string().min(1),
    pharmacist_name: z.string().min(1),
    summary: z.string(),
    medication: z.string(),
    residual: z.string(),
    evaluation: z.string(),
    requests: z.string(),
    warnings: z.array(z.string()),
  })
  .passthrough();

const physicianReportContentSchema = z
  .object({
    patient: z.object({
      name: z.string(),
      birth_date: z.string(),
      gender: z.string(),
    }),
    report_date: z.string(),
    visit_date: z.string(),
    pharmacist_name: z.string(),
    prescriber: z.object({
      name: z.string(),
      institution: z.string(),
    }),
    prescriptions: z.array(
      z
        .object({
          drug_name: z.string(),
          dose: z.string(),
          frequency: z.string(),
          days: z.number(),
          route: z.string().optional(),
          dispensing_method: z.string().optional(),
        })
        .passthrough(),
    ),
    medication_management: z
      .object({
        compliance_summary: z.string(),
        adherence_score: z.number(),
        self_management: z.string(),
        calendar_used: z.boolean(),
      })
      .passthrough(),
    adverse_events: z
      .object({
        has_events: z.boolean(),
        events: z.array(z.string()),
        details: z.string().optional(),
      })
      .passthrough(),
    functional_assessment: z
      .object({
        lab_values: z.string().optional(),
        sleep: z.string(),
        cognition: z.string(),
        diet_oral: z.string(),
        mobility: z.string(),
        excretion: z.string(),
      })
      .passthrough(),
    residual_medications: z.array(
      z
        .object({
          drug_name: z.string(),
          remaining_qty: z.number(),
          excess_days: z.number(),
          reduction_proposal: z.boolean(),
        })
        .passthrough(),
    ),
    assessment: z.string(),
    plan: z.string(),
    prescription_proposals: z.string().optional(),
    physician_communication: z.string(),
    warnings: z.array(z.string()),
  })
  .passthrough();

const careManagerReportContentSchema = z
  .object({
    patient: z.object({
      name: z.string(),
      birth_date: z.string(),
    }),
    care_manager: z.object({
      name: z.string(),
      organization: z.string(),
    }),
    report_date: z.string(),
    visit_date: z.string(),
    pharmacist_name: z.string(),
    medication_management_summary: z
      .object({
        total_drugs: z.number(),
        compliance_summary: z.string(),
        self_management: z.string(),
        calendar_used: z.boolean(),
      })
      .passthrough(),
    functional_impact: z
      .object({
        sleep_impact: z.string(),
        cognition_impact: z.string(),
        diet_impact: z.string(),
        mobility_impact: z.string(),
        excretion_impact: z.string(),
      })
      .passthrough(),
    residual_status: z
      .object({
        summary: z.string(),
        reduction_proposals: z.array(z.string()),
      })
      .passthrough(),
    care_service_coordination: z
      .object({
        medication_assistance: z.string(),
        unit_dose_packaging: z.boolean(),
        calendar_recommendation: z.boolean(),
        other_items: z.string(),
      })
      .passthrough(),
    next_visit_plan: z
      .object({
        date: z.string().optional(),
        followup_items: z.array(z.string()),
      })
      .passthrough(),
    warnings: z.array(z.string()),
  })
  .passthrough();

function expectedAudienceForPrintableReportType(
  reportType: PrintableCareReportType,
): AudienceReportContent['report_audience'] | null {
  const audience = defaultAudienceForReportType(reportType);
  return audience === 'visiting_nurse' || audience === 'facility' || audience === 'family'
    ? audience
    : null;
}

const requiredPrintableReportContentSchema = z.custom<
  PhysicianReportContent | CareManagerReportContent | AudienceReportContent
>((value) => value !== undefined && value !== null, {
  message: 'content is required',
});

const careReportPrintAuditReportSchema = z
  .object({
    id: z.string(),
    report_type: printableCareReportTypeSchema,
    pharmacy_name: z.string().optional(),
    content: requiredPrintableReportContentSchema,
  })
  .passthrough()
  .superRefine((report, ctx) => {
    if (!isPrintableCareReportContent(report.report_type, report.content)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'content does not match printable report type',
      });
    }
  });

export const careReportPrintAuditResponseSchema = z
  .object({
    data: z.object({
      audited: z.boolean(),
      report: careReportPrintAuditReportSchema,
    }),
  })
  .passthrough();

type CareReportPrintAuditReport = {
  id: string;
  report_type: PrintableCareReportType;
  pharmacy_name?: string;
  content: PhysicianReportContent | CareManagerReportContent | AudienceReportContent;
};

export type CareReportPrintAuditPrintableReport = CareReportPrintAuditReport;

export type CareReportPrintAuditResponse<
  TReport extends CareReportPrintAuditReport = CareReportPrintAuditReport,
> = {
  data: {
    audited: boolean;
    report: TReport;
  };
};

export function isPrintableCareReportType(value: string): value is PrintableCareReportType {
  return (PRINTABLE_CARE_REPORT_TYPES as readonly string[]).includes(value);
}

export function isPrintableCareReportContent(
  reportType: PrintableCareReportType,
  content: unknown,
): content is CareReportPrintAuditPrintableReport['content'] {
  if (content === undefined || content === null) return false;
  if (reportType === 'physician_report') {
    return physicianReportContentSchema.safeParse(content).success;
  }
  if (reportType === 'care_manager_report') {
    return careManagerReportContentSchema.safeParse(content).success;
  }
  const expectedAudience = expectedAudienceForPrintableReportType(reportType);
  if (!expectedAudience) return true;
  const parsed = audienceReportContentSchema.safeParse(content);
  return parsed.success && parsed.data.report_audience === expectedAudience;
}
