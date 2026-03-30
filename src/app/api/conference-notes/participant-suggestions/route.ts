import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const facilityId = searchParams.get('facility_id');
    if (!facilityId?.trim()) {
      return validationError('facility_id は必須です');
    }

    const suggestions = await withOrgContext(req.orgId, async (tx) => {
      const facility = await tx.facility.findFirst({
        where: { id: facilityId, org_id: req.orgId },
        select: {
          id: true,
          name: true,
          contacts: {
            where: { is_primary: true },
            orderBy: [{ name: 'asc' }],
            select: {
              id: true,
              name: true,
              role: true,
              phone: true,
              email: true,
              preferred_contact_method: true,
            },
          },
        },
      });
      if (!facility) return null;
      return facility.contacts.map((contact) => ({
        name: contact.name,
        role: contact.role ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        preferred_contact_method: contact.preferred_contact_method ?? null,
        source: 'facility_contact' as const,
        facility_id: facility.id,
        facility_name: facility.name,
      }));
    });

    if (!suggestions) {
      return validationError('施設が見つかりません');
    }
    return success({ data: suggestions });
  },
  {
    permission: 'canReport',
    message: 'カンファレンス参加者候補の閲覧権限がありません',
  }
);
