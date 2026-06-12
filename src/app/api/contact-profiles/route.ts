import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { listContactProfiles } from '@/lib/contact-profiles';

export const GET = withAuthContext(
  async (req, ctx) => {
    const kind =
      (req.nextUrl.searchParams.get('kind')?.trim() as
        | 'all'
        | 'facility_contact'
        | 'external_professional'
        | 'prescriber_institution'
        | null) ?? 'all';
    const query = req.nextUrl.searchParams.get('q')?.trim() || null;

    const data = await listContactProfiles(prisma, ctx.orgId, {
      kind,
      query,
    });

    return success({
      data: data.map((item) => ({
        ...item,
        last_contacted_at: item.last_contacted_at?.toISOString() ?? null,
      })),
    });
  },
  {
    permission: 'canReport',
    message: '連携先プロファイルの閲覧権限がありません',
  },
);
