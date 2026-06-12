import { z } from 'zod';

import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { getPerformanceSnapshot } from '@/lib/utils/performance';

const performanceMetricsQuerySchema = z.object({
  top: boundedIntegerSearchParam('top', 1, 20, 8),
});

export const GET = withAuthContext(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(performanceMetricsQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    return success({
      data: getPerformanceSnapshot({
        topRoutes: parsed.data.top,
      }),
    });
  },
  {
    permission: 'canAdmin',
    message: 'パフォーマンス指標の閲覧権限がありません',
  },
);
