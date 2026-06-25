import { type AuthRouteContext, withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import {
  optionalTracingReportStatusSchema,
  optionalTrimmedSearchParam,
  optionalTrimmedStringSchema,
  requiredTrimmedStringSchema,
} from '@/lib/validations/tracing-report';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const createTracingReportSchema = z.object({
  patient_id: requiredTrimmedStringSchema('患者IDは必須です'),
  case_id: optionalTrimmedStringSchema,
  issue_id: optionalTrimmedStringSchema,
  content: z.record(z.string(), z.unknown()).default({}),
  sent_to_physician: optionalTrimmedStringSchema,
});

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [name]: [`${name} は1つだけ指定してください`],
      }),
    };
  }

  const value = optionalTrimmedSearchParam(values[0] ?? null);
  if (!value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  return { ok: true as const, value };
}

type TracingReportAccessDb = Pick<Prisma.TransactionClient, 'careCase'>;

async function buildTracingReportAccessWhere(
  db: TracingReportAccessDb,
  ctx: VisitScheduleAccessContext & { orgId: string },
): Promise<Prisma.TracingReportWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  if (!caseAssignmentWhere) return null;

  const accessibleCases = await db.careCase.findMany({
    where: {
      org_id: ctx.orgId,
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

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientIdResult = readPresentOptionalSearchParam(
      searchParams,
      'patient_id',
      '患者IDを指定してください',
    );
    if (!patientIdResult.ok) return patientIdResult.response;
    const statusParamResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!statusParamResult.ok) return statusParamResult.response;
    const patientId = patientIdResult.value;
    const statusParam = statusParamResult.value;
    const parsedStatus = optionalTracingReportStatusSchema.safeParse(statusParam);
    if (!parsedStatus.success) {
      return validationError('status が不正です', {
        status: ['status が不正です'],
      });
    }
    const status = parsedStatus.data;

    return withOrgContext(
      ctx.orgId,
      async (tx) => {
        const accessWhere = await buildTracingReportAccessWhere(tx, ctx);

        const where: Prisma.TracingReportWhereInput = {
          org_id: ctx.orgId,
          ...(accessWhere ?? {}),
          ...(patientId ? { patient_id: patientId } : {}),
          ...(status ? { status } : {}),
        };

        const reports = await tx.tracingReport.findMany({
          where,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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

        const page = buildCursorPage(reports, limit, (report) => report.id);
        const rawData = page.data;

        const patientIds = [...new Set(rawData.map((r) => r.patient_id))];
        const patients =
          patientIds.length > 0
            ? await tx.patient.findMany({
                where: { org_id: ctx.orgId, id: { in: patientIds } },
                select: { id: true, name: true },
              })
            : [];
        const patientNameById = new Map(patients.map((p) => [p.id, p.name]));

        const data = rawData.map((r) => ({
          ...r,
          patient_name: patientNameById.get(r.patient_id) ?? null,
        }));
        return success({ data, hasMore: page.hasMore, nextCursor: page.nextCursor });
      },
      { requestContext: ctx },
    );
  },
  {
    permission: 'canReport',
    message: 'トレーシングレポートの閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: AuthRouteContext<Record<string, string>>,
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createTracingReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, case_id, issue_id, content, sent_to_physician } = parsed.data;
    if (
      !(await canAccessCaseScopedPatientResource({
        db: prisma,
        orgId: ctx.orgId,
        patientId: patient_id,
        caseId: case_id,
        accessContext: ctx,
      }))
    ) {
      return validationError('患者またはケースの指定が不正です');
    }
    if (
      issue_id &&
      !(await canAttachMedicationIssue({
        orgId: ctx.orgId,
        patientId: patient_id,
        caseId: case_id,
        issueId: issue_id,
      }))
    ) {
      return validationError('薬学的課題の指定が不正です');
    }

    const report = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.tracingReport.create({
        data: {
          org_id: ctx.orgId,
          patient_id,
          case_id,
          issue_id,
          content: toPrismaJsonInput(content),
          sent_to_physician,
        },
      });
    });

    return success({ data: report }, 201);
  },
  {
    permission: 'canAuthorReport',
    message: 'トレーシングレポートの作成権限がありません',
  },
);
