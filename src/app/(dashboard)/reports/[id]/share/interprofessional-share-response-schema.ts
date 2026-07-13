import { z } from 'zod';
import type { PatientArchiveSummary } from '@/lib/patient/archive-summary';
import type { CareReportActionPermissions } from '@/types/care-report-permissions';
import { careReportPdfReferenceSchema } from '@/lib/reports/pdf-reference-schema';

const idSchema = z.string().trim().min(1).max(255);
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const dateTimeSchema = z.string().datetime({ offset: true });

const archiveSchema = z
  .object({
    status: z.enum(['active', 'archived']),
    archived: z.boolean(),
    archived_at: dateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((archive, ctx) => {
    if (
      archive.archived !== (archive.status === 'archived') ||
      archive.archived !== (archive.archived_at !== null)
    ) {
      ctx.addIssue({ code: 'custom', message: '患者アーカイブ状態が矛盾しています' });
    }
  });

const permissionsProviderSchema = z
  .object({
    can_edit: z.boolean(),
    can_send: z.boolean(),
    can_create_external_share: z.boolean(),
    can_create_followup_task: z.boolean(),
    can_view_patient: z.boolean(),
    can_view_related_requests: z.boolean(),
  })
  .strict();

const reportProviderSchema = z
  .object({
    id: idSchema,
    patient_id: idSchema,
    case_id: idSchema.nullable(),
    report_type: z.enum([
      'physician_report',
      'care_manager_report',
      'facility_handoff',
      'nurse_share',
      'family_share',
      'internal_record',
    ]),
    updated_at: dateTimeSchema,
    status: z.enum(['draft', 'sent', 'failed', 'confirmed', 'response_waiting']),
    content: z.record(z.string(), z.unknown()).optional(),
    pdf_url: careReportPdfReferenceSchema.nullable(),
    patient_summary: z
      .object({
        id: idSchema,
        name: nullableTextSchema,
        archive: archiveSchema,
      })
      .strip()
      .nullable(),
    permissions: permissionsProviderSchema,
  })
  .strip();

export type InterprofessionalShareReport = {
  id: string;
  patient_id: string;
  case_id: string | null;
  report_type: string;
  updated_at: string;
  status: string;
  content: Record<string, unknown> | null;
  has_pdf: boolean;
  patient_summary: {
    id: string;
    name: string | null;
    archive: PatientArchiveSummary;
  } | null;
  permissions: Pick<
    CareReportActionPermissions,
    'can_send' | 'can_create_external_share' | 'can_create_followup_task' | 'can_view_patient'
  >;
};

export function buildInterprofessionalShareReportResponseSchema(expectedReportId: string) {
  return z
    .object({ data: reportProviderSchema })
    .strict()
    .superRefine(({ data }, ctx) => {
      const canLoadContent = data.permissions.can_edit || data.permissions.can_send;
      if (data.id !== expectedReportId) {
        ctx.addIssue({ code: 'custom', path: ['data', 'id'], message: '報告書IDが一致しません' });
      }
      if (canLoadContent !== (data.content !== undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'content'],
          message: '報告書本文の可視性が権限と一致しません',
        });
      }
      if (!data.permissions.can_send && data.pdf_url !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'pdf_url'],
          message: '送付権限なしでPDF参照を返せません',
        });
      }
      if (!data.permissions.can_view_patient && data.patient_summary !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'patient_summary'],
          message: '患者閲覧権限なしで患者情報を返せません',
        });
      }
      if (data.patient_summary !== null && data.patient_summary.id !== data.patient_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'patient_summary', 'id'],
          message: '報告書と患者情報の患者IDが一致しません',
        });
      }
    })
    .transform(({ data }): { data: InterprofessionalShareReport } => ({
      data: {
        id: data.id,
        patient_id: data.patient_id,
        case_id: data.case_id,
        report_type: data.report_type,
        updated_at: data.updated_at,
        status: data.status,
        content: data.content ?? null,
        has_pdf: data.permissions.can_send && data.pdf_url !== null,
        patient_summary: data.patient_summary,
        permissions: {
          can_send: data.permissions.can_send,
          can_create_external_share: data.permissions.can_create_external_share,
          can_create_followup_task: data.permissions.can_create_followup_task,
          can_view_patient: data.permissions.can_view_patient,
        },
      },
    }));
}
