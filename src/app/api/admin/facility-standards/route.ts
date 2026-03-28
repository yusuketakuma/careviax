import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const standards = await prisma.facilityStandardRegistration.findMany({
    where: {
      org_id: req.orgId,
    },
    select: {
      id: true,
      standard_type: true,
      filed_date: true,
      effective_date: true,
      expiry_date: true,
      renewal_alert_date: true,
      requirements_status: true,
      site: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ expiry_date: 'asc' }, { filed_date: 'desc' }],
  });

  return success({
    data: standards.map((item) => ({
      id: item.id,
      standard_type: item.standard_type,
      filed_date: item.filed_date.toISOString(),
      effective_date: item.effective_date?.toISOString() ?? null,
      expiry_date: item.expiry_date?.toISOString() ?? null,
      renewal_alert_date: item.renewal_alert_date?.toISOString() ?? null,
      requirements_status:
        item.requirements_status &&
        typeof item.requirements_status === 'object' &&
        !Array.isArray(item.requirements_status)
          ? item.requirements_status
          : null,
      claim_status:
        item.requirements_status &&
        typeof item.requirements_status === 'object' &&
        !Array.isArray(item.requirements_status)
          ? Object.values(item.requirements_status as Record<string, boolean>).every(Boolean)
            ? 'claimable'
            : 'blocked'
          : 'unknown',
      site_id: item.site.id,
      site_name: item.site.name,
    })),
  });
}, {
  permission: 'canAdmin',
  message: '施設基準管理の閲覧権限がありません',
});
