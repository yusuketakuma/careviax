import type { PrismaClient, Prisma } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function fetchEmergencyContacts(prisma: DbClient, orgId: string, patientId: string) {
  return prisma.contactParty.findMany({
    where: { org_id: orgId, patient_id: patientId, is_emergency_contact: true },
    select: {
      id: true,
      name: true,
      relation: true,
      phone: true,
      email: true,
      fax: true,
      is_primary: true,
      organization_name: true,
      notes: true,
    },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
  });
}
