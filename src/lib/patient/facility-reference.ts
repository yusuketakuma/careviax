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
