import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { todayUtcRange } from '@/lib/utils/date-boundary';

const DEFAULT_ME_SITE_LIMIT = 500;
const MAX_ME_SITE_LIMIT = 500;

export const GET = withAuthContext(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const limit = parseBoundedInteger(
    searchParams.get('limit'),
    DEFAULT_ME_SITE_LIMIT,
    1,
    MAX_ME_SITE_LIMIT,
  );
  const todayRange = todayUtcRange();

  // Resolve memberships for the current user in the current org
  const memberships = await prisma.membership.findMany({
    where: { user_id: ctx.userId, org_id: ctx.orgId, is_active: true },
    select: { site_id: true },
  });

  const hasUniversalAccess = memberships.some((m) => m.site_id === null);
  const memberSiteIds = memberships.map((m) => m.site_id).filter((id): id is string => id !== null);

  // Fetch sites scoped to membership
  const sites = await prisma.pharmacySite.findMany({
    where: {
      org_id: ctx.orgId,
      ...(hasUniversalAccess ? {} : { id: { in: memberSiteIds } }),
    },
    select: {
      id: true,
      name: true,
      is_regional_support: true,
    },
    orderBy: { name: 'asc' },
    take: limit + 1,
  });
  const hasMore = sites.length > limit;
  const returnedSites = sites.slice(0, limit);

  const siteIds = returnedSites.map((s) => s.id);

  // Count today's non-cancelled visit schedules per site
  const visitCounts = await prisma.visitSchedule.groupBy({
    by: ['site_id'],
    where: {
      org_id: ctx.orgId,
      site_id: { in: siteIds },
      scheduled_date: todayRange,
      schedule_status: { not: 'cancelled' },
    },
    _count: { _all: true },
  });

  const countBySiteId = new Map(visitCounts.map((c) => [c.site_id, c._count._all]));

  // Resolve current user's default site
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { default_site_id: true },
  });

  const result = returnedSites.map((site) => ({
    id: site.id,
    name: site.name,
    todays_visit_count: countBySiteId.get(site.id) ?? 0,
    // is_regional_support serves as the home-visit indicator until a dedicated flag is added
    has_home_visit: site.is_regional_support,
    is_current: user?.default_site_id === site.id,
  }));

  return success({ data: result, meta: { limit, has_more: hasMore } });
});
