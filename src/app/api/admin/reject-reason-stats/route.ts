import { z } from 'zod';

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const REJECT_REASON_CODE_LABELS: Record<string, string> = {
  drug_name_mismatch: '薬剤名不一致',
  quantity_error: '数量エラー',
  packaging_error: '包装エラー',
  carry_type_error: '持参区分エラー',
  labeling_error: 'ラベルエラー',
  other: 'その他',
};

const DEFAULT_REJECT_REASON_STATS_DAYS = 30;
const MAX_REJECT_REASON_STATS_DAYS = 365;

const rejectReasonStatsQuerySchema = z.object({
  days: boundedIntegerSearchParam(
    'days',
    0,
    MAX_REJECT_REASON_STATS_DAYS,
    DEFAULT_REJECT_REASON_STATS_DAYS,
  ),
});

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(rejectReasonStatsQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { days } = parsed.data;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const audits = await prisma.dispenseAudit.findMany({
      where: {
        org_id: req.orgId,
        result: 'rejected',
        audited_at: { gte: since },
      },
      select: {
        reject_reason_code: true,
        reject_reason: true,
        audited_at: true,
      },
      orderBy: { audited_at: 'desc' },
    });

    const totalRejected = audits.length;

    // Aggregate by code
    const byCode = new Map<string, number>();
    for (const audit of audits) {
      const code = audit.reject_reason_code ?? 'other';
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
    }

    const breakdown = Array.from(byCode.entries())
      .map(([code, count]) => ({
        code,
        label: REJECT_REASON_CODE_LABELS[code] ?? code,
        count,
        percentage: totalRejected > 0 ? Math.round((count / totalRejected) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return success({
      data: {
        total_rejected: totalRejected,
        period_days: days,
        breakdown,
      },
    });
  },
  {
    permission: 'canAuditDispense',
    message: '差戻し統計の閲覧権限がありません',
  },
);
