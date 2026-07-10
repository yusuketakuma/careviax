import type { Prisma } from '@prisma/client';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

export const PATIENT_SHARE_CASE_CONSENT_LOCK_NAMESPACE = 'patient_share_case_consent';

export function buildPatientShareCaseConsentLockKey(args: { orgId: string; shareCaseId: string }) {
  return `${args.orgId}:${args.shareCaseId}`;
}

function dateOnlyFromDate(value: Date) {
  return utcDateFromLocalKey(japanDateKey(value));
}

function buildActivePatientShareCaseWhere(args: {
  orgId: string;
  asOf: Date;
}): Prisma.PatientShareCaseWhereInput {
  const asOfDate = dateOnlyFromDate(args.asOf);
  return {
    org_id: args.orgId,
    status: 'active',
    revoked_at: null,
    ended_at: null,
    partnership: {
      status: 'active',
      partner_pharmacy: { status: 'active' },
      OR: [{ effective_from: null }, { effective_from: { lte: asOfDate } }],
      AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: asOfDate } }] }],
    },
    OR: [{ starts_at: null }, { starts_at: { lte: asOfDate } }],
    AND: [
      { OR: [{ ends_at: null }, { ends_at: { gte: asOfDate } }] },
      {
        consents: {
          some: {
            revoked_at: null,
            consent_date: { lte: asOfDate },
            OR: [{ valid_until: null }, { valid_until: { gte: asOfDate } }],
          },
        },
      },
    ],
  };
}

export function buildActivePatientShareCaseReadWhere(args: {
  orgId: string;
  asOf?: Date;
}): Prisma.PatientShareCaseWhereInput {
  return buildActivePatientShareCaseWhere({
    orgId: args.orgId,
    asOf: args.asOf ?? new Date(),
  });
}

export function buildActivePatientShareCaseMutationWhere(args: {
  orgId: string;
  asOf: Date;
}): Prisma.PatientShareCaseWhereInput {
  return buildActivePatientShareCaseWhere(args);
}
