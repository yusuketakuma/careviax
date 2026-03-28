import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { getPerformanceSnapshot } from '@/lib/utils/performance';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const topParam = Number(searchParams.get('top') ?? '8');
  const topRoutes = Number.isFinite(topParam) ? Math.min(Math.max(Math.trunc(topParam), 1), 20) : 8;

  return success({
    data: getPerformanceSnapshot({
      topRoutes,
    }),
  });
}, {
  permission: 'canAdmin',
  message: 'パフォーマンス指標の閲覧権限がありません',
});
