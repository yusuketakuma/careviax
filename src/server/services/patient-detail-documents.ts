import type { MemberRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { getPatientPrivacyFlags, maskContactValue, maskPhoneNumber } from '@/lib/patient/privacy';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';

type DbClient = typeof prisma | Prisma.TransactionClient;

type DetailArgs = {
  orgId: string;
  patientId: string;
  role: MemberRole;
  userId: string;
};

type FirstVisitDocumentContact = {
  id?: string;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  organization_name: string | null;
  department: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
};

function buildPatientDocumentsWhere(args: DetailArgs): Prisma.PatientWhereInput {
  return applyPatientAssignmentWhere(
    {
      id: args.patientId,
      org_id: args.orgId,
    },
    {
      userId: args.userId,
      role: args.role,
    },
  );
}

function normalizeFirstVisitDocumentContacts(
  value: Prisma.JsonValue | null | undefined,
): FirstVisitDocumentContact[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = readJsonObject(item);
    if (!record) return [];
    const name = typeof record.name === 'string' ? record.name : null;
    if (!name) return [];

    return [
      {
        id: typeof record.id === 'string' ? record.id : undefined,
        name,
        relation: typeof record.relation === 'string' ? record.relation : null,
        phone: typeof record.phone === 'string' ? record.phone : null,
        email: typeof record.email === 'string' ? record.email : null,
        fax: typeof record.fax === 'string' ? record.fax : null,
        organization_name:
          typeof record.organization_name === 'string' ? record.organization_name : null,
        department: typeof record.department === 'string' ? record.department : null,
        is_primary: record.is_primary === true,
        is_emergency_contact: record.is_emergency_contact === true,
      },
    ];
  });
}

export async function getPatientDocumentsData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDocumentsWhere(args),
    select: {
      id: true,
      cases: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const firstVisitDocuments =
    caseIds.length === 0
      ? []
      : await db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          select: {
            id: true,
            case_id: true,
            emergency_contacts: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
            updated_at: true,
          },
        });

  const privacy = getPatientPrivacyFlags(args.role);

  return {
    first_visit_documents: firstVisitDocuments.map((item) => ({
      ...item,
      emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts).map(
        (contact) => ({
          ...contact,
          phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
          fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
          email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
        }),
      ),
    })),
  };
}
