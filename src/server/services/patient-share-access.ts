import type { Prisma } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';

function dateOnlyFromDate(value: Date) {
  return utcDateFromLocalKey(formatUtcDateKey(value));
}

export function buildActivePatientShareCaseReadWhere(args: {
  orgId: string;
  asOf?: Date;
}): Prisma.PatientShareCaseWhereInput {
  const asOfDate = dateOnlyFromDate(args.asOf ?? new Date());
  return {
    org_id: args.orgId,
    status: 'active',
    partnership: {
      status: 'active',
      partner_pharmacy: { status: 'active' },
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
