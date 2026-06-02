import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { readJsonObject, readJsonObjectString, toPrismaJsonInput } from '@/lib/db/json';
import { Prisma, ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';
import { getHomeVisitIntake, buildBaselineContext } from '@/lib/patient/home-visit-intake';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';
import {
  buildCareReportAccessWhere,
  canAccessCareReportSource,
  getCareReportAccessScope,
} from '@/server/services/care-report-access';

function trimStringOrUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);
const optionalTrimmedStringSchema = z.preprocess(
  trimStringOrUndefined,
  z.string().min(1).optional(),
);

const createCareReportSchema = z.object({
  patient_id: requiredTrimmedStringSchema('患者IDは必須です'),
  case_id: optionalTrimmedStringSchema,
  visit_record_id: optionalTrimmedStringSchema,
  report_type: z.enum([
    'physician_report',
    'care_manager_report',
    'facility_handoff',
    'nurse_share',
    'family_share',
    'internal_record',
  ]),
  content: z.record(z.string(), z.unknown()).default({}),
  template_id: optionalTrimmedStringSchema,
});

const careReportSelect = {
  id: true,
  org_id: true,
  patient_id: true,
  case_id: true,
  visit_record_id: true,
  report_type: true,
  status: true,
  content: true,
  template_id: true,
  pdf_url: true,
  created_by: true,
  created_at: true,
  updated_at: true,
  delivery_records: {
    select: {
      id: true,
      channel: true,
      recipient_name: true,
      status: true,
      sent_at: true,
    },
    orderBy: { created_at: 'desc' },
    take: 10,
  },
} satisfies Prisma.CareReportSelect;

const reportStatusSchema = z.nativeEnum(ReportStatus);
const reportTypeSchema = z.nativeEnum(ReportType);
const optionalDateParamSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '日付が不正です')
  .optional();
const careReportQuerySchema = z.object({
  patient_id: z.string().trim().min(1).optional(),
  visit_record_id: z.string().trim().min(1).optional(),
  status: reportStatusSchema.optional(),
  report_type: reportTypeSchema.optional(),
  delivery_status: reportStatusSchema.optional(),
  recipient: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  keyword: z.string().min(1).optional(),
  date_from: optionalDateParamSchema,
  date_to: optionalDateParamSchema,
  sent_from: optionalDateParamSchema,
  sent_to: optionalDateParamSchema,
});

function optionalTrimmedSearchParam(value: string | null) {
  return value?.trim() || undefined;
}

async function validateCareReportSource(args: {
  orgId: string;
  userId: string;
  role: AuthenticatedRequest['role'];
  patientId: string;
  caseId?: string;
  visitRecordId?: string;
}): Promise<{ error: string } | { caseId?: string }> {
  const patient = await prisma.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: { id: true },
  });
  if (!patient) {
    return { error: '患者が見つかりません' };
  }

  if (args.caseId) {
    const careCase = await prisma.careCase.findFirst({
      where: { id: args.caseId, org_id: args.orgId, patient_id: args.patientId },
      select: { id: true },
    });
    if (!careCase) {
      return { error: 'ケースが患者に紐付いていません' };
    }
  }

  let resolvedCaseId = args.caseId;
  if (args.visitRecordId) {
    const visitRecord = await prisma.visitRecord.findFirst({
      where: { id: args.visitRecordId, org_id: args.orgId, patient_id: args.patientId },
      select: {
        id: true,
        schedule: {
          select: {
            case_id: true,
          },
        },
      },
    });

    if (!visitRecord) {
      return { error: '訪問記録が患者に紐付いていません' };
    }

    if (args.caseId && visitRecord.schedule.case_id !== args.caseId) {
      return { error: '訪問記録が指定ケースに紐付いていません' };
    }
    resolvedCaseId = visitRecord.schedule.case_id;
  }

  const canAccess = await canAccessCareReportSource(
    prisma,
    args.orgId,
    { userId: args.userId, role: args.role },
    {
      patientId: args.patientId,
      caseId: resolvedCaseId,
      visitRecordId: args.visitRecordId,
    },
  );
  if (!canAccess) {
    return { error: 'この報告書の作成権限がありません' };
  }

  return { caseId: resolvedCaseId };
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const parsedQuery = careReportQuerySchema.safeParse({
      patient_id: optionalTrimmedSearchParam(searchParams.get('patient_id')),
      visit_record_id: optionalTrimmedSearchParam(searchParams.get('visit_record_id')),
      status: searchParams.get('status') ?? undefined,
      report_type: searchParams.get('report_type') ?? undefined,
      delivery_status: searchParams.get('delivery_status') ?? undefined,
      recipient: optionalTrimmedSearchParam(searchParams.get('recipient')),
      q: optionalTrimmedSearchParam(searchParams.get('q')),
      keyword: optionalTrimmedSearchParam(searchParams.get('keyword')),
      date_from: searchParams.get('date_from') ?? undefined,
      date_to: searchParams.get('date_to') ?? undefined,
      sent_from: searchParams.get('sent_from') ?? undefined,
      sent_to: searchParams.get('sent_to') ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError('検索条件が不正です', parsedQuery.error.flatten().fieldErrors);
    }

    const {
      patient_id: patientId,
      visit_record_id: visitRecordId,
      status,
      report_type: reportType,
      delivery_status: deliveryStatus,
      recipient,
      q: query,
      keyword,
      date_from: dateFrom,
      date_to: dateTo,
      sent_from: sentFromRaw,
      sent_to: sentToRaw,
    } = parsedQuery.data;

    const matchingPatients = query
      ? await prisma.patient.findMany({
          where: {
            org_id: req.orgId,
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { name_kana: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            name: true,
            name_kana: true,
          },
        })
      : [];

    const matchedPatientIds = matchingPatients.map((patient) => patient.id);
    const matchedPatientIdSet = new Set(matchedPatientIds);
    if (query && matchedPatientIds.length === 0 && !keyword) {
      return success({
        data: [],
        hasMore: false,
        nextCursor: undefined,
        deliverySummary: {
          pending_delivery_count: 0,
          failed_delivery_count: 0,
          by_status: {},
        },
      });
    }

    const accessScope = await getCareReportAccessScope(prisma, req.orgId, req);
    const accessWhere = buildCareReportAccessWhere(accessScope);
    const where: Prisma.CareReportWhereInput = {
      org_id: req.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(visitRecordId ? { visit_record_id: visitRecordId } : {}),
      ...(query ? { patient_id: { in: matchedPatientIds } } : {}),
      ...(status ? { status } : {}),
      ...(reportType ? { report_type: reportType } : {}),
      ...(dateFrom || dateTo
        ? {
            created_at: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(deliveryStatus || recipient
        ? {
            delivery_records: {
              some: {
                ...(deliveryStatus ? { status: deliveryStatus } : {}),
                ...(recipient
                  ? {
                      recipient_name: {
                        contains: recipient,
                        mode: 'insensitive' as const,
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
      ...(accessWhere ? { AND: [accessWhere] } : {}),
    };

    const reports = await prisma.careReport.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: careReportSelect,
    });

    const patientIds = Array.from(new Set(reports.map((report) => report.patient_id)));
    const patientRows =
      matchingPatients.length > 0 && !patientId
        ? matchingPatients.filter((patient) => patientIds.includes(patient.id))
        : patientIds.length === 0
          ? []
          : await prisma.patient.findMany({
              where: {
                org_id: req.orgId,
                id: { in: patientIds },
              },
              select: {
                id: true,
                name: true,
                name_kana: true,
              },
            });
    const patientNameById = new Map(patientRows.map((patient) => [patient.id, patient.name]));

    const enrichedData = reports.map((report) => {
      const billingContext = readJsonObject(readJsonObject(report.content)?.billing_context);
      const latestDelivery = report.delivery_records[0] ?? null;
      const pendingDeliveryCount = report.delivery_records.filter(
        (record) => record.status === 'response_waiting',
      ).length;
      const failedDeliveryCount = report.delivery_records.filter(
        (record) => record.status === 'failed',
      ).length;

      return {
        ...report,
        patient_name: patientNameById.get(report.patient_id) ?? null,
        latest_delivery_status: latestDelivery?.status ?? null,
        latest_delivery_sent_at: latestDelivery?.sent_at ?? null,
        latest_delivery_recipient_name: latestDelivery?.recipient_name ?? null,
        failed_delivery_count: failedDeliveryCount,
        pending_delivery_count: pendingDeliveryCount,
        effective_revision_code: readJsonObjectString(billingContext, 'effective_revision_code'),
        site_config_status: readJsonObjectString(billingContext, 'site_config_status'),
      };
    });

    const sentFrom = sentFromRaw ? new Date(`${sentFromRaw}T00:00:00.000Z`) : null;
    const sentTo = sentToRaw ? new Date(`${sentToRaw}T23:59:59.999Z`) : null;
    const filteredData = enrichedData.filter((report) => {
      if (query && !matchedPatientIdSet.has(report.patient_id)) {
        return false;
      }
      if (keyword) {
        const contentText = JSON.stringify(report.content).toLowerCase();
        if (!contentText.includes(keyword.toLowerCase())) {
          return false;
        }
      }
      if (sentFrom || sentTo) {
        const hasMatchingDelivery = report.delivery_records.some((delivery) => {
          if (!delivery.sent_at) return false;
          if (sentFrom && delivery.sent_at < sentFrom) return false;
          if (sentTo && delivery.sent_at > sentTo) return false;
          return true;
        });
        if (!hasMatchingDelivery) {
          return false;
        }
      }
      return true;
    });

    const cursorIndex = cursor ? filteredData.findIndex((report) => report.id === cursor) : -1;
    const paginated = cursorIndex >= 0 ? filteredData.slice(cursorIndex + 1) : filteredData;
    const hasMore = paginated.length > limit;
    const data = hasMore ? paginated.slice(0, limit) : paginated;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;
    const deliverySummary = filteredData.reduce(
      (summary, report) => {
        if (report.latest_delivery_status) {
          summary.by_status[report.latest_delivery_status] =
            (summary.by_status[report.latest_delivery_status] ?? 0) + 1;
          if (report.latest_delivery_status === 'response_waiting') {
            summary.pending_delivery_count += 1;
          }
        }
        summary.failed_delivery_count += report.failed_delivery_count;
        return summary;
      },
      {
        pending_delivery_count: 0,
        failed_delivery_count: 0,
        by_status: {} as Record<string, number>,
      },
    );

    return success({ data, hasMore, nextCursor, deliverySummary });
  },
  {
    permission: 'canReport',
    message: '報告書の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCareReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const sourceValidation = await validateCareReportSource({
      orgId: req.orgId,
      userId: req.userId,
      role: req.role,
      patientId: parsed.data.patient_id,
      caseId: parsed.data.case_id,
      visitRecordId: parsed.data.visit_record_id,
    });
    if ('error' in sourceValidation) {
      return validationError(sourceValidation.error);
    }
    const resolvedCaseId = sourceValidation.caseId;

    const { content, ...reportInput } = parsed.data;
    let enrichedContent = content;
    let recipientPrefill: { recipient_name?: string; recipient_organization?: string } | undefined;

    if (resolvedCaseId) {
      const careCase = await prisma.careCase.findFirst({
        where: { id: resolvedCaseId, org_id: req.orgId },
        select: { required_visit_support: true },
      });

      const intake = getHomeVisitIntake(careCase?.required_visit_support) ?? undefined;

      if (intake) {
        enrichedContent = { ...enrichedContent, baseline_context: buildBaselineContext(intake) };

        if (
          intake.requester?.profession === 'physician' &&
          parsed.data.report_type === 'physician_report'
        ) {
          recipientPrefill = {
            recipient_name: intake.requester.contact_name,
            recipient_organization: intake.requester.organization_name,
          };
          if (recipientPrefill.recipient_name || recipientPrefill.recipient_organization) {
            enrichedContent = { ...enrichedContent, recipient_prefill: recipientPrefill };
          }
        }
      }
    }

    if (
      parsed.data.report_type === 'physician_report' &&
      (!recipientPrefill?.recipient_name || !recipientPrefill?.recipient_organization)
    ) {
      const suggestion = await findLatestPrescriberInstitutionSuggestion(prisma, req.orgId, {
        caseId: resolvedCaseId,
        patientId: parsed.data.patient_id,
      });

      if (suggestion) {
        recipientPrefill = {
          recipient_name: suggestion.prescriber_name ?? suggestion.name,
          recipient_organization: suggestion.name,
        };
        enrichedContent = {
          ...enrichedContent,
          recipient_prefill: recipientPrefill,
          prescriber_institution_suggestion: {
            id: suggestion.id,
            name: suggestion.name,
            phone: suggestion.phone,
            fax: suggestion.fax,
          },
        };
      }
    }

    const report = await withOrgContext(req.orgId, async (tx) => {
      return tx.careReport.create({
        data: {
          org_id: req.orgId,
          created_by: req.userId,
          ...reportInput,
          case_id: resolvedCaseId ?? null,
          content: toPrismaJsonInput(enrichedContent),
        },
      });
    });

    return success({ data: report }, 201);
  },
  {
    permission: 'canReport',
    message: '報告書の作成権限がありません',
  },
);
