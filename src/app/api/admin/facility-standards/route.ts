import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const requirementsStatusSchema = z.record(z.string(), z.unknown());

function readRequirementsStatus(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = requirementsStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const GET = withAuthContext(
  async (_req, ctx) => {
    const standards = await prisma.facilityStandardRegistration.findMany({
      where: {
        org_id: ctx.orgId,
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
      data: standards.map((item) => {
        const requirementsStatus = readRequirementsStatus(item.requirements_status);

        return {
          id: item.id,
          standard_type: item.standard_type,
          filed_date: item.filed_date.toISOString(),
          effective_date: item.effective_date?.toISOString() ?? null,
          expiry_date: item.expiry_date?.toISOString() ?? null,
          renewal_alert_date: item.renewal_alert_date?.toISOString() ?? null,
          requirements_status: requirementsStatus,
          claim_status: requirementsStatus
            ? Object.values(requirementsStatus).every(Boolean)
              ? 'claimable'
              : 'blocked'
            : 'unknown',
          site_id: item.site.id,
          site_name: item.site.name,
        };
      }),
    });
  },
  {
    permission: 'canAdmin',
    message: '施設基準管理の閲覧権限がありません',
  },
);
