import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateMedicationIssueSchema } from '@/lib/validations/medication';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  listAccessibleCareCaseIds,
  listAccessiblePatientIds,
} from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

async function buildMedicationIssueAssignmentWhere(args: {
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.MedicationIssueWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
  ]);

  return {
    OR: [
      { case_id: { in: caseIds } },
      { AND: [{ case_id: null }, { patient_id: { in: patientIds } }] },
    ],
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '服薬課題の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;
  const accessContext = { userId: ctx.userId, role: ctx.role };

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateMedicationIssueSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const assignmentWhere = await buildMedicationIssueAssignmentWhere({
    orgId: ctx.orgId,
    accessContext,
  });
  const existing = await prisma.medicationIssue.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: { id: true, status: true, patient_id: true, case_id: true },
  });
  if (!existing) return notFound('課題が見つかりません');

  const refResult = await validateOrgReferences(ctx.orgId, {
    patient_id: existing.patient_id,
    case_id: existing.case_id,
  });
  if (!refResult.ok) return refResult.response;

  const updateData: Record<string, unknown> = { ...parsed.data };

  if (parsed.data.status === 'resolved' || parsed.data.status === 'dismissed') {
    updateData.resolved_by = ctx.userId;
    updateData.resolved_at = new Date();
  } else if (parsed.data.status === 'open' || parsed.data.status === 'in_progress') {
    updateData.resolved_by = null;
    updateData.resolved_at = null;
  }

  const issue = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.medicationIssue.update({
      where: { id },
      data: updateData,
    });
  });

  return success({ data: issue });
}
