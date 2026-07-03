import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { createCaseSchema } from '@/lib/validations/case';
import { buildCursorPage, parseOptionalBoundedIntegerParam } from '@/lib/api/pagination';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { CASE_STATUSES } from '@/lib/patient/case-status';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { z } from 'zod';

const caseStatusSchema = z.enum(CASE_STATUSES);
const DEFAULT_CASE_LIST_LIMIT = 50;
const MAX_CASE_LIST_LIMIT = 100;
const MAX_CASE_LIST_FILTER_LENGTH = 100;

type CaseListQuery =
  | {
      ok: true;
      cursor: string | undefined;
      limit: number;
      patientId: string | undefined;
      status: z.infer<typeof caseStatusSchema> | undefined;
      query: string;
    }
  | { ok: false; response: ReturnType<typeof validationError> };

function readSingleCaseListQueryValue(
  searchParams: URLSearchParams,
  name: string,
  message: string,
  options: { allowPadded?: boolean; maxLength?: number } = {},
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

  const rawValue = values[0] ?? '';
  const value = rawValue.trim();
  if (!value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  if (!options.allowPadded && value !== rawValue) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  if (options.maxLength && value.length > options.maxLength) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }

  return { ok: true as const, value };
}

function parseCaseListQuery(searchParams: URLSearchParams): CaseListQuery {
  const cursorResult = readSingleCaseListQueryValue(searchParams, 'cursor', 'cursor が不正です', {
    maxLength: MAX_CASE_LIST_FILTER_LENGTH,
  });
  if (!cursorResult.ok) return cursorResult;

  const limitValues = searchParams.getAll('limit');
  if (limitValues.length > 1) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', {
        limit: ['limit は1つだけ指定してください'],
      }),
    };
  }
  const limitResult = parseOptionalBoundedIntegerParam(
    limitValues[0] ?? null,
    1,
    MAX_CASE_LIST_LIMIT,
  );
  if (!limitResult.ok) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', {
        limit: [`limit は 1〜${MAX_CASE_LIST_LIMIT} の整数で指定してください`],
      }),
    };
  }

  const patientResult = readSingleCaseListQueryValue(
    searchParams,
    'patient_id',
    'patient_id が不正です',
    { maxLength: MAX_CASE_LIST_FILTER_LENGTH },
  );
  if (!patientResult.ok) return patientResult;

  const statusResult = readSingleCaseListQueryValue(
    searchParams,
    'status',
    'ケースステータスが不正です',
    { maxLength: MAX_CASE_LIST_FILTER_LENGTH },
  );
  if (!statusResult.ok) return statusResult;
  const parsedStatus = statusResult.value ? caseStatusSchema.safeParse(statusResult.value) : null;
  if (parsedStatus && !parsedStatus.success) {
    return {
      ok: false,
      response: validationError('ケースステータスが不正です', {
        status: ['対応していないステータスです'],
      }),
    };
  }

  const queryResult = readSingleCaseListQueryValue(searchParams, 'q', 'q が不正です', {
    allowPadded: true,
    maxLength: MAX_CASE_LIST_FILTER_LENGTH,
  });
  if (!queryResult.ok) return queryResult;

  return {
    ok: true,
    cursor: cursorResult.value,
    limit: limitResult.value ?? DEFAULT_CASE_LIST_LIMIT,
    patientId: patientResult.value,
    status: parsedStatus?.data,
    query: queryResult.value ?? '',
  };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const query = parseCaseListQuery(searchParams);
    if (!query.ok) {
      return query.response;
    }

    const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);

    const cases = await prisma.careCase.findMany({
      where: {
        org_id: ctx.orgId,
        ...(query.patientId ? { patient_id: query.patientId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
        ...(query.query
          ? {
              patient: {
                OR: [{ name: { contains: query.query } }, { name_kana: { contains: query.query } }],
              },
            }
          : {}),
      },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { updated_at: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            display_id: true,
            name: true,
            name_kana: true,
            residences: {
              where: { is_primary: true },
              select: {
                address: true,
                lat: true,
                lng: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    const pharmacistIds = Array.from(
      new Set(
        cases
          .map((careCase) => careCase.primary_pharmacist_id)
          .filter((value): value is string => value != null),
      ),
    );
    const pharmacists =
      pharmacistIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: {
              org_id: ctx.orgId,
              id: { in: pharmacistIds },
            },
            select: {
              id: true,
              name: true,
            },
          });
    const pharmacistNameById = new Map(
      pharmacists.map((pharmacist) => [pharmacist.id, pharmacist.name]),
    );

    const page = buildCursorPage(cases, query.limit, (careCase) => careCase.id);
    const data = page.data.map((careCase) => ({
      ...careCase,
      primary_pharmacist_name: careCase.primary_pharmacist_id
        ? (pharmacistNameById.get(careCase.primary_pharmacist_id) ?? null)
        : null,
    }));

    return success({ data, hasMore: page.hasMore, nextCursor: page.nextCursor });
  },
  {
    permission: 'canVisit',
    message: 'ケースの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCaseSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, referral_date, ...rest } = parsed.data;

    // Verify patient belongs to org
    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere({ id: patient_id, org_id: ctx.orgId }, ctx),
    });
    if (!patient) return notFound('患者が見つかりません');

    const careCase = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.careCase.create({
        data: {
          org_id: ctx.orgId,
          patient_id,
          ...(referral_date ? { referral_date: new Date(referral_date) } : {}),
          ...rest,
        },
      });
    });

    return success(careCase, 201);
  },
  {
    permission: 'canVisit',
    message: 'ケースの作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
