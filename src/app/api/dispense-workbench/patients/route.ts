import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { getAuthSecret } from '@/lib/auth/secret';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import {
  DEFAULT_DISPENSE_WORKBENCH_PATIENT_LIMIT,
  DispenseWorkbenchPatientsCursorError,
  MAX_DISPENSE_WORKBENCH_PATIENT_LIMIT,
  dispenseWorkbenchCursorValidationMessage,
  listDispenseWorkbenchPatients,
} from '@/server/services/dispense-workbench-patients';
import type { DispenseWorkbenchPatientsResponse } from '@/lib/dispensing/dispense-workbench-shared';

/**
 * 調剤ワークベンチ左ペイン: 患者中心リスト(計画 §11-2 共通行 / §11-3-1)。
 *
 * `/api/dispense-queue`(task 中心, pending/in_progress のみ)とは別に、MedicationCycle を起点に
 * intake_received〜reported 全域を対象として「患者×最新サイクル状態×服用開始日×登録日」を返す。
 * 状態バッジ3値・開始日/登録日ソートに対応。RLS / 担当割当スコープは既存 API と同様に踏襲する。
 */

const querySchema = z.object({
  sort: z.enum(['start_date', 'registered_date', 'name_kana']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  include_set_plan: z.enum(['1', 'true']).optional(),
  // 工程フィルタ(URL 表記)。未指定は全件。set / set-audit は SetBatch 集計で分類する。
  phase: z.enum(['dispense', 'audit', 'set', 'set-audit']).optional(),
  q: z.string().trim().max(80, 'q は80文字以内で指定してください').optional(),
  limit: boundedIntegerSearchParam(
    'limit',
    1,
    MAX_DISPENSE_WORKBENCH_PATIENT_LIMIT,
    DEFAULT_DISPENSE_WORKBENCH_PATIENT_LIMIT,
  ),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(768)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
});

const singletonQueryParams = [
  'sort',
  'order',
  'include_set_plan',
  'phase',
  'q',
  'limit',
  'cursor',
] as const;

function findDuplicateQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};
  for (const name of singletonQueryParams) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const duplicateParams = findDuplicateQueryParams(searchParams);
    if (duplicateParams) {
      return validationError('クエリパラメータが不正です', duplicateParams);
    }

    const parsed = parseSearchParams(querySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const cursorSecret = getAuthSecret();
    if (!cursorSecret)
      throw new Error('Dispense workbench patients cursor secret is not configured');

    let responseData: DispenseWorkbenchPatientsResponse;
    try {
      responseData = await listDispenseWorkbenchPatients(
        prisma,
        ctx.orgId,
        { userId: ctx.userId, role: ctx.role },
        {
          sort: parsed.data.sort,
          order: parsed.data.order,
          includeSetPlan: parsed.data.include_set_plan != null,
          phase: parsed.data.phase,
          q: parsed.data.q,
          limit: parsed.data.limit,
          cursor: parsed.data.cursor,
          cursorSecret,
        },
      );
    } catch (err) {
      if (err instanceof DispenseWorkbenchPatientsCursorError) {
        return validationError('クエリパラメータが不正です', {
          cursor: [dispenseWorkbenchCursorValidationMessage(err.reason)],
        });
      }
      throw err;
    }

    return success<DispenseWorkbenchPatientsResponse>(responseData);
  },
  {
    permission: 'canDispense',
    message: '調剤ワークベンチの閲覧権限がありません',
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
