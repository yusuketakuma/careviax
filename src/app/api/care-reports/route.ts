import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, forbidden, internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseOptionalBoundedIntegerParam, parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { readJsonObject, readJsonObjectString, toPrismaJsonInput } from '@/lib/db/json';
import { dateKeySchema } from '@/lib/validations/date-key';
import { Prisma, ReportStatus, ReportType, type CareReport } from '@prisma/client';
import { z } from 'zod';
import { getHomeVisitIntake, buildBaselineContext } from '@/lib/patient/home-visit-intake';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';
import {
  buildCareReportAccessWhere,
  canAccessCareReportSource,
  getCareReportAccessScope,
} from '@/server/services/care-report-access';
import { canOutputCareReport } from '@/server/services/care-report-output-policy';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { japanDayInstantRangeFromDateKey } from '@/lib/utils/date-boundary';

const ROUTE = '/api/care-reports';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

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

const careReportBaseSelect = {
  id: true,
  org_id: true,
  patient_id: true,
  case_id: true,
  visit_record_id: true,
  report_type: true,
  status: true,
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

const careReportContentSelect = {
  ...careReportBaseSelect,
  content: true,
} satisfies Prisma.CareReportSelect;

type CareReportListRow = Prisma.CareReportGetPayload<{
  select: typeof careReportBaseSelect;
}> & {
  content?: Prisma.JsonValue;
};
type CareReportSourceDb = Pick<Prisma.TransactionClient, 'careCase' | 'patient' | 'visitRecord'>;
type CareReportVisitLockDb = Pick<Prisma.TransactionClient, '$queryRaw'>;
type CareReportCreateResult =
  | { kind: 'validation_error'; response: Response }
  | { kind: 'created'; report: CareReport };

const careReportListOrderBy = [
  { created_at: 'desc' },
  { id: 'desc' },
] satisfies Prisma.CareReportOrderByWithRelationInput[];
const CARE_REPORT_KEYWORD_SCAN_LIMIT = 500;
const DEFAULT_CARE_REPORT_PALETTE_LIMIT = 8;
const MAX_CARE_REPORT_PALETTE_LIMIT = 50;

const reportStatusSchema = z.nativeEnum(ReportStatus);
const reportTypeSchema = z.nativeEnum(ReportType);
const optionalDateParamSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional();
const careReportQuerySchema = z.object({
  view: z.enum(['palette']).optional(),
  patient_id: z.string().trim().min(1).optional(),
  visit_record_id: z.string().trim().min(1).optional(),
  include_content: z.enum(['1', 'true']).optional(),
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

const careReportPresentQueryFields = [
  ['view', '表示形式を指定してください'],
  ['patient_id', '患者IDを指定してください'],
  ['visit_record_id', '訪問記録IDを指定してください'],
  ['include_content', '本文取得指定を指定してください'],
  ['status', 'ステータスを指定してください'],
  ['report_type', '報告書種別を指定してください'],
  ['delivery_status', '送付ステータスを指定してください'],
  ['recipient', '送付先を指定してください'],
  ['q', '検索語を指定してください'],
  ['keyword', '本文検索語を指定してください'],
  ['date_from', '開始日を指定してください'],
  ['date_to', '終了日を指定してください'],
  ['sent_from', '送付開始日を指定してください'],
  ['sent_to', '送付終了日を指定してください'],
] as const;

function readPresentOptionalSearchParams(searchParams: URLSearchParams) {
  const values: Record<string, string | undefined> = {};
  const fieldErrors: Record<string, string[]> = {};

  for (const [name, message] of careReportPresentQueryFields) {
    const value = optionalTrimmedSearchParam(searchParams.get(name));
    if (searchParams.has(name) && !value) {
      fieldErrors[name] = [message];
    }
    values[name] = value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', fieldErrors),
    };
  }

  return { ok: true as const, values };
}

function parseCareReportPaletteLimit(value: string | null) {
  const parsed = parseOptionalBoundedIntegerParam(value, 1, MAX_CARE_REPORT_PALETTE_LIMIT);
  if (!parsed.ok) {
    return {
      ok: false as const,
      response: validationError('limit は 1〜50 の整数で指定してください', {
        limit: ['limit は 1〜50 の整数で指定してください'],
      }),
    };
  }

  return {
    ok: true as const,
    value: parsed.value ?? DEFAULT_CARE_REPORT_PALETTE_LIMIT,
  };
}

function findUnsupportedPaletteCareReportFilters(args: {
  cursor?: string;
  visitRecordId?: string;
  includeContent?: string;
  deliveryStatus?: ReportStatus;
  recipient?: string;
  keyword?: string;
  sentFrom?: string;
  sentTo?: string;
}) {
  const entries = [
    ['cursor', args.cursor],
    ['visit_record_id', args.visitRecordId],
    ['include_content', args.includeContent],
    ['delivery_status', args.deliveryStatus],
    ['recipient', args.recipient],
    ['keyword', args.keyword],
    ['sent_from', args.sentFrom],
    ['sent_to', args.sentTo],
  ] as const;

  return entries.filter(([, value]) => value !== undefined).map(([key]) => key);
}

function readSearchableReportText(contentValue: Prisma.JsonValue) {
  const content = readJsonObject(contentValue);
  const safeTextValues = [
    readJsonObjectString(content, 'title'),
    readJsonObjectString(content, 'summary'),
    readJsonObjectString(content, 'body'),
    readJsonObjectString(content, 'assessment'),
    readJsonObjectString(content, 'plan'),
  ];
  return safeTextValues.filter(Boolean).join('\n').toLowerCase();
}

function readSelectedReportContent(report: CareReportListRow, shouldReadContent: boolean) {
  if (!shouldReadContent || !('content' in report)) return null;
  return report.content ?? null;
}

function buildCareReportContentSummary(contentValue: Prisma.JsonValue) {
  const content = readJsonObject(contentValue);
  if (!content) {
    return {
      title: null,
      summary: null,
      assessment: null,
      plan: null,
    };
  }

  return {
    title: readJsonObjectString(content, 'title'),
    summary: readJsonObjectString(content, 'summary'),
    assessment: readJsonObjectString(content, 'assessment'),
    plan: readJsonObjectString(content, 'plan'),
  };
}

function appendCareReportWhereAnd(
  where: Prisma.CareReportWhereInput,
  clause: Prisma.CareReportWhereInput,
): Prisma.CareReportWhereInput {
  const existingAnd = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  return { ...where, AND: [...existingAnd, clause] };
}

function buildCareReportCursorWhere(cursorReport: {
  id: string;
  created_at: Date;
}): Prisma.CareReportWhereInput {
  return {
    OR: [
      { created_at: { lt: cursorReport.created_at } },
      {
        created_at: { equals: cursorReport.created_at },
        id: { lt: cursorReport.id },
      },
    ],
  };
}

function buildDeliverySummary(
  reports: Array<{
    delivery_records: Array<{
      status: ReportStatus | string;
    }>;
  }>,
) {
  return reports.reduce(
    (summary, report) => {
      const latestDeliveryStatus = report.delivery_records[0]?.status ?? null;
      if (latestDeliveryStatus) {
        summary.by_status[latestDeliveryStatus] =
          (summary.by_status[latestDeliveryStatus] ?? 0) + 1;
        if (latestDeliveryStatus === 'response_waiting') {
          summary.pending_delivery_count += 1;
        }
      }
      summary.failed_delivery_count += report.delivery_records.filter(
        (record) => record.status === 'failed',
      ).length;
      return summary;
    },
    {
      pending_delivery_count: 0,
      failed_delivery_count: 0,
      by_status: {} as Record<string, number>,
    },
  );
}

const DELIVERY_SUMMARY_LATEST_CHUNK_SIZE = 500;

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function buildDeliverySummaryForWhere(where: Prisma.CareReportWhereInput) {
  const deliveryWhere = {
    report: {
      is: where,
    },
  } satisfies Prisma.DeliveryRecordWhereInput;

  const [failedDeliveryCount, latestGroups] = await Promise.all([
    prisma.deliveryRecord.count({
      where: {
        ...deliveryWhere,
        status: 'failed',
      },
    }),
    prisma.deliveryRecord.groupBy({
      by: ['report_id'],
      where: deliveryWhere,
      _max: {
        created_at: true,
      },
    }),
  ]);

  const latestConditions = latestGroups.flatMap((group) =>
    group._max.created_at
      ? [
          {
            report_id: group.report_id,
            created_at: group._max.created_at,
          },
        ]
      : [],
  );

  const latestRows = (
    await Promise.all(
      chunkArray(latestConditions, DELIVERY_SUMMARY_LATEST_CHUNK_SIZE).map((conditions) =>
        prisma.deliveryRecord.findMany({
          where: {
            OR: conditions,
          },
          select: {
            id: true,
            report_id: true,
            status: true,
            created_at: true,
          },
          orderBy: [{ report_id: 'asc' }, { created_at: 'desc' }, { id: 'desc' }],
        }),
      ),
    )
  ).flat();

  const latestStatusByReport = new Map<string, ReportStatus | string>();
  for (const row of latestRows) {
    if (!latestStatusByReport.has(row.report_id)) {
      latestStatusByReport.set(row.report_id, row.status);
    }
  }

  const byStatus: Record<string, number> = {};
  let pendingDeliveryCount = 0;
  for (const status of latestStatusByReport.values()) {
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === 'response_waiting') pendingDeliveryCount += 1;
  }

  return {
    pending_delivery_count: pendingDeliveryCount,
    failed_delivery_count: failedDeliveryCount,
    by_status: byStatus,
  };
}

function isCareReportVisitTypeUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes('org_id') &&
    error.meta.target.includes('visit_record_id') &&
    error.meta.target.includes('report_type')
  );
}

function duplicateCareReportResponse(report: {
  id?: string;
  report_type: ReportType;
  status?: ReportStatus;
}) {
  return conflict('この訪問記録の同一種別の報告書は既に存在します', {
    ...(report.id ? { report_id: report.id } : {}),
    report_type: report.report_type,
    ...(report.status ? { status: report.status } : {}),
  });
}

async function lockCareReportVisitRecordSource(
  db: CareReportVisitLockDb,
  orgId: string,
  visitRecordId?: string,
) {
  if (!visitRecordId) return;

  await db.$queryRaw(
    Prisma.sql`SELECT "id" FROM "VisitRecord" WHERE "id" = ${visitRecordId} AND "org_id" = ${orgId} FOR UPDATE`,
  );
}

async function buildVisitReportSourceProvenance(
  db: Pick<Prisma.TransactionClient, 'visitRecord'>,
  args: { orgId: string; visitRecordId?: string },
) {
  if (!args.visitRecordId) return null;
  const visitRecord = await db.visitRecord.findFirst({
    where: { id: args.visitRecordId, org_id: args.orgId },
    select: { id: true, version: true, updated_at: true },
  });
  if (!visitRecord) return null;
  if (typeof visitRecord.version !== 'number' || !(visitRecord.updated_at instanceof Date)) {
    return null;
  }
  return {
    schema_version: 1,
    visit_record_id: visitRecord.id,
    visit_record_version: visitRecord.version,
    visit_record_updated_at: visitRecord.updated_at.toISOString(),
    generated_at: new Date().toISOString(),
    source: 'manual_care_report_create',
  };
}

async function validateCareReportSource(
  db: CareReportSourceDb,
  args: {
    orgId: string;
    userId: string;
    role: AuthContext['role'];
    patientId: string;
    caseId?: string;
    visitRecordId?: string;
  },
): Promise<{ error: string } | { caseId?: string }> {
  const patient = await db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: { id: true },
  });
  if (!patient) {
    return { error: '患者が見つかりません' };
  }

  if (args.caseId) {
    const careCase = await db.careCase.findFirst({
      where: { id: args.caseId, org_id: args.orgId, patient_id: args.patientId },
      select: { id: true },
    });
    if (!careCase) {
      return { error: 'ケースが患者に紐付いていません' };
    }
  }

  let resolvedCaseId = args.caseId;
  if (args.visitRecordId) {
    const visitRecord = await db.visitRecord.findFirst({
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
    db,
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

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const presentQueryParams = readPresentOptionalSearchParams(searchParams);
    if (!presentQueryParams.ok) return withSensitiveNoStore(presentQueryParams.response);
    const queryParams = presentQueryParams.values;
    const parsedQuery = careReportQuerySchema.safeParse({
      view: queryParams.view,
      patient_id: queryParams.patient_id,
      visit_record_id: queryParams.visit_record_id,
      include_content: queryParams.include_content,
      status: queryParams.status,
      report_type: queryParams.report_type,
      delivery_status: queryParams.delivery_status,
      recipient: queryParams.recipient,
      q: queryParams.q,
      keyword: queryParams.keyword,
      date_from: queryParams.date_from,
      date_to: queryParams.date_to,
      sent_from: queryParams.sent_from,
      sent_to: queryParams.sent_to,
    });
    if (!parsedQuery.success) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', parsedQuery.error.flatten().fieldErrors),
      );
    }

    const {
      view,
      patient_id: patientId,
      visit_record_id: visitRecordId,
      include_content: includeContent,
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
    const paletteLimit =
      view === 'palette' ? parseCareReportPaletteLimit(searchParams.get('limit')) : null;
    if (paletteLimit && !paletteLimit.ok) {
      return withSensitiveNoStore(paletteLimit.response);
    }
    if (view === 'palette') {
      const unsupportedPaletteFilters = findUnsupportedPaletteCareReportFilters({
        cursor,
        visitRecordId,
        includeContent,
        deliveryStatus,
        recipient,
        keyword,
        sentFrom: sentFromRaw,
        sentTo: sentToRaw,
      });
      if (unsupportedPaletteFilters.length > 0) {
        return withSensitiveNoStore(
          validationError(
            'palette 表示では対応していない検索条件です',
            Object.fromEntries(
              unsupportedPaletteFilters.map((key) => [
                key,
                [
                  'palette 表示では q/limit/patient_id/status/report_type/date_from/date_to のみ指定できます',
                ],
              ]),
            ),
          ),
        );
      }
    }
    const sentAtRange =
      sentFromRaw || sentToRaw
        ? {
            ...(sentFromRaw ? { gte: japanDayInstantRangeFromDateKey(sentFromRaw).gte } : {}),
            ...(sentToRaw ? { lt: japanDayInstantRangeFromDateKey(sentToRaw).lt } : {}),
          }
        : null;
    const canOutputReport = canOutputCareReport(ctx.role);
    if (keyword && !canOutputReport) {
      return withSensitiveNoStore(forbidden('報告書本文検索の権限がありません'));
    }
    if (keyword && cursor) {
      return withSensitiveNoStore(
        validationError('報告書本文検索ではカーソルページングを利用できません', {
          cursor: ['本文検索ではカーソルを指定できません'],
        }),
      );
    }

    const resolvedPaletteLimit =
      view === 'palette' && paletteLimit?.ok
        ? paletteLimit.value
        : DEFAULT_CARE_REPORT_PALETTE_LIMIT;

    const paletteMatchingPatients =
      query && view === 'palette'
        ? await prisma.patient.findMany({
            where: {
              org_id: ctx.orgId,
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { name_kana: { contains: query, mode: 'insensitive' } },
              ],
            },
            select: {
              id: true,
              name: true,
            },
            take: resolvedPaletteLimit + 1,
          })
        : [];

    const matchingPatients =
      query && view !== 'palette'
        ? await prisma.patient.findMany({
            where: {
              org_id: ctx.orgId,
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

    const matchedPatientIds =
      view === 'palette'
        ? paletteMatchingPatients.map((patient) => patient.id)
        : matchingPatients.map((patient) => patient.id);
    if (query && matchedPatientIds.length === 0 && !keyword) {
      if (view === 'palette') {
        return withSensitiveNoStore(
          success({
            data: [],
            hasMore: false,
          }),
        );
      }

      return withSensitiveNoStore(
        success({
          data: [],
          hasMore: false,
          nextCursor: undefined,
          deliverySummary: {
            pending_delivery_count: 0,
            failed_delivery_count: 0,
            by_status: {},
          },
        }),
      );
    }

    const accessScope = await getCareReportAccessScope(prisma, ctx.orgId, ctx);
    const accessWhere = buildCareReportAccessWhere(accessScope);
    const where: Prisma.CareReportWhereInput = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(visitRecordId ? { visit_record_id: visitRecordId } : {}),
      ...(query ? { patient_id: { in: matchedPatientIds } } : {}),
      ...(status ? { status } : {}),
      ...(reportType ? { report_type: reportType } : {}),
      ...(dateFrom || dateTo
        ? {
            created_at: {
              ...(dateFrom ? { gte: japanDayInstantRangeFromDateKey(dateFrom).gte } : {}),
              ...(dateTo ? { lt: japanDayInstantRangeFromDateKey(dateTo).lt } : {}),
            },
          }
        : {}),
      ...(deliveryStatus || recipient || sentAtRange
        ? {
            delivery_records: {
              some: {
                ...(deliveryStatus ? { status: deliveryStatus } : {}),
                ...(sentAtRange
                  ? {
                      sent_at: sentAtRange,
                    }
                  : {}),
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

    if (view === 'palette') {
      const reports = await prisma.careReport.findMany({
        where,
        orderBy: careReportListOrderBy,
        select: {
          id: true,
          patient_id: true,
          report_type: true,
          status: true,
          created_at: true,
        },
        take: resolvedPaletteLimit + 1,
      });
      const hasMore = reports.length > resolvedPaletteLimit;
      const dataRows = hasMore ? reports.slice(0, resolvedPaletteLimit) : reports;
      const patientIds = Array.from(new Set(dataRows.map((report) => report.patient_id)));
      const patientRows =
        paletteMatchingPatients.length > 0 && !patientId
          ? paletteMatchingPatients.filter((patient) => patientIds.includes(patient.id))
          : patientIds.length === 0
            ? []
            : await prisma.patient.findMany({
                where: {
                  org_id: ctx.orgId,
                  id: { in: patientIds },
                },
                select: {
                  id: true,
                  name: true,
                },
              });
      const patientNameById = new Map(patientRows.map((patient) => [patient.id, patient.name]));

      return withSensitiveNoStore(
        success({
          data: dataRows.map((report) => ({
            id: report.id,
            report_type: report.report_type,
            status: report.status,
            created_at: report.created_at,
            patient_id: report.patient_id,
            patient: patientNameById.has(report.patient_id)
              ? { name: patientNameById.get(report.patient_id)! }
              : null,
          })),
          hasMore,
        }),
      );
    }

    const canUseDbPagination = !keyword;
    const shouldReadContent = Boolean((includeContent && canOutputReport) || keyword);
    const cursorReport =
      canUseDbPagination && cursor
        ? await prisma.careReport.findFirst({
            where: { ...where, id: cursor },
            select: { id: true, created_at: true },
          })
        : null;
    if (canUseDbPagination && cursor && !cursorReport) {
      return withSensitiveNoStore(
        validationError('ページカーソルが不正です', {
          cursor: ['カーソルが見つかりません'],
        }),
      );
    }
    const listWhere = cursorReport
      ? appendCareReportWhereAnd(where, buildCareReportCursorWhere(cursorReport))
      : where;

    const reports = (await prisma.careReport.findMany({
      where: listWhere,
      orderBy: careReportListOrderBy,
      select: shouldReadContent ? careReportContentSelect : careReportBaseSelect,
      ...(canUseDbPagination ? { take: limit + 1 } : { take: CARE_REPORT_KEYWORD_SCAN_LIMIT }),
    })) as CareReportListRow[];

    const patientIds = Array.from(new Set(reports.map((report) => report.patient_id)));
    const patientRows =
      matchingPatients.length > 0 && !patientId
        ? matchingPatients.filter((patient) => patientIds.includes(patient.id))
        : patientIds.length === 0
          ? []
          : await prisma.patient.findMany({
              where: {
                org_id: ctx.orgId,
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
      const reportContent = readSelectedReportContent(report, shouldReadContent);
      const billingContext = reportContent
        ? readJsonObject(readJsonObject(reportContent)?.billing_context)
        : null;
      const latestDelivery = report.delivery_records[0] ?? null;
      const pendingDeliveryCount = report.delivery_records.filter(
        (record) => record.status === 'response_waiting',
      ).length;
      const failedDeliveryCount = report.delivery_records.filter(
        (record) => record.status === 'failed',
      ).length;

      return {
        id: report.id,
        org_id: report.org_id,
        patient_id: report.patient_id,
        case_id: report.case_id,
        visit_record_id: report.visit_record_id,
        report_type: report.report_type,
        status: report.status,
        template_id: report.template_id,
        pdf_url: canOutputReport ? report.pdf_url : null,
        created_by: report.created_by,
        created_at: report.created_at,
        updated_at: report.updated_at,
        ...(includeContent && canOutputReport && reportContent !== null
          ? { content_summary: buildCareReportContentSummary(reportContent) }
          : {}),
        delivery_records: report.delivery_records,
        _searchable_report_text: reportContent ? readSearchableReportText(reportContent) : '',
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

    const filteredData = enrichedData.filter((report) => {
      if (keyword) {
        if (!report._searchable_report_text.includes(keyword.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    const paginated = canUseDbPagination
      ? filteredData
      : filteredData.slice(
          cursor ? Math.max(filteredData.findIndex((report) => report.id === cursor) + 1, 0) : 0,
        );
    const hasMore = paginated.length > limit;
    const data = (hasMore ? paginated.slice(0, limit) : paginated).map((report) => {
      const { _searchable_report_text: searchableReportText, ...reportForResponse } = report;
      void searchableReportText;
      return reportForResponse;
    });
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;
    const deliverySummary = canUseDbPagination
      ? await buildDeliverySummaryForWhere(where)
      : buildDeliverySummary(filteredData);

    return withSensitiveNoStore(success({ data, hasMore, nextCursor, deliverySummary }));
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('care_reports_get_unhandled_error', undefined, {
        event: 'care_reports_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAuthorReport',
    message: '報告書の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCareReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const sourceValidation = await validateCareReportSource(prisma, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
      patientId: parsed.data.patient_id,
      caseId: parsed.data.case_id,
      visitRecordId: parsed.data.visit_record_id,
    });
    if ('error' in sourceValidation) {
      return validationError(sourceValidation.error);
    }
    const resolvedCaseId = sourceValidation.caseId;
    if (parsed.data.visit_record_id) {
      const existingReport = await prisma.careReport.findFirst({
        where: {
          org_id: ctx.orgId,
          visit_record_id: parsed.data.visit_record_id,
          report_type: parsed.data.report_type,
        },
        select: { id: true, status: true, report_type: true },
      });
      if (existingReport) {
        return duplicateCareReportResponse(existingReport);
      }
    }

    const { content, ...reportInput } = parsed.data;
    let enrichedContent = content;
    let recipientPrefill: { recipient_name?: string; recipient_organization?: string } | undefined;

    if (resolvedCaseId) {
      const careCase = await prisma.careCase.findFirst({
        where: { id: resolvedCaseId, org_id: ctx.orgId, patient_id: parsed.data.patient_id },
        select: { required_visit_support: true },
      });
      if (!careCase) {
        return validationError('ケースが患者に紐付いていません');
      }

      const intake = getHomeVisitIntake(careCase.required_visit_support) ?? undefined;

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
      const suggestion = await findLatestPrescriberInstitutionSuggestion(prisma, ctx.orgId, {
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

    let report;
    try {
      const createResult = await withOrgContext<CareReportCreateResult>(ctx.orgId, async (tx) => {
        await lockCareReportVisitRecordSource(tx, ctx.orgId, parsed.data.visit_record_id);

        const finalSourceValidation = await validateCareReportSource(tx, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          patientId: parsed.data.patient_id,
          caseId: parsed.data.case_id,
          visitRecordId: parsed.data.visit_record_id,
        });
        if ('error' in finalSourceValidation) {
          return {
            kind: 'validation_error' as const,
            response: validationError(finalSourceValidation.error),
          };
        }
        const finalResolvedCaseId = finalSourceValidation.caseId;
        if (finalResolvedCaseId !== resolvedCaseId) {
          return {
            kind: 'validation_error' as const,
            response: validationError('訪問記録が更新されました。再読み込みしてください'),
          };
        }

        const sourceProvenance = await buildVisitReportSourceProvenance(tx, {
          orgId: ctx.orgId,
          visitRecordId: parsed.data.visit_record_id,
        });
        const finalContent = sourceProvenance
          ? {
              ...enrichedContent,
              source_provenance: sourceProvenance,
            }
          : enrichedContent;

        return {
          kind: 'created' as const,
          report: await tx.careReport.create({
            data: {
              org_id: ctx.orgId,
              created_by: ctx.userId,
              ...reportInput,
              case_id: finalResolvedCaseId ?? null,
              content: toPrismaJsonInput(finalContent),
            },
          }),
        };
      });
      if (createResult.kind === 'validation_error') return createResult.response;
      report = createResult.report;
    } catch (errorValue) {
      if (isCareReportVisitTypeUniqueConflict(errorValue)) {
        const existingReport = parsed.data.visit_record_id
          ? await prisma.careReport.findFirst({
              where: {
                org_id: ctx.orgId,
                visit_record_id: parsed.data.visit_record_id,
                report_type: parsed.data.report_type,
              },
              select: { id: true, status: true, report_type: true },
            })
          : null;
        if (existingReport) return duplicateCareReportResponse(existingReport);

        return conflict('この訪問記録の同一種別の報告書は既に存在します', {
          report_type: parsed.data.report_type,
        });
      }
      throw errorValue;
    }

    return success({ data: report }, 201);
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('care_reports_post_unhandled_error', undefined, {
        event: 'care_reports_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
