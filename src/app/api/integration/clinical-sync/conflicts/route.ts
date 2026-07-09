import { NextRequest, type NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import {
  isClinicalSyncReviewConflictCode,
  listClinicalSyncConflicts,
  type ClinicalSyncReviewConflictCode,
} from '@/server/services/standard-clinical-sync-conflict-review';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function readOptionalSingleQueryParam(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [key]: [`${key} は1つだけ指定してください`],
      }),
    };
  }
  const value = values[0]?.trim();
  if (!value || value !== values[0]) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [key]: [`${key} が不正です`],
      }),
    };
  }
  return { ok: true as const, value };
}

function parseConflictCode(
  searchParams: URLSearchParams,
):
  | { ok: true; value: ClinicalSyncReviewConflictCode | undefined }
  | { ok: false; response: NextResponse } {
  const result = readOptionalSingleQueryParam(searchParams, 'error_code');
  if (!result.ok) return result;
  if (result.value === undefined) return { ok: true, value: undefined };
  if (isClinicalSyncReviewConflictCode(result.value)) {
    return { ok: true, value: result.value };
  }
  return {
    ok: false,
    response: validationError('検索条件が不正です', {
      error_code: ['error_code が不正です'],
    }),
  };
}

const authenticatedGET = withAuthContext(
  async (req: NextRequest, ctx) => {
    const searchParams = req.nextUrl.searchParams;
    const errorCode = parseConflictCode(searchParams);
    if (!errorCode.ok) return errorCode.response;

    const limit = parseBoundedInteger(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const conflicts = await withOrgContext(ctx.orgId, (tx) =>
      listClinicalSyncConflicts(tx, {
        orgId: ctx.orgId,
        limit,
        errorCode: errorCode.value,
      }),
    );

    return success({
      data: {
        conflicts,
      },
      meta: {
        count: conflicts.length,
        limit,
        error_code: errorCode.value ?? null,
        generated_at: new Date().toISOString(),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: 'clinical sync conflictの閲覧権限がありません',
  },
);

export async function GET(req: NextRequest) {
  return withSensitiveNoStore(await authenticatedGET(req, { params: Promise.resolve({}) }));
}
