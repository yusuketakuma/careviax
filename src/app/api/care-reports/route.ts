import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { Prisma, ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';
import { getHomeVisitIntake, buildBaselineContext } from '@/lib/patient/home-visit-intake';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';

const createCareReportSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  visit_record_id: z.string().optional(),
  report_type: z.enum([
    'physician_report',
    'care_manager_report',
    'facility_handoff',
    'nurse_share',
    'family_share',
    'internal_record',
  ]),
  content: z.record(z.string(), z.unknown()).default({}).transform((v) => v as import('@prisma/client').Prisma.InputJsonValue),
  template_id: z.string().optional(),
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
  patient_id: z.string().min(1).optional(),
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

function normalizeOptionalSearchParam(value: string | null) {
  return value?.trim() || undefined;
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const parsedQuery = careReportQuerySchema.safeParse({
    patient_id: searchParams.get('patient_id') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    report_type: searchParams.get('report_type') ?? undefined,
    delivery_status: searchParams.get('delivery_status') ?? undefined,
    recipient: normalizeOptionalSearchParam(searchParams.get('recipient')),
    q: normalizeOptionalSearchParam(searchParams.get('q')),
    keyword: normalizeOptionalSearchParam(searchParams.get('keyword')),
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

  const where: Prisma.CareReportWhereInput = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
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
    const latestDelivery = report.delivery_records[0] ?? null;
    const pendingDeliveryCount = report.delivery_records.filter(
      (record) => record.status === 'response_waiting'
    ).length;
    const failedDeliveryCount = report.delivery_records.filter(
      (record) => record.status === 'failed'
    ).length;

    return {
      ...report,
      patient_name: patientNameById.get(report.patient_id) ?? null,
      latest_delivery_status: latestDelivery?.status ?? null,
      latest_delivery_sent_at: latestDelivery?.sent_at ?? null,
      latest_delivery_recipient_name: latestDelivery?.recipient_name ?? null,
      failed_delivery_count: failedDeliveryCount,
      pending_delivery_count: pendingDeliveryCount,
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
    }
  );

  return success({ data, hasMore, nextCursor, deliverySummary });
}, {
  permission: 'canReport',
  message: '報告書の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  let enrichedContent = parsed.data.content as Record<string, unknown>;
  let recipientPrefill: { recipient_name?: string; recipient_organization?: string } | undefined;

  if (parsed.data.case_id) {
    const careCase = await prisma.careCase.findFirst({
      where: { id: parsed.data.case_id, org_id: req.orgId },
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
      caseId: parsed.data.case_id,
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
        ...parsed.data,
        content: enrichedContent as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
  });

  return success({ data: report }, 201);
}, {
  permission: 'canReport',
  message: '報告書の作成権限がありません',
});
