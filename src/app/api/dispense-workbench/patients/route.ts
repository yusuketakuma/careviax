import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { listDispenseWorkbenchPatients } from '@/server/services/dispense-workbench-patients';
import type { DispenseWorkbenchPatientsResponse } from '@/app/(dashboard)/dispense/dispense-workbench.shared';

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
});

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(querySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const data = await listDispenseWorkbenchPatients(
      prisma,
      ctx.orgId,
      { userId: ctx.userId, role: ctx.role },
      parsed.data,
    );

    return success<DispenseWorkbenchPatientsResponse>({ data });
  },
  {
    permission: 'canDispense',
    message: '調剤ワークベンチの閲覧権限がありません',
  },
);
