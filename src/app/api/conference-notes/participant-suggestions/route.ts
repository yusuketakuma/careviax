import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const facilityId = searchParams.get('facility_id');
    if (!facilityId?.trim()) {
      return validationError('facility_id は必須です');
    }
    const conferenceNoteId = searchParams.get('conference_note_id');
    if (!conferenceNoteId?.trim()) {
      return validationError('conference_note_id は必須です');
    }

    const suggestions = await withOrgContext(ctx.orgId, async (tx) => {
      const note = await tx.conferenceNote.findFirst({
        where: {
          id: conferenceNoteId,
          org_id: ctx.orgId,
          facility_id: facilityId,
        },
        select: {
          id: true,
        },
      });
      if (!note) return null;

      const facility = await tx.facility.findFirst({
        where: { id: facilityId, org_id: ctx.orgId },
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
              preferred_contact_method: true,
            },
          },
        },
      });
      if (!facility) return null;
      return facility.contacts.map((contact) => ({
        name: contact.name,
        role: contact.role ?? null,
        preferred_contact_method: contact.preferred_contact_method ?? null,
        source: 'facility_contact' as const,
        facility_id: facility.id,
        facility_name: facility.name,
      }));
    });

    if (!suggestions) {
      return validationError('カンファレンス記録と施設が一致しません');
    }
    return success({ data: suggestions });
  },
  {
    permission: 'canReport',
    message: 'カンファレンス参加者候補の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
