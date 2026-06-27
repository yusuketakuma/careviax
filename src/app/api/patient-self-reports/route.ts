import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { parsePaginationParams } from '@/lib/api/pagination';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { getPatientPrivacyFlags } from '@/lib/patient/privacy';
import {
  patientSelfReportResponseSelect,
  serializePatientSelfReport,
} from '@/lib/patient/self-report-response';
import { z } from 'zod';
import { selfReportStatusSchema } from '@/lib/validations/self-report';

function trimStringOrUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);
const optionalTrimmedStringSchema = (max: number) =>
  z.preprocess(trimStringOrUndefined, z.string().max(max).optional());

const createSelfReportSchema = z.object({
  patient_id: requiredTrimmedStringSchema('患者IDは必須です'),
  reported_by_name: requiredTrimmedStringSchema('報告者氏名は必須です'),
  relation: optionalTrimmedStringSchema(100),
  category: z.string().trim().min(1, 'カテゴリは必須です').max(100),
  subject: z.string().trim().min(1, '件名は必須です').max(200),
  content: z.string().trim().min(1, '内容は必須です').max(4000),
  requested_callback: z.boolean().default(false),
  preferred_contact_time: optionalTrimmedStringSchema(200),
});

function optionalTrimmedSearchParam(value: string | null) {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalTrimmedSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  return { ok: true as const, value };
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
    if (!patientIdResult.ok) return withSensitiveNoStore(patientIdResult.response);
    const statusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!statusResult.ok) return withSensitiveNoStore(statusResult.response);
    const patientId = patientIdResult.value;
    const statusParam = statusResult.value;
    const status = statusParam ? selfReportStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return withSensitiveNoStore(
        validationError('患者自己申告ステータスが不正です', {
          status: ['対応していないステータスです'],
        }),
      );
    }

    const accessiblePatients = await prisma.patient.findMany({
      where: applyPatientAssignmentWhere(
        {
          org_id: ctx.orgId,
          ...(patientId ? { id: patientId } : {}),
        },
        ctx,
      ),
      select: {
        id: true,
        name: true,
        name_kana: true,
      },
    });
    const patientMap = new Map(accessiblePatients.map((patient) => [patient.id, patient]));
    const accessiblePatientIds = accessiblePatients.map((patient) => patient.id);

    if (accessiblePatientIds.length === 0) {
      return withSensitiveNoStore(success({ data: [], hasMore: false, nextCursor: undefined }));
    }

    const reports = await prisma.patientSelfReport.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: patientId ?? { in: accessiblePatientIds },
        ...(status ? { status: status.data } : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
      select: patientSelfReportResponseSelect,
    });

    const hasMore = reports.length > limit;
    const privacy = getPatientPrivacyFlags(ctx.role);
    const data = (hasMore ? reports.slice(0, limit) : reports).map((report) =>
      serializePatientSelfReport(report, privacy, patientMap.get(report.patient_id)),
    );
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return withSensitiveNoStore(success({ data, hasMore, nextCursor }));
  },
  {
    permission: 'canReport',
    message: '患者自己申告の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createSelfReportSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere(
        {
          id: parsed.data.patient_id,
          org_id: ctx.orgId,
        },
        ctx,
      ),
      select: { id: true },
    });
    if (!patient) return withSensitiveNoStore(notFound('患者が見つかりません'));

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const report = await tx.patientSelfReport.create({
        data: {
          org_id: ctx.orgId,
          patient_id: parsed.data.patient_id,
          reported_by_name: parsed.data.reported_by_name,
          relation: parsed.data.relation ?? null,
          category: parsed.data.category,
          subject: parsed.data.subject,
          content: parsed.data.content,
          requested_callback: parsed.data.requested_callback,
          preferred_contact_time: parsed.data.preferred_contact_time ?? null,
          triaged_by: ctx.userId,
          triaged_at: new Date(),
          status: 'triaged',
        },
        select: patientSelfReportResponseSelect,
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_self_report_created',
        targetType: 'patient_self_report',
        targetId: report.id,
        changes: {
          patient_id: report.patient_id,
          status_after: report.status,
          requested_callback: parsed.data.requested_callback,
          relation_provided: parsed.data.relation !== undefined,
          preferred_contact_time_provided: parsed.data.preferred_contact_time !== undefined,
        },
      });

      return report;
    });

    const privacy = getPatientPrivacyFlags(ctx.role);
    return withSensitiveNoStore(
      success({ data: serializePatientSelfReport(created, privacy) }, 201),
    );
  },
  {
    permission: 'canReport',
    message: '患者自己申告の登録権限がありません',
  },
);
