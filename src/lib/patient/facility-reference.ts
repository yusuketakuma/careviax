import type { Prisma } from '@prisma/client';

export class FacilityReferenceValidationError extends Error {
  constructor(message = '選択した施設が見つかりません') {
    super(message);
    this.name = 'FacilityReferenceValidationError';
  }
}

export class FacilityUnitReferenceValidationError extends Error {
  constructor(message = '選択したユニットが見つかりません') {
    super(message);
    this.name = 'FacilityUnitReferenceValidationError';
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

export async function assertFacilityUnitReference(
  tx: Prisma.TransactionClient,
  orgId: string,
  facilityId: string | null | undefined,
  facilityUnitId: string | null | undefined
) {
  if (!facilityUnitId) return;

  if (!facilityId) {
    throw new FacilityUnitReferenceValidationError(
      'ユニットを選択する場合は施設を選択してください'
    );
  }

  const facilityUnit = await tx.facilityUnit.findFirst({
    where: {
      id: facilityUnitId,
      org_id: orgId,
      facility_id: facilityId,
    },
    select: {
      id: true,
    },
  });

  if (!facilityUnit) {
    throw new FacilityUnitReferenceValidationError(
      '選択したユニットが施設に紐づいていません'
    );
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
