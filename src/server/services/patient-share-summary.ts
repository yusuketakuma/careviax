import type { Prisma } from '@prisma/client';
import { enabledPatientShareScopeKeys } from '@/server/services/patient-share-scope';
import { buildActivePatientShareCaseReadWhere } from '@/server/services/patient-share-access';

type PatientShareSummaryDb = {
  patientShareCase: Pick<Prisma.TransactionClient['patientShareCase'], 'findMany'>;
};

export type PatientShareSummary = {
  status: 'none' | 'active';
  active_case_count: number;
  partner_pharmacy_count: number;
  scope_keys: string[];
};

export function emptyPatientShareSummary(): PatientShareSummary {
  return {
    status: 'none',
    active_case_count: 0,
    partner_pharmacy_count: 0,
    scope_keys: [],
  };
}

export async function listActivePatientShareSummaries(
  db: PatientShareSummaryDb,
  args: {
    orgId: string;
    patientIds: string[];
    asOf?: Date;
  },
) {
  const summaries = new Map<string, PatientShareSummary>();
  for (const patientId of args.patientIds) {
    summaries.set(patientId, emptyPatientShareSummary());
  }
  if (args.patientIds.length === 0) return summaries;

  const rows = await db.patientShareCase.findMany({
    where: {
      ...buildActivePatientShareCaseReadWhere({ orgId: args.orgId, asOf: args.asOf }),
      base_patient_id: { in: args.patientIds },
    },
    select: {
      base_patient_id: true,
      share_scope: true,
      partnership: {
        select: {
          partner_pharmacy_id: true,
        },
      },
    },
  });

  const scopeKeysByPatient = new Map<string, Set<string>>();
  const partnerPharmacyIdsByPatient = new Map<string, Set<string>>();

  for (const row of rows) {
    const summary = summaries.get(row.base_patient_id) ?? emptyPatientShareSummary();
    summary.status = 'active';
    summary.active_case_count += 1;
    summaries.set(row.base_patient_id, summary);

    const scopeKeys = scopeKeysByPatient.get(row.base_patient_id) ?? new Set<string>();
    for (const scopeKey of enabledPatientShareScopeKeys(row.share_scope)) {
      scopeKeys.add(scopeKey);
    }
    scopeKeysByPatient.set(row.base_patient_id, scopeKeys);

    const partnerPharmacyIds =
      partnerPharmacyIdsByPatient.get(row.base_patient_id) ?? new Set<string>();
    partnerPharmacyIds.add(row.partnership.partner_pharmacy_id);
    partnerPharmacyIdsByPatient.set(row.base_patient_id, partnerPharmacyIds);
  }

  for (const [patientId, summary] of summaries) {
    const scopeKeys = scopeKeysByPatient.get(patientId);
    const partnerPharmacyIds = partnerPharmacyIdsByPatient.get(patientId);
    summary.scope_keys = scopeKeys ? [...scopeKeys].sort() : [];
    summary.partner_pharmacy_count = partnerPharmacyIds?.size ?? 0;
  }

  return summaries;
}
