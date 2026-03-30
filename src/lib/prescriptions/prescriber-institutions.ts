import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

type DbClient = Prisma.TransactionClient | typeof prisma;

export class PrescriberInstitutionReferenceValidationError extends Error {
  constructor(message = '選択した医療機関が見つかりません') {
    super(message);
    this.name = 'PrescriberInstitutionReferenceValidationError';
  }
}

export type PrescriberInstitutionSuggestion = {
  id: string;
  name: string;
  phone: string | null;
  fax: string | null;
  address: string | null;
  prescribed_date: Date;
  prescriber_name: string | null;
};

export async function findPrescriberInstitutionById(
  db: DbClient,
  orgId: string,
  institutionId: string | null | undefined
) {
  if (!institutionId) return null;

  return db.prescriberInstitution.findFirst({
    where: {
      id: institutionId,
      org_id: orgId,
    },
    select: {
      id: true,
      name: true,
      institution_code: true,
      address: true,
      phone: true,
      fax: true,
      notes: true,
    },
  });
}

export async function assertPrescriberInstitutionReference(
  db: DbClient,
  orgId: string,
  institutionId: string | null | undefined
) {
  if (!institutionId) return;

  const institution = await findPrescriberInstitutionById(db, orgId, institutionId);
  if (!institution) {
    throw new PrescriberInstitutionReferenceValidationError();
  }
}

export async function resolvePrescriberInstitutionFields(
  db: DbClient,
  orgId: string,
  input: {
    prescriber_institution_id?: string | null;
    prescriber_institution?: string | null;
  }
) {
  if (input.prescriber_institution_id) {
    const institution = await findPrescriberInstitutionById(
      db,
      orgId,
      input.prescriber_institution_id
    );
    if (!institution) {
      throw new PrescriberInstitutionReferenceValidationError();
    }

    return {
      prescriber_institution_id: institution.id,
      prescriber_institution: institution.name,
      institution,
    };
  }

  return {
    prescriber_institution_id: null,
    prescriber_institution: input.prescriber_institution?.trim() || null,
    institution: null,
  };
}

export async function findLatestPrescriberInstitutionSuggestion(
  db: DbClient,
  orgId: string,
  input: {
    caseId?: string | null;
    patientId?: string | null;
  }
): Promise<PrescriberInstitutionSuggestion | null> {
  if (!input.caseId && !input.patientId) return null;

  const intake = await db.prescriptionIntake.findFirst({
    where: {
      org_id: orgId,
      prescriber_institution_id: {
        not: null,
      },
      cycle: {
        ...(input.caseId ? { case_id: input.caseId } : {}),
        ...(input.patientId ? { patient_id: input.patientId } : {}),
      },
    },
    orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
    select: {
      prescribed_date: true,
      prescriber_name: true,
      prescriber_institution_ref: {
        select: {
          id: true,
          name: true,
          phone: true,
          fax: true,
          address: true,
        },
      },
    },
  });

  if (!intake?.prescriber_institution_ref) return null;

  return {
    id: intake.prescriber_institution_ref.id,
    name: intake.prescriber_institution_ref.name,
    phone: intake.prescriber_institution_ref.phone,
    fax: intake.prescriber_institution_ref.fax,
    address: intake.prescriber_institution_ref.address,
    prescribed_date: intake.prescribed_date,
    prescriber_name: intake.prescriber_name,
  };
}
