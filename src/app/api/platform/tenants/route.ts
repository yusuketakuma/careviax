import type { NextRequest } from 'next/server';
import { success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { requirePlatformOperator } from '@/lib/platform/operator';
import { listActiveBreakGlassSessions } from '@/lib/platform/break-glass';

/** Platform tenant directory. Metadata only (no PHI); no break-glass required
 * just to see the tenant list. */
export async function GET(req: NextRequest) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;
  const { operator } = guard;

  const [orgs, activeSessions] = await Promise.all([
    prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        corporate_number: true,
        created_at: true,
        _count: { select: { memberships: true, sites: true } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    listActiveBreakGlassSessions(operator.operatorId),
  ]);

  const activeByOrg = new Map(activeSessions.map((s) => [s.target_org_id, s]));
  const tenants = orgs.map((o) => {
    const session = activeByOrg.get(o.id);
    return {
      id: o.id,
      name: o.name,
      corporate_number: o.corporate_number,
      created_at: o.created_at.toISOString(),
      member_count: o._count.memberships,
      site_count: o._count.sites,
      active_break_glass: session
        ? { id: session.id, expires_at: session.expires_at.toISOString(), scope: session.scope }
        : null,
    };
  });

  return withSensitiveNoStore(success({ tenants }));
}

export const dynamic = 'force-dynamic';
