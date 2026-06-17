import type { Gender, MemberRole, Prisma, PrismaClient } from '@prisma/client';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { formatUtcDateKey } from '@/lib/date-key';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type PatientDuplicateCandidate = {
  id: string;
  name: string;
  name_kana: string | null;
  birth_date: Date | string;
  gender: Gender;
};

export type ContactDuplicateWarning = {
  code: 'DUPLICATE_CONTACT';
  severity: 'warning';
  message: string;
  contact_indexes: number[];
  duplicate_type: 'same_name_relation' | 'same_phone' | 'same_email' | 'same_fax';
};

export function parsePatientDuplicateBirthDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (formatUtcDateKey(date) !== value) return null;
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function findPatientDuplicateCandidates(
  db: DbClient,
  args: {
    orgId: string;
    name: string;
    birthDate: Date;
    gender: Gender;
    access?: {
      userId: string;
      role: MemberRole;
    };
    excludePatientId?: string | null;
    take?: number;
  },
): Promise<PatientDuplicateCandidate[]> {
  const baseWhere = {
    org_id: args.orgId,
    name: { contains: args.name.trim(), mode: 'insensitive' },
    birth_date: args.birthDate,
    gender: args.gender,
    ...(args.excludePatientId ? { id: { not: args.excludePatientId } } : {}),
  } satisfies Prisma.PatientWhereInput;

  return db.patient.findMany({
    where: args.access ? applyPatientAssignmentWhere(baseWhere, args.access) : baseWhere,
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
    },
    take: args.take ?? 10,
  });
}

function normalizeDuplicateText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function addContactDuplicateWarnings(
  warnings: ContactDuplicateWarning[],
  seen: Map<string, number>,
  key: string,
  index: number,
  duplicateType: ContactDuplicateWarning['duplicate_type'],
) {
  if (!key) return;
  const firstIndex = seen.get(key);
  if (firstIndex == null) {
    seen.set(key, index);
    return;
  }
  warnings.push({
    code: 'DUPLICATE_CONTACT',
    severity: 'warning',
    message: `連絡先${firstIndex + 1}件目と${index + 1}件目が重複している可能性があります。`,
    contact_indexes: [firstIndex, index],
    duplicate_type: duplicateType,
  });
}

export function detectDuplicatePatientContacts(
  contacts: Array<{
    name?: string | null;
    relation?: string | null;
    phone?: string | null;
    email?: string | null;
    fax?: string | null;
  }>,
): ContactDuplicateWarning[] {
  const warnings: ContactDuplicateWarning[] = [];
  const seenNameRelation = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const seenFax = new Map<string, number>();

  contacts.forEach((contact, index) => {
    const name = normalizeDuplicateText(contact.name);
    const relation = normalizeDuplicateText(contact.relation);
    addContactDuplicateWarnings(
      warnings,
      seenNameRelation,
      name && relation ? `${name}::${relation}` : '',
      index,
      'same_name_relation',
    );
    addContactDuplicateWarnings(
      warnings,
      seenPhone,
      normalizeDuplicateText(contact.phone),
      index,
      'same_phone',
    );
    addContactDuplicateWarnings(
      warnings,
      seenEmail,
      normalizeDuplicateText(contact.email),
      index,
      'same_email',
    );
    addContactDuplicateWarnings(
      warnings,
      seenFax,
      normalizeDuplicateText(contact.fax),
      index,
      'same_fax',
    );
  });

  return warnings;
}
