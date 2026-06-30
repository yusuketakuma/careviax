import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { facilityContactSchema } from '@/lib/validations/facility';

const updateFacilityContactsSchema = z.object({
  expected_updated_at: z.string().datetime('施設担当者の版情報が不正です'),
  contacts: z.array(facilityContactSchema),
});

function toResponse(
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
    fax: string | null;
    is_primary: boolean;
    notes: string | null;
    updated_at?: Date;
  }>,
) {
  return contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    email: contact.email,
    fax: contact.fax,
    is_primary: contact.is_primary,
    notes: contact.notes,
    updated_at: contact.updated_at?.toISOString(),
  }));
}

function staleContactsConflict(expectedUpdatedAt: string, currentUpdatedAt: Date | null) {
  return conflict('施設担当者が更新されています。再読み込みしてください', {
    conflict_type: 'stale_facility_contacts',
    expected_updated_at: expectedUpdatedAt,
    current_updated_at: currentUpdatedAt?.toISOString() ?? null,
  });
}

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const facility = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: {
        id: true,
        updated_at: true,
        contacts: {
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        },
      },
    });
    if (!facility) return notFound('施設が見つかりません');

    return success({
      data: toResponse(facility.contacts),
      metadata: {
        expected_updated_at: facility.updated_at.toISOString(),
        version_basis: 'facility_updated_at',
      },
    });
  },
  {
    permission: 'canVisit',
    message: '施設担当者の閲覧権限がありません',
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

export const PUT = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateFacilityContactsSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);

    const existing = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, updated_at: true },
    });
    if (!existing) return notFound('施設が見つかりません');
    if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
      return staleContactsConflict(parsed.data.expected_updated_at, existing.updated_at);
    }

    const nextUpdatedAt = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const claimed = await tx.facility.updateMany({
        where: { id, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        data: { updated_at: nextUpdatedAt },
      });
      if (claimed.count !== 1) {
        return {
          kind: 'response' as const,
          response: staleContactsConflict(parsed.data.expected_updated_at, existing.updated_at),
        };
      }

      await tx.facilityContact.deleteMany({
        where: { org_id: ctx.orgId, facility_id: id },
      });

      if (parsed.data.contacts.length > 0) {
        await tx.facilityContact.createMany({
          data: parsed.data.contacts.map((contact) => ({
            org_id: ctx.orgId,
            facility_id: id,
            name: contact.name,
            role: contact.role || null,
            phone: contact.phone || null,
            email: contact.email || null,
            fax: contact.fax || null,
            is_primary: contact.is_primary,
            notes: contact.notes || null,
          })),
        });
      }

      const contacts = await tx.facilityContact.findMany({
        where: { org_id: ctx.orgId, facility_id: id },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      });
      return { kind: 'updated' as const, contacts, expectedUpdatedAt: nextUpdatedAt };
    });
    if (result.kind === 'response') return result.response;

    return success({
      data: toResponse(result.contacts),
      metadata: {
        expected_updated_at: result.expectedUpdatedAt.toISOString(),
        version_basis: 'facility_updated_at',
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '施設担当者の更新権限がありません',
  },
);
