import { prisma } from '@/lib/db/client';
import {
  buildVisitRecordScheduleAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { readPdfJsonObject } from '@/server/services/pdf-document-json';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import { PdfNotFoundError } from './pdf-errors';

export type CareReportRecord = {
  id: string;
  report_type: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  content: Record<string, unknown>;
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  };
};

export async function getCareReportRecord(
  orgId: string,
  reportId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<CareReportRecord> {
  const report = await prisma.careReport.findFirst({
    where: { id: reportId, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
      report_type: true,
      status: true,
      content: true,
      created_at: true,
      updated_at: true,
    },
  });

  if (!report) {
    throw new PdfNotFoundError('careReport');
  }

  if (accessContext) {
    const visitRecordWhere = report.visit_record_id
      ? buildVisitRecordScheduleAssignmentWhere(accessContext)
      : null;
    const allowedByVisitRecord = report.visit_record_id
      ? await prisma.visitRecord.findFirst({
          where: {
            id: report.visit_record_id,
            org_id: orgId,
            patient_id: report.patient_id,
            ...(visitRecordWhere ? { AND: [visitRecordWhere] } : {}),
            schedule: {
              ...(report.case_id ? { case_id: report.case_id } : {}),
              case_: {
                patient_id: report.patient_id,
              },
            },
          },
          select: { id: true },
        })
      : null;

    if (report.visit_record_id && !allowedByVisitRecord) {
      throw new PdfNotFoundError('careReport');
    }

    if (
      !report.visit_record_id &&
      !(await canAccessCaseScopedPatientResource({
        db: prisma,
        orgId,
        patientId: report.patient_id,
        caseId: report.case_id,
        accessContext,
      }))
    ) {
      throw new PdfNotFoundError('careReport');
    }
  }

  const patient = await prisma.patient.findFirst({
    where: { id: report.patient_id, org_id: orgId },
    select: {
      id: true,
      name: true,
      birth_date: true,
      gender: true,
    },
  });

  if (!patient) {
    throw new PdfNotFoundError('patient');
  }

  return {
    id: report.id,
    report_type: report.report_type,
    status: report.status,
    created_at: report.created_at,
    updated_at: report.updated_at,
    content: readPdfJsonObject(report.content),
    patient,
  };
}
