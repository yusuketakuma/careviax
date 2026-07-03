import type { Gender, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export type CareReportSourcePatientDb = Pick<typeof prisma | Prisma.TransactionClient, 'patient'>;

export type CareReportSourcePatient = {
  id: string;
  name: string;
  birth_date: Date;
  gender: Gender;
};

export async function getCareReportSourcePatient(
  db: CareReportSourcePatientDb,
  args: { orgId: string; patientId: string },
): Promise<CareReportSourcePatient | null> {
  return db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: { id: true, name: true, birth_date: true, gender: true },
  });
}
