import { prisma } from '@/lib/db/client';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';
import { readPdfJsonObject } from '@/server/services/pdf-document-json';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import { PdfNotFoundError } from './pdf-errors';
import {
  buildPdfPatientSummary,
  PDF_PATIENT_SUMMARY_SELECT,
  type PdfPatientSummary,
} from './pdf-patient-summary';

export type TracingReportRecord = {
  id: string;
  status: string;
  sent_to_physician: string | null;
  sent_at: Date | null;
  acknowledged_at: Date | null;
  created_at: Date;
  updated_at: Date;
  content: Record<string, unknown>;
  patient: PdfPatientSummary;
  issue: {
    title: string;
    description: string;
    priority: string;
    status: string;
  } | null;
};

export async function getTracingReportRecord(
  orgId: string,
  reportId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<TracingReportRecord> {
  const report = await prisma.tracingReport.findFirst({
    where: { id: reportId, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      sent_to_physician: true,
      sent_at: true,
      acknowledged_at: true,
      created_at: true,
      updated_at: true,
      content: true,
      issue: {
        select: {
          org_id: true,
          patient_id: true,
          case_id: true,
          title: true,
          description: true,
          priority: true,
          status: true,
        },
      },
    },
  });

  if (!report) {
    throw new PdfNotFoundError('tracingReport');
  }

  if (
    accessContext &&
    !(await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId,
      patientId: report.patient_id,
      caseId: report.case_id,
      accessContext,
    }))
  ) {
    throw new PdfNotFoundError('tracingReport');
  }
  if (
    report.issue &&
    (report.issue.org_id !== orgId ||
      report.issue.patient_id !== report.patient_id ||
      (report.issue.case_id && report.case_id && report.issue.case_id !== report.case_id) ||
      (!report.case_id && report.issue.case_id))
  ) {
    throw new PdfNotFoundError('tracingReport');
  }

  const patient = await prisma.patient.findFirst({
    where: { id: report.patient_id, org_id: orgId },
    select: PDF_PATIENT_SUMMARY_SELECT,
  });

  if (!patient) {
    throw new PdfNotFoundError('patient');
  }

  return {
    id: report.id,
    status: report.status,
    sent_to_physician: report.sent_to_physician,
    sent_at: report.sent_at,
    acknowledged_at: report.acknowledged_at,
    created_at: report.created_at,
    updated_at: report.updated_at,
    content: readPdfJsonObject(report.content),
    patient: buildPdfPatientSummary(patient),
    issue: report.issue
      ? {
          title: report.issue.title,
          description: report.issue.description,
          priority: report.issue.priority,
          status: report.issue.status,
        }
      : null,
  };
}
