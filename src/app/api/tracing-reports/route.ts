import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';

const createTracingReportSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  issue_id: z.string().optional(),
  content: z.record(z.string(), z.unknown()).default({}),
  sent_to_physician: z.string().optional(),
});

const tracingReportStatusSchema = z.enum(['draft', 'sent', 'received', 'acknowledged']);
type TracingReportStatusValue = z.infer<typeof tracingReportStatusSchema>;

function parseTracingReportStatus(value: string | null): TracingReportStatusValue | undefined {
  if (!value) return undefined;
  const parsed = tracingReportStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function buildTracingReportAccessWhere(
  req: AuthenticatedRequest,
): Promise<Prisma.TracingReportWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(req)) return null;

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(req);
  if (!caseAssignmentWhere) return null;

  const accessibleCases = await prisma.careCase.findMany({
    where: {
      org_id: req.orgId,
      AND: [caseAssignmentWhere],
    },
    select: {
      id: true,
      patient_id: true,
    },
  });
  const patientIds = Array.from(new Set(accessibleCases.map((careCase) => careCase.patient_id)));

  return {
    OR: [
      ...accessibleCases.map((careCase) => ({
        case_id: careCase.id,
        patient_id: careCase.patient_id,
      })),
      { case_id: null, patient_id: { in: patientIds } },
    ],
  };
}

async function canAttachMedicationIssue(args: {
  orgId: string;
  patientId: string;
  caseId?: string | null;
  issueId: string;
}) {
  const issue = await prisma.medicationIssue.findFirst({
    where: {
      id: args.issueId,
      org_id: args.orgId,
      patient_id: args.patientId,
      ...(args.caseId ? { OR: [{ case_id: args.caseId }, { case_id: null }] } : { case_id: null }),
    },
    select: { id: true },
  });

  return issue !== null;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const statusParam = searchParams.get('status');
    const status = parseTracingReportStatus(statusParam);
    if (statusParam && !status) {
      return validationError('status が不正です', {
        status: ['status が不正です'],
      });
    }
    const accessWhere = await buildTracingReportAccessWhere(req);

    const where: Prisma.TracingReportWhereInput = {
      org_id: req.orgId,
      ...(accessWhere ?? {}),
      ...(patientId ? { patient_id: patientId } : {}),
      ...(status ? { status } : {}),
    };

    const reports = await prisma.tracingReport.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        issue_id: true,
        content: true,
        status: true,
        sent_to_physician: true,
        sent_at: true,
        acknowledged_at: true,
        pdf_url: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = reports.length > limit;
    const rawData = hasMore ? reports.slice(0, limit) : reports;

    const patientIds = [...new Set(rawData.map((r) => r.patient_id))];
    const patients = await prisma.patient.findMany({
      where: { org_id: req.orgId, id: { in: patientIds } },
      select: { id: true, name: true },
    });
    const patientNameById = new Map(patients.map((p) => [p.id, p.name]));

    const data = rawData.map((r) => ({
      ...r,
      patient_name: patientNameById.get(r.patient_id) ?? null,
    }));
    const nextCursor = hasMore ? rawData[rawData.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canReport',
    message: 'トレーシングレポートの閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createTracingReportSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, case_id, issue_id, content, sent_to_physician } = parsed.data;
    if (
      !(await canAccessCaseScopedPatientResource({
        db: prisma,
        orgId: req.orgId,
        patientId: patient_id,
        caseId: case_id,
        accessContext: { userId: req.userId, role: req.role },
      }))
    ) {
      return validationError('患者またはケースの指定が不正です');
    }
    if (
      issue_id &&
      !(await canAttachMedicationIssue({
        orgId: req.orgId,
        patientId: patient_id,
        caseId: case_id,
        issueId: issue_id,
      }))
    ) {
      return validationError('薬学的課題の指定が不正です');
    }

    const report = await withOrgContext(req.orgId, async (tx) => {
      return tx.tracingReport.create({
        data: {
          org_id: req.orgId,
          patient_id,
          case_id,
          issue_id,
          content: content as import('@prisma/client').Prisma.InputJsonValue,
          sent_to_physician,
        },
      });
    });

    return success({ data: report }, 201);
  },
  {
    permission: 'canReport',
    message: 'トレーシングレポートの作成権限がありません',
  },
);
