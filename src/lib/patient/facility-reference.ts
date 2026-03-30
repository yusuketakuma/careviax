import type { Prisma } from '@prisma/client';

export class FacilityReferenceValidationError extends Error {
  constructor(message = '選択した施設が見つかりません') {
    super(message);
    this.name = 'FacilityReferenceValidationError';
  }
}

export async function assertFacilityReference(
  tx: Prisma.TransactionClient,
  orgId: string,
  facilityId: string | null | undefined
) {
  if (!facilityId) return;

  const facility = await tx.facility.findFirst({
    where: {
      id: facilityId,
      org_id: orgId,
    },
    select: {
      id: true,
    },
  });

  if (!facility) {
    throw new FacilityReferenceValidationError();
  }
}

export async function getFacilityVisitDefaults(
  tx: Prisma.TransactionClient,
  orgId: string,
  facilityId: string | null | undefined
) {
  if (!facilityId) return null;

  return tx.facility.findFirst({
    where: {
      id: facilityId,
      org_id: orgId,
    },
    select: {
      id: true,
      acceptance_time_from: true,
      acceptance_time_to: true,
      regular_visit_weekdays: true,
    },
  });
}
