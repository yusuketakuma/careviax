import { prisma } from '@/lib/db/client';
import {
  buildCareCaseAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { readPdfJsonObject } from '@/server/services/pdf-document-json';
import { PdfNotFoundError } from './pdf-errors';

export type ManagementPlanRecord = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  version: number;
  effective_from: Date | null;
  next_review_date: Date | null;
  approved_at: Date | null;
  updated_at: Date;
  content: Record<string, unknown>;
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  };
};

export async function getManagementPlanRecord(
  orgId: string,
  planId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<ManagementPlanRecord> {
  const caseAssignmentWhere = accessContext ? buildCareCaseAssignmentWhere(accessContext) : null;
  const plan = await prisma.managementPlan.findFirst({
    where: {
      id: planId,
      org_id: orgId,
      ...(caseAssignmentWhere ? { case_: caseAssignmentWhere } : {}),
    },
    select: {
      id: true,
      title: true,
      summary: true,
      status: true,
      version: true,
      effective_from: true,
      next_review_date: true,
      approved_at: true,
      updated_at: true,
      content: true,
      case_: {
        select: {
          patient: {
            select: {
              id: true,
              name: true,
              birth_date: true,
              gender: true,
            },
          },
        },
      },
    },
  });

  if (!plan) {
    throw new PdfNotFoundError('managementPlan');
  }

  return {
    id: plan.id,
    title: plan.title,
    summary: plan.summary,
    status: plan.status,
    version: plan.version,
    effective_from: plan.effective_from,
    next_review_date: plan.next_review_date,
    approved_at: plan.approved_at,
    updated_at: plan.updated_at,
    content: readPdfJsonObject(plan.content),
    patient: plan.case_.patient,
  };
}
